"""Loopback-only HTTP service for the browser interface."""

from __future__ import annotations

import json
from pathlib import Path
import platform
import secrets
import subprocess
import sys
from threading import Event, Lock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from .folder_picker import select_windows_folder
from .thumbnails import make_thumbnail
from .renamer import (
    RenameExecutionError,
    RenamePlan,
    RenamePlanError,
    apply_plan,
    create_preview,
    undo_each,
)


WEB_ROOT = Path(__file__).with_name("web")
MAX_REQUEST_SIZE = 64 * 1024
STATIC_IMAGES = {
    "/images/app-icon.png": "image/png",
    "/images/grain.png": "image/png",
    "/images/hero-print.webp": "image/webp",
    "/fonts/fraunces.woff2": "font/woff2",
    "/fonts/fraunces-italic.woff2": "font/woff2",
    "/fonts/instrument-sans.woff2": "font/woff2",
    "/fonts/jetbrains-mono.woff2": "font/woff2",
    "/fonts/dseg7.woff2": "font/woff2",
}


class AppServer(ThreadingHTTPServer):
    # On Windows SO_REUSEADDR lets a second process bind an occupied port; refuse instead.
    allow_reuse_address = sys.platform != "win32"

    def __init__(self, port: int = 0) -> None:
        self.state_lock = Lock()
        self.state: dict[str, Any] = {
            "token": secrets.token_urlsafe(32),
            "plans": {},
            "runs": {},
            "scan": None,
            "apply": None,
            "gallery": {"root": None, "paths": set()},
            # Dates already read, per folder, so a format change does not re-read metadata.
            "date_cache": {"root": None, "dates": {}},
        }
        super().__init__(("127.0.0.1", port), AppRequestHandler)


