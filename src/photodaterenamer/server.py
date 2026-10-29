"""Loopback-only HTTP service for the browser interface."""

from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
import platform
import secrets
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from .folder_picker import select_windows_folder
from .renamer import (
    RenameExecutionError,
    RenamePlan,
    RenamePlanError,
    create_preview,
    execute_plan,
    undo_renames,
)


WEB_ROOT = Path(__file__).with_name("web")
MAX_REQUEST_SIZE = 64 * 1024
STATIC_IMAGES = {
    "/images/app-icon.png": "image/png",
    "/images/hero-illustration.png": "image/png",
}


class AppServer(ThreadingHTTPServer):
    def __init__(self) -> None:
        self.state: dict[str, Any] = {
            "token": secrets.token_urlsafe(32),
            "plans": {},
            "runs": {},
        }
        super().__init__(("127.0.0.1", 0), AppRequestHandler)


class AppRequestHandler(BaseHTTPRequestHandler):
    server: AppServer

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[PhotoDateRenamer] {self.address_string()} - {format % args}")

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

    def _send_text(self, status: int, payload: str, content_type: str) -> None:
        body = payload.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
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
            self._send_text(200, html, "text/html; charset=utf-8")
            return
        if path in {"/app.js", "/styles.css"}:
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
            elif path == "/api/preview":
                self._preview(payload)
            elif path == "/api/confirm":
                self._confirm(payload)
            elif path == "/api/undo":
                self._undo(payload)
            else:
                self.send_error(404)
        except ValueError as error:
            self._send_json(400, {"error": str(error)})
        except RenamePlanError as error:
            self._send_json(409, {"error": str(error)})
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

        plan = create_preview(folder, components, date_format, recursive)
        self.server.state["plans"].clear()
        self.server.state["plans"][plan.plan_id] = plan
        self._send_json(
            200,
            {
                "plan_id": plan.plan_id,
                "folder": str(plan.directory),
                "rename_count": plan.rename_count,
                "items": [asdict(item) for item in plan.items],
            },
        )

    def _confirm(self, payload: dict[str, Any]) -> None:
        plan_id = payload.get("plan_id")
        if not isinstance(plan_id, str):
            raise ValueError("El identificador de vista previa no es válido.")
        plan = self.server.state["plans"].get(plan_id)
        if not isinstance(plan, RenamePlan):
            raise ValueError("La vista previa ha caducado. Genera una nueva antes de continuar.")
        renamed = execute_plan(plan)
        self.server.state["plans"].pop(plan_id, None)
        self.server.state["runs"].clear()
        self.server.state["runs"][plan_id] = renamed
        self._send_json(
            200,
            {
                "run_id": plan_id,
                "renamed_count": len(renamed),
                "renamed": [{"old_name": old.name, "new_name": new.name} for old, new in renamed],
            },
        )

    def _undo(self, payload: dict[str, Any]) -> None:
        run_id = payload.get("run_id")
        if not isinstance(run_id, str):
            raise ValueError("El identificador del renombrado no es válido.")
        renamed = self.server.state["runs"].get(run_id)
        if renamed is None:
            raise ValueError("No hay un renombrado disponible para deshacer.")
        undo_renames(renamed)
        self.server.state["runs"].pop(run_id, None)
        self._send_json(200, {"restored_count": len(renamed)})
