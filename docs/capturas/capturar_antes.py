"""Baseline screenshots of the 0.5.0 interface (run once, before the redesign).

Usage: python docs/capturas/capturar_antes.py <scratch folder>
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import threading

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fixtures import build_fixtures  # noqa: E402

from photodaterenamer.server import AppServer  # noqa: E402

SIZES = {"min": (360, 720), "medio": (1024, 768), "grande": (1680, 1050)}
OUT = Path(__file__).resolve().parent / "antes"


def main() -> None:
    scratch = Path(sys.argv[1]).resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    console: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for size_name, (width, height) in SIZES.items():
            folders = build_fixtures(scratch / f"antes-{size_name}")
            server = AppServer()
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            url = f"http://127.0.0.1:{server.server_port}/"
            page = browser.new_page(viewport={"width": width, "height": height})
            page.on("console", lambda message: console.append(f"{message.type}: {message.text}"))
            page.on("dialog", lambda dialog: dialog.accept())
            picked = {"folder": ""}
            page.route(
                "**/api/select-folder",
                lambda route: route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps(picked),
                ),
            )

            def shot(state: str) -> None:
                page.wait_for_timeout(250)
                page.screenshot(path=OUT / f"{state}-{size_name}.png", full_page=True)

            def preview(folder: Path) -> None:
                page.fill("#folder-path", str(folder))
                page.click("#preview-button")
                page.wait_for_selector("#preview-button:not([disabled])", timeout=60000)

            page.goto(url)
            shot("01-inicial")
            page.click("#browse-button")
            shot("02-seleccion-cancelada")
            preview(folders["vacia"])
            shot("03-carpeta-vacia")
            preview(folders["sin-imagenes"])
            shot("04-sin-imagenes")
            page.fill("#folder-path", str(folders["miles"]))
            page.click("#preview-button")
            page.wait_for_timeout(400)
            shot("05-analizando")
            page.wait_for_selector("#preview-button:not([disabled])", timeout=60000)
            shot("06-miles")
            preview(folders["mixta"])
            shot("07-vista-previa")
            page.click("#confirm-button")
            page.wait_for_selector("#undo-control:not([hidden])", timeout=60000)
            shot("09-exito")
            preview(folders["parcial"])
            locked = open(folders["parcial"] / "IMG_0003.jpg", "rb")
            try:
                page.click("#confirm-button")
                page.wait_for_selector("#notice.error", timeout=60000)
                shot("10-error-parcial")
            finally:
                locked.close()
            preview(scratch / "no-existe")
            shot("11-error-total")
            page.close()
            server.shutdown()
            server.server_close()
        browser.close()
    (OUT / "consola.txt").write_text("\n".join(console) + "\n", encoding="utf-8")


if __name__ == "__main__":
    os.environ["PHOTODATERENAMER_NO_BROWSER"] = "1"
    main()
