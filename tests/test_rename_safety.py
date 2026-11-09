"""Data-safety tests for applying a rename plan.

Every test builds its own photos inside a temporary folder. Nothing outside that folder is
read or modified.
"""

from __future__ import annotations

import ctypes
import hashlib
import io
import os
from pathlib import Path
import stat
import tempfile
import unittest

from PIL import Image

from photodaterenamer.renamer import (
    apply_plan,
    create_preview,
    undo_each,
    undo_renames,
)


def jpeg_bytes(capture_date: str = "2024:05:06 07:08:09", color: str = "olive") -> bytes:
    image = Image.new("RGB", (4, 4), color=color)
    exif = Image.Exif()
    exif[36867] = capture_date
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif)
    return buffer.getvalue()


def snapshot(folder: Path) -> dict[str, str]:
    """Map each file's relative path to a hash of its content."""
    return {
        path.relative_to(folder).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(folder.rglob("*"))
        if path.is_file()
    }


def set_windows_hidden(path: Path) -> None:
    ctypes.windll.kernel32.SetFileAttributesW(str(path), 0x2)


def windows_attributes(path: Path) -> int:
    return ctypes.windll.kernel32.GetFileAttributesW(str(path))


class RenameSafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary_directory.name)

    def tearDown(self) -> None:
        for path in self.folder.rglob("*"):
            os.chmod(path, stat.S_IWRITE | stat.S_IREAD | stat.S_IEXEC)
        self.temporary_directory.cleanup()

    def write(self, relative_path: str, content: bytes | None = None) -> Path:
        path = self.folder / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content if content is not None else jpeg_bytes())
        return path

    def assert_same_contents(self, before: dict[str, str], after: dict[str, str]) -> None:
        """No file was lost, duplicated, or modified: the multiset of contents is equal."""
        self.assertEqual(sorted(before.values()), sorted(after.values()))

    def test_empty_folder_produces_an_empty_plan_and_changes_nothing(self) -> None:
        plan = create_preview(self.folder)
        result = apply_plan(plan)

        self.assertEqual(plan.items, ())
        self.assertEqual(plan.entry_count, 0)
        self.assertEqual(result.renamed, ())
        self.assertEqual(result.failures, ())
        self.assertEqual(list(self.folder.iterdir()), [])

    def test_folder_without_photos_reports_its_entries_but_no_items(self) -> None:
        self.write("notas.txt", b"hola")
        self.write("video.MP4", b"x")

        plan = create_preview(self.folder)

        self.assertEqual(plan.items, ())
        self.assertEqual(plan.entry_count, 2)

    def test_accents_spaces_symbols_and_uppercase_extensions_round_trip(self) -> None:
        names = [
            "Árbol niño.JPG",
            "foto con  dos espacios.jpeg",
            "símbolos #&@!(1)+[2]{3}~'.PNG",
            "çà ü ø.TIFF",
            "mezcla.TiF",
        ]
        for index, name in enumerate(names):
            self.write(name, jpeg_bytes(color=("red", "green", "blue", "white", "black")[index]))
        before = snapshot(self.folder)

        plan = create_preview(self.folder)
        result = apply_plan(plan)

        self.assertEqual(result.failures, ())
        self.assertEqual(len(result.renamed), len(names))
        self.assertEqual(
            sorted(path.name for path in self.folder.iterdir()),
            sorted(f"2024_05_06_{name}" for name in names),
        )
        self.assert_same_contents(before, snapshot(self.folder))

        undo_renames(list(result.renamed))

        self.assertEqual(snapshot(self.folder), before)

    def test_cached_dates_produce_exactly_the_same_plan(self) -> None:
        for index, name in enumerate(["Árbol niño.JPG", "b.png", "sub/c.jpg", "IMG_0001.jpg"]):
            self.write(name, jpeg_bytes(f"2023:0{index + 1}:15 10:00:00"))
        self.write("sin_fecha.jpg", bytes([0xFF, 0xD8]) + b" roto")
        self.write("IMG_0001_copia.jpg", jpeg_bytes("2023:04:15 10:00:00"))
        components = [
            {"kind": "field", "value": "original_stem"},
            {"kind": "text", "value": "-"},
            {"kind": "field", "value": "date"},
            {"kind": "field", "value": "extension"},
        ]
        cache: dict = {}

        def summary(plan):
            return [(i.original_name, i.new_name, i.status, i.reason, i.date_source, i.date_text) for i in plan.items]

        fresh = create_preview(self.folder, components, "yyyy-mm-dd", True)
        create_preview(self.folder, None, "yyyymmdd", True, date_cache=cache)
        cached = create_preview(self.folder, components, "yyyy-mm-dd", True, date_cache=cache)

        self.assertTrue(cache)
        self.assertEqual(summary(cached), summary(fresh))

    def test_apply_reports_each_rename_as_it_happens(self) -> None:
        for name in ("a.jpg", "b.jpg"):
            self.write(name)
        plan = create_preview(self.folder)
        seen: list[tuple[str, str]] = []

        result = apply_plan(plan, on_renamed=lambda old, new: seen.append((old.name, new.name)))

        self.assertEqual(seen, [(old.name, new.name) for old, new in result.renamed])
        self.assertEqual(len(seen), 2)

    def test_colliding_destinations_are_never_renamed_or_overwritten(self) -> None:
        self.write("uno.jpg", jpeg_bytes(color="red"))
        self.write("dos.jpg", jpeg_bytes(color="blue"))
        before = snapshot(self.folder)
        same_name = [{"kind": "field", "value": "date"}, {"kind": "text", "value": ".jpg"}]

        plan = create_preview(self.folder, same_name)
        result = apply_plan(plan)

        self.assertEqual([item.status for item in plan.items], ["conflict", "conflict"])
        self.assertEqual(result.renamed, ())
        self.assertEqual(snapshot(self.folder), before)

    def test_destination_appearing_after_preview_is_reported_and_the_rest_continue(self) -> None:
        self.write("a.jpg", jpeg_bytes(color="red"))
        self.write("b.jpg", jpeg_bytes(color="green"))
        self.write("c.jpg", jpeg_bytes(color="blue"))
        plan = create_preview(self.folder)
        intruder = self.write("2024_05_06_b.jpg", b"no me sobrescribas")
        before = snapshot(self.folder)

        result = apply_plan(plan)

        self.assertEqual(len(result.renamed), 2)
        self.assertEqual([failure.original_name for failure in result.failures], ["b.jpg"])
        self.assertIn("ya existe", result.failures[0].reason.lower())
        self.assertEqual(intruder.read_bytes(), b"no me sobrescribas")
        self.assertTrue((self.folder / "b.jpg").exists())
        self.assert_same_contents(before, snapshot(self.folder))

    def test_source_changed_after_preview_is_reported_and_not_renamed(self) -> None:
        changed = self.write("a.jpg")
        self.write("b.jpg", jpeg_bytes(color="blue"))
        plan = create_preview(self.folder)
        changed.write_bytes(jpeg_bytes(color="white") + b"extra")

        result = apply_plan(plan)

        self.assertEqual([failure.original_name for failure in result.failures], ["a.jpg"])
        self.assertTrue(changed.exists())
        self.assertTrue((self.folder / "2024_05_06_b.jpg").exists())

    def test_read_only_file_is_renamed_without_modifying_its_content(self) -> None:
        protected = self.write("solo_lectura.jpg", jpeg_bytes(color="red"))
        self.write("normal.jpg", jpeg_bytes(color="blue"))
        os.chmod(protected, stat.S_IREAD)
        before = snapshot(self.folder)

        result = apply_plan(create_preview(self.folder))

        self.assertEqual(result.failures, ())
        renamed = self.folder / "2024_05_06_solo_lectura.jpg"
        self.assertTrue(renamed.exists())
        self.assertFalse(os.access(renamed, os.W_OK))
        self.assert_same_contents(before, snapshot(self.folder))

    @unittest.skipUnless(os.name == "nt", "Windows locks open files against renaming")
    def test_locked_file_failure_is_reported_without_aborting_the_rest(self) -> None:
        for name in ("a.jpg", "b.jpg", "c.jpg"):
            self.write(name, jpeg_bytes(color={"a.jpg": "red", "b.jpg": "green"}.get(name, "blue")))
        plan = create_preview(self.folder)
        before = snapshot(self.folder)

        with open(self.folder / "b.jpg", "rb"):
            result = apply_plan(plan)

        self.assertEqual(
            sorted(destination.name for _, destination in result.renamed),
            ["2024_05_06_a.jpg", "2024_05_06_c.jpg"],
        )
        self.assertEqual([failure.original_name for failure in result.failures], ["b.jpg"])
        self.assertTrue(result.failures[0].reason)
        self.assertTrue((self.folder / "b.jpg").exists())
        self.assert_same_contents(before, snapshot(self.folder))

    @unittest.skipIf(os.name == "nt" or os.geteuid() == 0, "needs POSIX directory permissions")
    def test_locked_directory_failure_is_reported_without_aborting_the_rest(self) -> None:
        self.write("libre.jpg", jpeg_bytes(color="red"))
        self.write("bloqueada/foto.jpg", jpeg_bytes(color="blue"))
        plan = create_preview(self.folder, recursive=True)
        before = snapshot(self.folder)
        os.chmod(self.folder / "bloqueada", stat.S_IREAD | stat.S_IEXEC)

        result = apply_plan(plan)

        self.assertEqual([failure.original_name for failure in result.failures], ["bloqueada/foto.jpg"])
        self.assertEqual(len(result.renamed), 1)
        self.assert_same_contents(before, snapshot(self.folder))

    def test_long_names_are_renamed_and_overlong_results_are_conflicts(self) -> None:
        long_stem = "ñ" * 120 + " recuerdo"
        self.write(f"{long_stem}.jpg")
        self.write("corta.jpg", jpeg_bytes(color="blue"))
        overlong = [{"kind": "text", "value": "x" * 64}] * 4 + [
            {"kind": "field", "value": "original_name"}
        ]

        conflict_plan = create_preview(self.folder, overlong)

        self.assertTrue(all(item.status == "conflict" for item in conflict_plan.items))
        self.assertTrue(all("255" in str(item.reason) for item in conflict_plan.items))
        self.assertEqual(apply_plan(conflict_plan).renamed, ())

        result = apply_plan(create_preview(self.folder))

        self.assertEqual(result.failures, ())
        self.assertTrue((self.folder / f"2024_05_06_{long_stem}.jpg").exists())

    def test_hidden_files_are_handled_like_any_other_photo(self) -> None:
        self.write(".oculta.jpg")
        hidden = self.write("atributo_oculto.jpg", jpeg_bytes(color="blue"))
        if os.name == "nt":
            set_windows_hidden(hidden)
        before = snapshot(self.folder)

        plan = create_preview(self.folder)
        result = apply_plan(plan)

        self.assertEqual(
            sorted(item.original_name for item in plan.items),
            [".oculta.jpg", "atributo_oculto.jpg"],
        )
        self.assertEqual(result.failures, ())
        self.assert_same_contents(before, snapshot(self.folder))
        if os.name == "nt":
            self.assertTrue(
                windows_attributes(self.folder / "2024_05_06_atributo_oculto.jpg") & 0x2
            )

    def test_thousands_of_files_are_renamed_and_undone_without_loss(self) -> None:
        payload = jpeg_bytes()
        for index in range(2500):
            self.write(f"IMG_{index:05d}.jpg", payload + index.to_bytes(4, "big"))
        before = snapshot(self.folder)
        progress: list[tuple[str, int, int | None]] = []

        plan = create_preview(self.folder)
        result = apply_plan(plan, progress_callback=lambda *values: progress.append(values))

        self.assertEqual(plan.rename_count, 2500)
        self.assertEqual(len(result.renamed), 2500)
        self.assertEqual(result.failures, ())
        self.assertEqual(progress[0], ("applying", 0, 2500))
        self.assertEqual(progress[-1], ("applying", 2500, 2500))
        self.assert_same_contents(before, snapshot(self.folder))

        undo_renames(list(result.renamed))

        self.assertEqual(snapshot(self.folder), before)

    @unittest.skipUnless(os.name == "nt", "Windows locks open files against renaming")
    def test_undo_reports_a_locked_file_restores_the_rest_and_can_be_retried(self) -> None:
        for name in ("a.jpg", "b.jpg", "c.jpg"):
            self.write(name, jpeg_bytes(color={"a.jpg": "red", "b.jpg": "green"}.get(name, "blue")))
        before = snapshot(self.folder)
        result = apply_plan(create_preview(self.folder))

        with open(self.folder / "2024_05_06_b.jpg", "rb"):
            undo = undo_each(list(result.renamed))

        self.assertEqual(len(undo.restored), 2)
        self.assertEqual([failure.current.name for failure in undo.failures], ["2024_05_06_b.jpg"])
        self.assertTrue(undo.failures[0].reason)
        self.assert_same_contents(before, snapshot(self.folder))

        retry = undo_each([(failure.original, failure.current) for failure in undo.failures])

        self.assertEqual(retry.failures, ())
        self.assertEqual(snapshot(self.folder), before)

    def test_undo_never_overwrites_a_file_that_took_the_original_name(self) -> None:
        self.write("a.jpg", jpeg_bytes(color="red"))
        result = apply_plan(create_preview(self.folder))
        self.write("a.jpg", b"nuevo archivo con el nombre antiguo")
        before = snapshot(self.folder)

        undo = undo_each(list(result.renamed))

        self.assertEqual(undo.restored, ())
        self.assertIn("nombre original", undo.failures[0].reason)
        self.assertEqual(snapshot(self.folder), before)

    def test_apply_never_deletes_or_overwrites_any_file(self) -> None:
        for index in range(20):
            self.write(f"f{index:02d}.jpg", jpeg_bytes(color="red") + bytes([index]))
        plan = create_preview(self.folder)
        for index in range(0, 20, 3):
            self.write(f"2024_05_06_f{index:02d}.jpg", b"intruso")
        before = snapshot(self.folder)

        result = apply_plan(plan)

        self.assertEqual(len(result.failures), 7)
        self.assertEqual(len(result.renamed), 13)
        self.assert_same_contents(before, snapshot(self.folder))


if __name__ == "__main__":
    unittest.main()
