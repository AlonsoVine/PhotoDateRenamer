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

    def test_an_unexpected_server_error_answers_500_instead_of_dropping_the_connection(self) -> None:
        with patch("photodaterenamer.server.AppRequestHandler._last_run", side_effect=RuntimeError("boom")):
            with self.assertRaises(HTTPError) as caught:
                self.post("/api/last-run", {})
        self.assertEqual(caught.exception.code, 500)
        self.assertIn("boom", json.loads(caught.exception.read())["error"])

    def test_serves_browser_assets_and_limits_api_to_authorized_origin(self) -> None:
        with urlopen(f"{self.base_url}/styles.css") as response:
            stylesheet = response.read().decode("utf-8")
        self.assertIn("--paper:", stylesheet)
        self.assertNotIn("@import", stylesheet)
        self.assertNotIn("url(http", stylesheet)

        with urlopen(f"{self.base_url}/") as response:
            page = response.read().decode("utf-8")
            self.assertEqual(response.headers.get("X-Content-Type-Options"), "nosniff")
            self.assertEqual(response.headers.get("Referrer-Policy"), "no-referrer")
            policy = response.headers.get("Content-Security-Policy") or ""
        self.assertIn('href="/images/app-icon.png"', page)
        self.assertIn(f"nonce-{self.token}", policy)
        self.assertNotIn("unsafe-inline", policy)
        self.assertIn('src="/images/hero-print.webp"', page)
        self.assertIn("Creado por Alonso Viñé", page)
        self.assertIn('id="progress-view"', page)
        self.assertIn('id="list-scroller"', page)
        self.assertIn('id="confirm-dialog"', page)
        self.assertIn("font-src 'self'", policy)
        self.assertNotRegex(page, r'(src|href)="(https?:)?//(?!alonsovine|github|www\.linkedin)')
        for image_path in ("/images/app-icon.png", "/images/grain.png"):
            with urlopen(f"{self.base_url}{image_path}") as response:
                self.assertEqual(response.headers.get_content_type(), "image/png")
                self.assertTrue(response.read().startswith(b"\x89PNG\r\n\x1a\n"))
        for font in ("fraunces", "fraunces-italic", "instrument-sans", "jetbrains-mono", "dseg7"):
            with urlopen(f"{self.base_url}/fonts/{font}.woff2") as response:
                self.assertEqual(response.headers.get_content_type(), "font/woff2")
                self.assertTrue(response.read().startswith(b"wOF2"))

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

    def write_photo(self, name: str, capture_date: str = "2024:05:06 07:08:09") -> Path:
        image_path = self.folder / name
        image = Image.new("RGB", (4, 4), color="olive")
        exif = Image.Exif()
        exif[36867] = capture_date
        image.save(image_path, exif=exif)
        return image_path

    def test_preview_reports_entries_folder_name_and_date_text(self) -> None:
        self.write_photo("IMG_001.jpg")
        (self.folder / "notas.txt").write_text("x", encoding="utf-8")

        preview = self.post("/api/preview", {"folder": str(self.folder), "date_format": "yyyymmdd"})

        self.assertEqual(preview["entry_count"], 2)
        self.assertEqual(preview["folder_name"], self.folder.name)
        self.assertEqual(preview["items"][0]["date_text"], "20240506")

    def test_partial_failure_is_reported_and_successful_renames_can_be_undone(self) -> None:
        for name in ("a.jpg", "b.jpg", "c.jpg"):
            self.write_photo(name)
        preview = self.post("/api/preview", {"folder": str(self.folder)})
        (self.folder / "2024_05_06_b.jpg").write_bytes(b"intruso")

        result = self.post("/api/confirm", {"plan_id": preview["plan_id"]})
        progress = self.post("/api/apply-progress", {"plan_id": preview["plan_id"]})

        self.assertEqual(result["renamed_count"], 2)
        self.assertEqual(result["failed_count"], 1)
        self.assertEqual(result["failures"][0]["original_name"], "b.jpg")
        self.assertEqual((self.folder / "2024_05_06_b.jpg").read_bytes(), b"intruso")
        self.assertEqual(progress, {"plan_id": preview["plan_id"], "completed": True, "done": 3, "total": 3})

        undo = self.post("/api/undo", {"run_id": result["run_id"]})

        self.assertEqual(undo["restored_count"], 2)
        self.assertEqual(undo["failed_count"], 0)
        self.assertIsNone(undo["run_id"])
        self.assertTrue((self.folder / "a.jpg").exists())
        self.assertTrue((self.folder / "c.jpg").exists())

    def test_total_failure_has_no_undo_and_a_plan_cannot_be_applied_twice(self) -> None:
        self.write_photo("a.jpg")
        preview = self.post("/api/preview", {"folder": str(self.folder)})
        (self.folder / "2024_05_06_a.jpg").write_bytes(b"intruso")

        result = self.post("/api/confirm", {"plan_id": preview["plan_id"]})

        self.assertEqual(result["renamed_count"], 0)
        self.assertEqual(result["failed_count"], 1)
        self.assertIsNone(result["run_id"])
        with self.assertRaises(HTTPError) as error:
            self.post("/api/confirm", {"plan_id": preview["plan_id"]})
        self.assertEqual(error.exception.code, 400)
        error.exception.close()

    def test_last_run_survives_analysing_another_folder_and_ends_after_undo(self) -> None:
        self.write_photo("a.jpg")
        self.assertEqual(self.post("/api/last-run", {}), {"run_id": None})
        preview = self.post("/api/preview", {"folder": str(self.folder)})
        result = self.post("/api/confirm", {"plan_id": preview["plan_id"]})
        other = self.folder / "otra"
        other.mkdir()
        self.post("/api/preview", {"folder": str(other)})

        last = self.post("/api/last-run", {})

        self.assertEqual(last["run_id"], result["run_id"])
        self.assertEqual(last["count"], 1)
        self.assertEqual(last["folder"], str(self.folder.resolve()))
        undo = self.post("/api/undo", {"run_id": last["run_id"]})
        self.assertEqual(undo["restored_count"], 1)
        self.assertEqual(undo["folder"], str(self.folder.resolve()))
        self.assertTrue((self.folder / "a.jpg").exists())
        self.assertEqual(self.post("/api/last-run", {}), {"run_id": None})

    def test_a_batch_that_renames_nothing_keeps_the_previous_batch_undoable(self) -> None:
        self.write_photo("a.jpg")
        first = self.post("/api/confirm", {"plan_id": self.post("/api/preview", {"folder": str(self.folder)})["plan_id"]})
        other = self.folder / "otra"
        other.mkdir()
        (other / "b.jpg").write_bytes((self.folder / "2024_05_06_a.jpg").read_bytes())
        preview = self.post("/api/preview", {"folder": str(other)})
        (other / "2024_05_06_b.jpg").write_bytes(b"intruso")

        failed = self.post("/api/confirm", {"plan_id": preview["plan_id"]})

        self.assertEqual(failed["renamed_count"], 0)
        self.assertEqual(self.post("/api/last-run", {})["run_id"], first["run_id"])
        undo = self.post("/api/undo", {"run_id": first["run_id"]})
        self.assertEqual(undo["restored_count"], 1)
        self.assertTrue((self.folder / "a.jpg").exists())

    def test_an_interrupted_apply_keeps_the_files_already_renamed_undoable(self) -> None:
        for name in ("a.jpg", "b.jpg"):
            self.write_photo(name)
        preview = self.post("/api/preview", {"folder": str(self.folder)})
        from photodaterenamer import renamer

        real_move = renamer._move_without_overwrite
        calls = {"count": 0}

        def move_then_crash(source: Path, destination: Path) -> None:
            calls["count"] += 1
            if calls["count"] == 2:
                raise RuntimeError("fallo inesperado del servidor")
            real_move(source, destination)

        with patch.object(renamer, "_move_without_overwrite", move_then_crash):
            with self.assertRaises(Exception):
                self.post("/api/confirm", {"plan_id": preview["plan_id"]})

        last = self.post("/api/last-run", {})
        self.assertEqual(last["count"], 1)
        undo = self.post("/api/undo", {"run_id": last["run_id"]})
        self.assertEqual(undo["restored_count"], 1)
        self.assertEqual(sorted(path.name for path in self.folder.iterdir()), ["a.jpg", "b.jpg"])

    def test_a_format_change_reuses_dates_without_reading_metadata_again(self) -> None:
        self.write_photo("a.jpg")
        first = self.post("/api/preview", {"folder": str(self.folder)})
        from photodaterenamer import renamer

        with patch.object(renamer, "_read_capture_date", side_effect=AssertionError("re-read")):
            second = self.post(
                "/api/preview", {"folder": str(self.folder), "date_format": "yyyymmdd"}
            )
        self.assertEqual(first["items"][0]["date_source"], second["items"][0]["date_source"])
        self.assertEqual(second["items"][0]["new_name"], "20240506_a.jpg")

        self.write_photo("a.jpg", "2020:01:02 03:04:05")
        third = self.post("/api/preview", {"folder": str(self.folder)})
        self.assertEqual(third["items"][0]["new_name"], "2020_01_02_a.jpg")

    def test_thumbnails_are_limited_to_the_analysed_folder(self) -> None:
        self.write_photo("IMG_001.jpg")
        (self.folder / "rota.jpg").write_bytes(b"no es un jpeg")
        self.post("/api/preview", {"folder": str(self.folder)})

        request = Request(
            f"{self.base_url}/api/thumbnail",
            data=json.dumps({"path": "IMG_001.jpg", "size": 96}).encode("utf-8"),
            headers={"Content-Type": "application/json", "Origin": self.base_url,
                     "X-PhotoDateRenamer-Token": self.token},
        )
        with urlopen(request) as response:
            self.assertEqual(response.headers.get_content_type(), "image/jpeg")
            self.assertTrue(response.read().startswith(bytes([0xFF, 0xD8])))
        broken = Request(
            f"{self.base_url}/api/thumbnail",
            data=json.dumps({"path": "rota.jpg", "size": 96}).encode("utf-8"),
            headers={"Content-Type": "application/json", "Origin": self.base_url,
                     "X-PhotoDateRenamer-Token": self.token},
        )
        with urlopen(broken) as response:
            self.assertEqual(response.status, 204)
        for path in ("../secreto.jpg", str(self.folder / "IMG_001.jpg"), "notas.txt"):
            with self.assertRaises(HTTPError) as error:
                self.post("/api/thumbnail", {"path": path, "size": 96})
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
        with self.assertRaises(HTTPError) as error:
            self.post("/api/thumbnail", {"path": "IMG_001.jpg", "size": 96}, token="incorrecto")
        self.assertEqual(error.exception.code, 403)
        error.exception.close()

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
        responses: list[dict] = []

        def wait_until_cancelled(*args: Any, **kwargs: Any) -> Any:
            started.set()
            kwargs["cancellation_event"].wait(timeout=3)
            return run_create_preview(*args, **kwargs)

        def request_preview() -> None:
            try:
                responses.append(
                    self.post(
                        "/api/preview",
                        {"folder": str(self.folder), "scan_id": "cancel-scan"},
                    )
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
        self.assertEqual(errors, [])
        self.assertEqual(responses, [{"cancelled": True, "scan_id": "cancel-scan"}])
        late = self.post("/api/cancel", {"scan_id": "cancel-scan"})
        self.assertEqual(late["cancelled"], False)

    def test_check_folder_reports_missing_and_existing_folders(self) -> None:
        missing = self.post("/api/check-folder", {"folder": str(self.folder / "no-existe")})
        present = self.post("/api/check-folder", {"folder": str(self.folder)})

        self.assertFalse(missing["ok"])
        self.assertIn("no existe", missing["error"])
        self.assertTrue(present["ok"])
        self.assertEqual(Path(present["folder"]), self.folder.resolve())

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