class AppRequestHandler(BaseHTTPRequestHandler):
    server: AppServer

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[PhotoDateRenamer] {self.address_string()} - {format % args}")

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def _host_is_local(self) -> bool:
        expected = f"127.0.0.1:{self.server.server_port}"
        return self.headers.get("Host", "").lower() in {
            expected,
            f"localhost:{self.server.server_port}",
        }

    def _send_json(self, status: int, data: dict[str, Any]) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _send_text(
        self,
        status: int,
        payload: str,
        content_type: str,
        csp_nonce: str | None = None,
    ) -> None:
        body = payload.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if csp_nonce is not None:
            self.send_header(
                "Content-Security-Policy",
                "default-src 'none'; "
                f"script-src 'self' 'nonce-{csp_nonce}'; "
                "style-src 'self'; img-src 'self' blob:; font-src 'self'; connect-src 'self'; "
                "form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'",
            )
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("La petición no tiene una longitud válida.") from error
        if length <= 0 or length > MAX_REQUEST_SIZE:
            raise ValueError("El tamaño de la petición no es válido.")
        try:
            result = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("El contenido de la petición no es JSON válido.") from error
        if not isinstance(result, dict):
            raise ValueError("El contenido de la petición debe ser un objeto JSON.")
        return result

    def _authorized(self) -> bool:
        if not self._host_is_local():
            return False
        origin = self.headers.get("Origin")
        expected_origin = f"http://{self.headers.get('Host', '')}"
        return (
            self.headers.get("X-PhotoDateRenamer-Token") == self.server.state["token"]
            and (origin is None or origin == expected_origin)
        )

    def do_GET(self) -> None:
        if not self._host_is_local():
            self.send_error(403)
            return
        path = urlparse(self.path).path
        if path == "/":
            html = (WEB_ROOT / "index.html").read_text(encoding="utf-8")
            html = html.replace("__APP_TOKEN__", self.server.state["token"])
            self._send_text(
                200,
                html,
                "text/html; charset=utf-8",
                csp_nonce=self.server.state["token"],
            )
            return
        if path in {"/app.js", "/helpers.js", "/styles.css"}:
            content_type = "text/javascript; charset=utf-8" if path.endswith(".js") else "text/css; charset=utf-8"
            self._send_text(200, (WEB_ROOT / path.lstrip("/")).read_text(encoding="utf-8"), content_type)
            return
        if path in STATIC_IMAGES:
            payload = (WEB_ROOT / path.lstrip("/")).read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", STATIC_IMAGES[path])
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "public, max-age=3600")
            self.end_headers()
            self.wfile.write(payload)
            return
        if path == "/api/health":
            self._send_json(200, {"status": "ok"})
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if not self._authorized():
            self.send_error(403)
            return
        try:
            payload = self._read_json()
            path = urlparse(self.path).path
            if path == "/api/select-folder":
                self._send_json(200, self._select_folder())
            elif path == "/api/thumbnail":
                self._thumbnail(payload)
            elif path == "/api/check-folder":
                self._check_folder(payload)
            elif path == "/api/preview":
                self._preview(payload)
            elif path == "/api/progress":
                self._progress(payload)
            elif path == "/api/cancel":
                self._cancel(payload)
            elif path == "/api/apply-progress":
                self._apply_progress(payload)
            elif path == "/api/confirm":
                self._confirm(payload)
            elif path == "/api/undo":
                self._undo(payload)
            elif path == "/api/last-run":
                self._last_run()
            else:
                self.send_error(404)
        except RenamePlanError as error:
            self._send_json(409, {"error": str(error)})
        except ValueError as error:
            self._send_json(400, {"error": str(error)})
        except RenameExecutionError as error:
            self._send_json(500, {"error": str(error)})

    def _select_folder(self) -> dict[str, str]:
        if platform.system() == "Windows":
            try:
                return {"folder": select_windows_folder()}
            except OSError as error:
                raise ValueError(f"No se pudo abrir el selector de carpetas: {error}") from error

        try:
            result = subprocess.run(
                [sys.executable, "-m", "photodaterenamer.folder_picker"],
                capture_output=True,
                check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                text=True,
            )
        except OSError as error:
            raise ValueError(f"No se pudo abrir el selector de carpetas: {error}") from error
        if result.returncode != 0:
            detail = result.stderr.strip() or "el selector terminó con un error."
            raise ValueError(f"No se pudo abrir el selector de carpetas: {detail}")
        return {"folder": result.stdout.strip()}

    def _thumbnail(self, payload: dict[str, Any]) -> None:
        relative = payload.get("path")
        size = payload.get("size", 96)
        if not isinstance(relative, str) or not isinstance(size, int):
            raise ValueError("La petición de miniatura no es válida.")
        with self.server.state_lock:
            gallery = self.server.state["gallery"]
            root = gallery["root"]
            allowed = root is not None and relative in gallery["paths"]
        if not allowed:
            raise ValueError("Esa imagen no forma parte de la carpeta analizada.")
        data = make_thumbnail(root / Path(relative), size)
        if data is None:
            self.send_response(204)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _check_folder(self, payload: dict[str, Any]) -> None:
        folder = payload.get("folder")
        if not isinstance(folder, str) or not folder.strip():
            self._send_json(200, {"ok": False, "error": "Escribe la ruta de una carpeta."})
            return
        try:
            resolved = Path(folder.strip()).expanduser().resolve()
            exists = resolved.is_dir()
        except (OSError, RuntimeError, ValueError):
            exists = False
        if not exists:
            self._send_json(
                200,
                {"ok": False, "error": "La carpeta seleccionada no existe o no es una carpeta."},
            )
            return
        self._send_json(200, {"ok": True, "folder": str(resolved)})

    def _preview(self, payload: dict[str, Any]) -> None:
        folder = payload.get("folder")
        components = payload.get("components")
        date_format = payload.get("date_format", "yyyy_mm_dd")
        recursive = payload.get("recursive", False)
        if not isinstance(folder, str) or not folder.strip():
            raise ValueError("Selecciona una carpeta antes de crear la vista previa.")
        if components is not None and (
            not isinstance(components, list)
            or any(not isinstance(item, dict) for item in components)
        ):
            raise ValueError("El formato personalizado no es válido.")
        if not isinstance(date_format, str):
            raise ValueError("El formato de fecha no es válido.")
        if not isinstance(recursive, bool):
            raise ValueError("La opción de incluir subcarpetas no es válida.")

        scan_id = payload.get("scan_id")
        if scan_id is None:
            scan_id = secrets.token_urlsafe(18)
        if not isinstance(scan_id, str) or not scan_id or len(scan_id) > 128:
            raise ValueError("El identificador del análisis no es válido.")
        cancellation_event = Event()
        with self.server.state_lock:
            current_scan = self.server.state["scan"]
            if current_scan is not None and not current_scan["completed"]:
                raise ValueError("Ya hay un análisis en curso.")
            self.server.state["scan"] = {
                "scan_id": scan_id,
                "event": cancellation_event,
                "phase": "starting",
                "completed": False,
                "scanned": 0,
                "total": None,
                "cancelled": False,
            }

        def update_progress(phase: str, scanned: int, total: int | None) -> None:
            with self.server.state_lock:
                active_scan = self.server.state["scan"]
                if active_scan is not None and active_scan["scan_id"] == scan_id:
                    active_scan.update(phase=phase, scanned=scanned, total=total)

        resolved_folder = Path(folder.strip()).expanduser().resolve()
        with self.server.state_lock:
            cache = self.server.state["date_cache"]
            if cache["root"] != resolved_folder or len(cache["dates"]) > 200_000:
                cache = {"root": resolved_folder, "dates": {}}
                self.server.state["date_cache"] = cache
        try:
            plan = create_preview(
                folder,
                components,
                date_format,
                recursive,
                progress_callback=update_progress,
                cancellation_event=cancellation_event,
                date_cache=cache["dates"],
            )
        except RenamePlanError:
            if not cancellation_event.is_set():
                raise
            self._send_json(200, {"cancelled": True, "scan_id": scan_id})
            return
        finally:
            with self.server.state_lock:
                active_scan = self.server.state["scan"]
                if active_scan is not None and active_scan["scan_id"] == scan_id:
                    active_scan["completed"] = True
                    active_scan["cancelled"] = cancellation_event.is_set()

        self.server.state["plans"].clear()
        self.server.state["plans"][plan.plan_id] = plan
        with self.server.state_lock:
            self.server.state["gallery"] = {
                "root": plan.directory,
                "paths": {item.original_name for item in plan.items},
            }
        self._send_json(
            200,
            {
                "plan_id": plan.plan_id,
                "folder": str(plan.directory),
                "folder_name": plan.directory.name or str(plan.directory),
                "scan_id": scan_id,
                "entry_count": plan.entry_count,
                "rename_count": plan.rename_count,
                "items": [
                    {
                        "original_name": item.original_name,
                        "new_name": item.new_name,
                        "status": item.status,
                        "reason": item.reason,
                        "date_source": item.date_source,
                        "date_text": item.date_text,
                    }
                    for item in plan.items
                ],
            },
        )

    def _progress(self, payload: dict[str, Any]) -> None:
        scan_id = payload.get("scan_id")
        with self.server.state_lock:
            scan = self.server.state["scan"]
            if scan is None or scan["scan_id"] != scan_id:
                progress = {
                    "scan_id": scan_id,
                    "phase": "pending",
                    "completed": False,
                    "scanned": 0,
                    "total": None,
                    "cancelled": False,
                }
            else:
                progress = {
                    key: scan[key]
                    for key in ("scan_id", "phase", "completed", "scanned", "total", "cancelled")
                }
        self._send_json(200, progress)

    def _cancel(self, payload: dict[str, Any]) -> None:
        scan_id = payload.get("scan_id")
        with self.server.state_lock:
            scan = self.server.state["scan"]
            if scan is None or scan["scan_id"] != scan_id or scan["completed"]:
                cancelled = False
            else:
                scan["event"].set()
                cancelled = True
        if cancelled:
            self._send_json(200, {"cancelled": True})
        else:
            self._send_json(200, {"cancelled": False, "reason": "El análisis ya terminó o no existe."})

    def _confirm(self, payload: dict[str, Any]) -> None:
        plan_id = payload.get("plan_id")
        if not isinstance(plan_id, str):
            raise ValueError("El identificador de vista previa no es válido.")
        plan = self.server.state["plans"].get(plan_id)
        if not isinstance(plan, RenamePlan):
            raise ValueError("La vista previa ha caducado. Genera una nueva antes de continuar.")
        with self.server.state_lock:
            current_apply = self.server.state["apply"]
            if current_apply is not None and not current_apply["completed"]:
                raise ValueError("Ya se están aplicando cambios.")
            if self.server.state["plans"].pop(plan_id, None) is None:
                raise ValueError("La vista previa ya se aplicó o ha caducado.")
            self.server.state["apply"] = {
                "plan_id": plan_id,
                "completed": False,
                "done": 0,
                "total": plan.rename_count,
            }

        def update_progress(_phase: str, done: int, total: int | None) -> None:
            with self.server.state_lock:
                self.server.state["apply"].update(done=done, total=total)

        # The undo record is kept as files move, so even an interrupted batch can be undone.
        run = {"root": plan.directory, "pairs": []}
        with self.server.state_lock:
            self.server.state["runs"].clear()

        def remember(source: Path, destination: Path) -> None:
            with self.server.state_lock:
                run["pairs"].append((source, destination))
                self.server.state["runs"][plan_id] = run

        try:
            result = apply_plan(plan, progress_callback=update_progress, on_renamed=remember)
        finally:
            with self.server.state_lock:
                self.server.state["apply"]["completed"] = True
        renamed = list(result.renamed)
        with self.server.state_lock:
            gallery = self.server.state["gallery"]
            if gallery["root"] == plan.directory:
                gallery["paths"].update(
                    new.relative_to(plan.directory).as_posix() for _, new in renamed
                )
        self._send_json(
            200,
            {
                "run_id": plan_id if renamed else None,
                "renamed_count": len(renamed),
                "failed_count": len(result.failures),
                "renamed": [
                    {
                        "old_name": old.relative_to(plan.directory).as_posix(),
                        "new_name": new.relative_to(plan.directory).as_posix(),
                    }
                    for old, new in renamed
                ],
                "failures": [
                    {
                        "original_name": failure.original_name,
                        "new_name": failure.new_name,
                        "reason": failure.reason,
                    }
                    for failure in result.failures
                ],
            },
        )

    def _last_run(self) -> None:
        """The batch that can still be undone, so the interface never loses it."""
        with self.server.state_lock:
            run_id, run = next(iter(self.server.state["runs"].items()), (None, None))
            count = len(run["pairs"]) if run is not None else 0
            root = run["root"] if run is not None else None
        if not count or root is None:
            self._send_json(200, {"run_id": None})
            return
        self._send_json(
            200,
            {
                "run_id": run_id,
                "count": count,
                "folder": str(root),
                "folder_name": root.name or str(root),
            },
        )

    def _apply_progress(self, payload: dict[str, Any]) -> None:
        plan_id = payload.get("plan_id")
        with self.server.state_lock:
            current = self.server.state["apply"]
            if current is None or current["plan_id"] != plan_id:
                progress = {"plan_id": plan_id, "completed": False, "done": 0, "total": None}
            else:
                progress = dict(current)
        self._send_json(200, progress)

    def _undo(self, payload: dict[str, Any]) -> None:
        run_id = payload.get("run_id")
        if not isinstance(run_id, str):
            raise ValueError("El identificador del renombrado no es válido.")
        with self.server.state_lock:
            run = self.server.state["runs"].get(run_id)
            current_apply = self.server.state["apply"]
            if current_apply is not None and not current_apply["completed"]:
                raise ValueError("Espera a que terminen de aplicarse los cambios.")
        if run is None:
            raise ValueError("No hay un renombrado disponible para deshacer.")
        root = run["root"]
        result = undo_each(list(run["pairs"]))
        pending = [(failure.original, failure.current) for failure in result.failures]
        with self.server.state_lock:
            if pending:
                run["pairs"] = pending
            else:
                self.server.state["runs"].pop(run_id, None)

        def relative(path: Path) -> str:
            if root is not None:
                try:
                    return path.relative_to(root).as_posix()
                except ValueError:
                    pass
            return path.name

        self._send_json(
            200,
            {
                "run_id": run_id if pending else None,
                "folder": str(root),
                "restored_count": len(result.restored),
                "failed_count": len(result.failures),
                "failures": [
                    {
                        "original_name": relative(failure.original),
                        "current_name": relative(failure.current),
                        "reason": failure.reason,
                    }
                    for failure in result.failures
                ],
            },
        )
