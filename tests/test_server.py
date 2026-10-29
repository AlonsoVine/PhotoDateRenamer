import json
from pathlib import Path
from subprocess import CompletedProcess
import re
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch
from typing import Any

from PIL import Image

from photodaterenamer.renamer import create_preview as run_create_preview
from photodaterenamer.server import AppServer


class LocalServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary_directory.name)
        self.server = AppServer()
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"
        with urlopen(f"{self.base_url}/") as response:
            page = response.read().decode("utf-8")
        self.token = re.search(r'window\.PDR_TOKEN = "([^"]+)"', page).group(1)

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self.temporary_directory.cleanup()

    def post(self, path: str, payload: dict[str, object], token: str | None = None) -> dict:
        request = Request(
            f"{self.base_url}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Origin": self.base_url,
                "X-PhotoDateRenamer-Token": token if token is not None else self.token,
            },
        )
        with urlopen(request) as response:
            return json.loads(response.read())

    def test_serves_browser_assets_and_limits_api_to_authorized_origin(self) -> None:
        with urlopen(f"{self.base_url}/styles.css") as response:
            stylesheet = response.read().decode("utf-8")
        self.assertIn("--paper:", stylesheet)

        with urlopen(f"{self.base_url}/") as response:
            page = response.read().decode("utf-8")
            self.assertEqual(response.headers.get("X-Content-Type-Options"), "nosniff")
            self.assertEqual(response.headers.get("Referrer-Policy"), "no-referrer")
            policy = response.headers.get("Content-Security-Policy") or ""
        self.assertIn('href="/images/app-icon.png"', page)
        self.assertIn(f"nonce-{self.token}", policy)
        self.assertNotIn("unsafe-inline", policy)
        self.assertIn('src="/images/hero-illustration.png"', page)
        self.assertIn("Creado por Alonso Viñé", page)
        self.assertIn('id="operation-progress"', page)
        self.assertIn('id="preview-pagination"', page)
        for image_path in ("/images/app-icon.png", "/images/hero-illustration.png"):
            with urlopen(f"{self.base_url}{image_path}") as response:
                self.assertEqual(response.headers.get_content_type(), "image/png")
                self.assertTrue(response.read().startswith(b"\x89PNG\r\n\x1a\n"))

        with self.assertRaises(HTTPError) as error:
            self.post("/api/preview", {"folder": str(self.folder)}, token="incorrect")
        self.assertEqual(error.exception.code, 403)
        error.exception.close()

    def test_preview_confirm_and_undo_over_http(self) -> None:
        image_path = self.folder / "IMG_001.jpg"
        image = Image.new("RGB", (4, 4), color="olive")
        exif = Image.Exif()
        exif[36867] = "2024:05:06 07:08:09"
        image.save(image_path, exif=exif)

        preview = self.post("/api/preview", {"folder": str(self.folder)})
        self.assertEqual(preview["rename_count"], 1)
        self.assertEqual(preview["items"][0]["new_name"], "2024_05_06_IMG_001.jpg")

        result = self.post("/api/confirm", {"plan_id": preview["plan_id"]})
        renamed_path = self.folder / "2024_05_06_IMG_001.jpg"
        self.assertTrue(renamed_path.exists())
        self.assertEqual(result["renamed_count"], 1)

        undo = self.post("/api/undo", {"run_id": result["run_id"]})
        self.assertTrue(image_path.exists())
        self.assertEqual(undo["restored_count"], 1)

    def test_preview_can_include_subfolders(self) -> None:
        nested_folder = self.folder / "vacaciones"
        nested_folder.mkdir()
        image_path = nested_folder / "IMG_001.jpg"
        image = Image.new("RGB", (4, 4), color="olive")
        exif = Image.Exif()
        exif[36867] = "2024:05:06 07:08:09"
        image.save(image_path, exif=exif)

        preview = self.post(
            "/api/preview",
            {"folder": str(self.folder), "recursive": True},
        )

        self.assertEqual(preview["rename_count"], 1)
        self.assertEqual(
            preview["items"][0]["new_name"],
            "vacaciones/2024_05_06_IMG_001.jpg",
        )

    def test_preview_rejects_non_boolean_recursive_option(self) -> None:
        with self.assertRaises(HTTPError) as error:
            self.post("/api/preview", {"folder": str(self.folder), "recursive": "yes"})
        self.assertEqual(error.exception.code, 400)
        error.exception.close()

    def test_preview_progress_is_available_and_does_not_expose_fingerprints(self) -> None:
        image_path = self.folder / "IMG_001.jpg"
        image = Image.new("RGB", (4, 4), color="olive")
        exif = Image.Exif()
        exif[36867] = "2024:05:06 07:08:09"
        image.save(image_path, exif=exif)

        preview = self.post(
            "/api/preview",
            {"folder": str(self.folder), "scan_id": "test-scan"},
        )
        progress = self.post("/api/progress", {"scan_id": "test-scan"})

        self.assertTrue(progress["completed"])
        self.assertEqual(progress["phase"], "scanning")
        self.assertEqual(progress["scanned"], 1)
        self.assertEqual(progress["total"], 1)
        self.assertNotIn("source_fingerprint", preview["items"][0])

    def test_scan_can_be_cancelled_over_http(self) -> None:
        started = threading.Event()
        errors: list[int] = []

        def wait_until_cancelled(*args: Any, **kwargs: Any) -> Any:
            started.set()
            kwargs["cancellation_event"].wait(timeout=3)
            return run_create_preview(*args, **kwargs)

        def request_preview() -> None:
            try:
                self.post(
                    "/api/preview",
                    {"folder": str(self.folder), "scan_id": "cancel-scan"},
                )
            except HTTPError as error:
                errors.append(error.code)
                error.close()

        with patch("photodaterenamer.server.create_preview", side_effect=wait_until_cancelled):
            preview_thread = threading.Thread(target=request_preview)
            preview_thread.start()
            self.assertTrue(started.wait(timeout=2))
            result = self.post("/api/cancel", {"scan_id": "cancel-scan"})
            preview_thread.join(timeout=3)

        self.assertFalse(preview_thread.is_alive())
        self.assertEqual(result["cancelled"], True)
        self.assertEqual(errors, [409])

    def test_folder_picker_runs_in_a_separate_main_thread_process(self) -> None:
        with patch("photodaterenamer.server.platform.system", return_value="Linux"), patch(
            "subprocess.run",
            return_value=CompletedProcess([], 0, stdout="C:\\Photos\r\n", stderr=""),
        ) as run_process:
            result = self.post("/api/select-folder", {})

        self.assertEqual(result["folder"], "C:\\Photos")
        self.assertIn("photodaterenamer.folder_picker", run_process.call_args.args[0])

    def test_windows_api_uses_native_foreground_folder_picker(self) -> None:
        with patch("photodaterenamer.server.platform.system", return_value="Windows"), patch(
            "photodaterenamer.server.select_windows_folder",
            return_value="C:\\Photos",
        ) as native_picker:
            result = self.post("/api/select-folder", {})

        self.assertEqual(result["folder"], "C:\\Photos")
        native_picker.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
