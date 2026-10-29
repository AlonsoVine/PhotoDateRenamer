"""EXIF-based photo scanning, preview, renaming, and undo operations."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import os
from pathlib import Path
import re
from typing import Any
import uuid

from defusedxml.common import DefusedXmlException
from PIL import ExifTags, Image, UnidentifiedImageError
from xml.etree.ElementTree import ParseError


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}
DATE_FORMATS = {
    "yyyy_mm_dd": "%Y_%m_%d",
    "yyyy-mm-dd": "%Y-%m-%d",
    "yyyymmdd": "%Y%m%d",
}
FIELDS = {"date", "original_name", "original_stem", "extension"}
_INVALID_WINDOWS_NAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_RESERVED_WINDOWS_NAME = re.compile(
    r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$", re.IGNORECASE
)


@dataclass(frozen=True)
class RenameItem:
    original_name: str
    new_name: str | None
    status: str
    reason: str | None = None
    date_source: str | None = None
    source_fingerprint: tuple[int, int, int, int, int] | None = None


@dataclass(frozen=True)
class RenamePlan:
    plan_id: str
    directory: Path
    date_format: str
    components: tuple[dict[str, str], ...]
    items: tuple[RenameItem, ...]

    @property
    def rename_count(self) -> int:
        return sum(item.status == "ready" for item in self.items)


class RenamePlanError(ValueError):
    """Raised when a rename plan cannot be safely applied."""


class RenameExecutionError(RuntimeError):
    """Raised when applying or undoing a plan fails."""


def _is_windows() -> bool:
    return os.name == "nt"


def _move_without_overwrite(source: Path, destination: Path) -> None:
    if _is_windows():
        source.rename(destination)
        return

    os.link(source, destination)
    try:
        source.unlink()
    except OSError as error:
        try:
            destination.unlink()
        except OSError as cleanup_error:
            raise OSError(
                f"{error}; tampoco se pudo retirar el enlace temporal "
                f"{destination.name}: {cleanup_error}"
            ) from error
        raise


def _file_fingerprint(path: Path) -> tuple[int, int, int, int, int]:
    stats = path.stat()
    return (
        stats.st_dev,
        stats.st_ino,
        stats.st_size,
        stats.st_mtime_ns,
        stats.st_ctime_ns,
    )


def _validate_components(components: list[dict[str, str]]) -> tuple[dict[str, str], ...]:
    if not components:
        raise ValueError("Añade al menos un elemento al formato del nombre.")

    normalized: list[dict[str, str]] = []
    for component in components:
        kind = component.get("kind")
        value = component.get("value", "")
        if kind == "field" and isinstance(value, str) and value in FIELDS:
            normalized.append({"kind": "field", "value": value})
        elif kind == "text" and isinstance(value, str) and len(value) <= 64:
            normalized.append({"kind": "text", "value": value})
        else:
            raise ValueError("El formato contiene un elemento no válido.")
    return tuple(normalized)


def _parse_metadata_date(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    for date_format in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, date_format)
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _find_xmp_date(value: Any, preferred_names: tuple[str, ...]) -> tuple[datetime, str] | None:
    if isinstance(value, dict):
        for preferred_name in preferred_names:
            candidate = value.get(preferred_name)
            parsed = _parse_metadata_date(candidate)
            if parsed is not None:
                return parsed, preferred_name
        for child in value.values():
            result = _find_xmp_date(child, preferred_names)
            if result is not None:
                return result
    elif isinstance(value, list):
        for child in value:
            result = _find_xmp_date(child, preferred_names)
            if result is not None:
                return result
    return None


def _read_capture_date(path: Path) -> tuple[datetime, str] | None:
    with Image.open(path) as image:
        exif = image.getexif()
        for tag_name in ("DateTimeOriginal", "DateTimeDigitized", "DateTime"):
            date_tag = next(
                (tag_id for tag_id, name in ExifTags.TAGS.items() if name == tag_name),
                None,
            )
            if date_tag is not None:
                parsed = _parse_metadata_date(exif.get(date_tag))
                if parsed is not None:
                    return parsed, f"EXIF · {tag_name}"

        try:
            xmp = image.getxmp()
        except (ParseError, DefusedXmlException):
            xmp = {}
        xmp_date = _find_xmp_date(
            xmp,
            ("DateTimeOriginal", "DateCreated", "CreateDate", "DateTimeDigitized", "ModifyDate"),
        )
        if xmp_date is not None:
            capture_date, field_name = xmp_date
            return capture_date, f"XMP · {field_name}"

    file_stats = path.stat()
    if file_stats.st_mtime:
        return datetime.fromtimestamp(file_stats.st_mtime), "Archivo · última modificación"
    creation_timestamp = getattr(file_stats, "st_birthtime", None)
    if creation_timestamp is None and os.name == "nt":
        creation_timestamp = getattr(file_stats, "st_ctime", None)
    if creation_timestamp is not None:
        return datetime.fromtimestamp(creation_timestamp), "Archivo · creación"
    return None


def _build_name(
    source: Path,
    capture_date: datetime,
    date_format: str,
    components: tuple[dict[str, str], ...],
) -> str:
    values = {
        "date": capture_date.strftime(DATE_FORMATS[date_format]),
        "original_name": source.name,
        "original_stem": source.stem,
        "extension": source.suffix,
    }
    new_name = "".join(
        values[component["value"]]
        if component["kind"] == "field"
        else component["value"]
        for component in components
    )
    if (
        not new_name
        or new_name in {".", ".."}
        or _INVALID_WINDOWS_NAME.search(new_name)
        or new_name.endswith((" ", "."))
        or _RESERVED_WINDOWS_NAME.match(new_name)
    ):
        raise ValueError("El formato genera un nombre de archivo no válido.")
    return new_name


def create_preview(
    directory: str | Path,
    components: list[dict[str, str]] | None = None,
    date_format: str = "yyyy_mm_dd",
    recursive: bool = False,
) -> RenamePlan:
    folder = Path(directory).expanduser().resolve()
    if not folder.exists() or not folder.is_dir():
        raise ValueError("La carpeta seleccionada no existe o no es una carpeta.")
    if not isinstance(recursive, bool):
        raise ValueError("La opción de incluir subcarpetas no es válida.")
    if date_format not in DATE_FORMATS:
        raise ValueError("El formato de fecha seleccionado no es válido.")

    selected_components = _validate_components(
        components
        if components is not None
        else [
            {"kind": "field", "value": "date"},
            {"kind": "text", "value": "_"},
            {"kind": "field", "value": "original_name"},
        ]
    )
    entries: list[RenameItem] = []
    destinations: dict[str, list[int]] = {}
    paths = list(folder.rglob("*") if recursive else folder.iterdir())
    sources = sorted(
        (path for path in paths if path.is_file()),
        key=lambda path: path.relative_to(folder).as_posix().casefold(),
    )
    existing_names = {
        path.relative_to(folder).as_posix().casefold()
        for path in paths
    }

    for source in sources:
        if source.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue

        relative_name = source.relative_to(folder).as_posix()
        try:
            fingerprint_before = _file_fingerprint(source)
            capture_date_result = _read_capture_date(source)
            fingerprint_after = _file_fingerprint(source)
            if fingerprint_before != fingerprint_after:
                raise OSError("El archivo cambió mientras se analizaba.")
        except (OSError, UnidentifiedImageError, ValueError, Image.DecompressionBombError) as error:
            entries.append(
                RenameItem(
                    relative_name,
                    None,
                    "skipped",
                    f"No se pudieron leer los metadatos: {error}",
                )
            )
            continue
        if capture_date_result is None:
            entries.append(
                RenameItem(
                    relative_name,
                    None,
                    "skipped",
                    "No se encontró una fecha válida en los metadatos ni en el archivo.",
                )
            )
            continue
        capture_date, date_source = capture_date_result

        try:
            new_name = _build_name(source, capture_date, date_format, selected_components)
        except ValueError as error:
            entries.append(RenameItem(relative_name, None, "conflict", str(error), date_source))
            continue

        if new_name == source.name:
            entries.append(
                RenameItem(relative_name, relative_name, "unchanged", date_source=date_source)
            )
            continue

        relative_destination = (source.parent / new_name).relative_to(folder).as_posix()
        destination = relative_destination.casefold()
        entry_index = len(entries)
        entries.append(
            RenameItem(
                relative_name,
                relative_destination,
                "ready",
                date_source=date_source,
                source_fingerprint=fingerprint_after,
            )
        )
        destinations.setdefault(destination, []).append(entry_index)

    for destination_key, indexes in destinations.items():
        if destination_key in existing_names or len(indexes) > 1:
            for index in indexes:
                item = entries[index]
                entries[index] = RenameItem(
                    item.original_name,
                    item.new_name,
                    "conflict",
                    "El nombre de destino ya existe o se repite en la vista previa.",
                    item.date_source,
                    item.source_fingerprint,
                )

    return RenamePlan(
        plan_id=uuid.uuid4().hex,
        directory=folder,
        date_format=date_format,
        components=selected_components,
        items=tuple(entries),
    )


def execute_plan(plan: RenamePlan) -> list[tuple[Path, Path]]:
    """Apply a validated plan; never overwrite a destination that appeared later."""
    ready_items = [item for item in plan.items if item.status == "ready"]
    sources: list[tuple[Path, Path]] = []
    for item in ready_items:
        source = plan.directory / Path(item.original_name)
        destination = plan.directory / Path(str(item.new_name))
        if not source.is_file():
            raise RenamePlanError(f"El archivo ya no existe: {item.original_name}")
        if item.source_fingerprint is not None:
            try:
                source_matches_preview = _file_fingerprint(source) == item.source_fingerprint
            except OSError:
                source_matches_preview = False
            if not source_matches_preview:
                raise RenamePlanError(
                    f"El archivo cambió desde la vista previa: {item.original_name}"
                )
        if destination.exists():
            raise RenamePlanError(
                f"El destino ya existe: {destination.relative_to(plan.directory).as_posix()}"
            )
        sources.append((source, destination))

    renamed: list[tuple[Path, Path]] = []
    try:
        for source, destination in sources:
            _move_without_overwrite(source, destination)
            renamed.append((source, destination))
    except OSError as error:
        rollback_errors: list[str] = []
        for source, destination in reversed(renamed):
            try:
                _move_without_overwrite(destination, source)
            except OSError as rollback_error:
                rollback_errors.append(f"{destination.name}: {rollback_error}")
        detail = f"No se pudo completar el renombrado: {error}"
        if rollback_errors:
            detail += " No se pudieron revertir todos los cambios: " + "; ".join(rollback_errors)
        raise RenameExecutionError(detail) from error
    return renamed


def undo_renames(renamed: list[tuple[Path, Path]]) -> None:
    for original, current in renamed:
        if not current.is_file():
            raise RenamePlanError(f"El archivo renombrado ya no existe: {current.name}")
        if original.exists():
            raise RenamePlanError(f"No se puede deshacer: ya existe {original.name}")

    restored: list[tuple[Path, Path]] = []
    try:
        for original, current in reversed(renamed):
            _move_without_overwrite(current, original)
            restored.append((original, current))
    except OSError as error:
        rollback_errors: list[str] = []
        for original, current in reversed(restored):
            try:
                _move_without_overwrite(original, current)
            except OSError as rollback_error:
                rollback_errors.append(f"{original.name}: {rollback_error}")
        detail = f"No se pudo deshacer el renombrado: {error}"
        if rollback_errors:
            detail += " No se pudieron restaurar todos los nombres: " + "; ".join(rollback_errors)
        raise RenameExecutionError(detail) from error
