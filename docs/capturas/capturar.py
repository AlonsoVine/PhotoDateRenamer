"""Capture every interface state at three window sizes and run objective UI checks.

Usage:
  python docs/capturas/capturar.py <scratch folder> <output name> [--axe <axe.min.js>]

Synthetic photo folders are generated inside <scratch folder>; no real folder is used.
The native folder picker cannot be automated, so /api/select-folder is answered by the
script with the synthetic folder (or "" to simulate a cancelled selection).
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import threading
import time

from playwright.sync_api import Page, sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fixtures import build_fixtures  # noqa: E402

from photodaterenamer.server import AppServer  # noqa: E402

SIZES = {"min": (360, 720), "medio": (1024, 768), "grande": (1680, 1050)}
HERE = Path(__file__).resolve().parent

FPS_SCRIPT = """
async () => {
  const scroller = document.querySelector('#list-scroller');
  const longTasks = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longTasks.push(entry.duration);
  });
  try { observer.observe({ type: 'longtask', buffered: false }); } catch (e) {}
  let frames = 0;
  const start = performance.now();
  let worst = 0;
  let last = start;
  await new Promise((resolve) => {
    function step(now) {
      frames += 1;
      worst = Math.max(worst, now - last);
      last = now;
      scroller.scrollTop += 140;
      if (now - start < 2000) requestAnimationFrame(step); else resolve();
    }
    requestAnimationFrame(step);
  });
  observer.disconnect();
  const seconds = (performance.now() - start) / 1000;
  return {
    fps: Math.round(frames / seconds),
    worstFrameMs: Math.round(worst),
    longTasks: longTasks.length,
    renderedRows: document.querySelectorAll('#list-scroller .row').length,
    scrolledTo: scroller.scrollTop
  };
}
"""

DEVELOP_FPS_SCRIPT = """
async () => {
  let frames = 0;
  let worst = 0;
  const start = performance.now();
  let last = start;
  await new Promise((resolve) => {
    function step(now) {
      frames += 1;
      worst = Math.max(worst, now - last);
      last = now;
      if (now - start < 900) requestAnimationFrame(step); else resolve();
    }
    requestAnimationFrame(step);
  });
  return { fps: Math.round(frames / ((performance.now() - start) / 1000)), worstFrameMs: Math.round(worst) };
}
"""

HEADING_SCRIPT = """
() => {
  if (document.body.dataset.mode === 'idle') return null;
  const box = document.querySelector('#sheet-title').getBoundingClientRect();
  return { top: Math.round(box.top), bottom: Math.round(box.bottom), viewport: innerHeight,
           visible: box.top >= 0 && box.bottom <= innerHeight };
}
"""

COUNT = r"Number((document.querySelector('%s').textContent || '0').replace(/\./g, ''))"

OVERFLOW_SCRIPT = """
() => {
  const doc = document.documentElement;
  const offenders = [];
  for (const element of document.querySelectorAll('body *')) {
    if (element.closest('[hidden]') || element.closest('dialog:not([open])')) continue;
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    if (box.right > doc.clientWidth + 1 && getComputedStyle(element).position !== 'fixed') {
      offenders.push(element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') +
        (element.className && typeof element.className === 'string' ? '.' + element.className.split(' ')[0] : ''));
    }
  }
  return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, offenders: offenders.slice(0, 8) };
}
"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("scratch")
    parser.add_argument("name")
    parser.add_argument("--axe")
    arguments = parser.parse_args()
    scratch = Path(arguments.scratch).resolve()
    out = HERE / arguments.name
    out.mkdir(parents=True, exist_ok=True)
    axe_source = Path(arguments.axe).read_text(encoding="utf-8") if arguments.axe else None
    report: dict[str, object] = {"console": [], "overflow": {}, "axe": {}, "fps": {}, "fps_develop": {}, "heading": {}, "states": []}

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"]
        )
        for size_name, (width, height) in SIZES.items():
            for motion in ("no-preference", "reduce"):
                if motion == "reduce" and size_name != "medio":
                    continue
                suffix = size_name if motion == "no-preference" else f"{size_name}-sin-movimiento"
                run_size(browser, scratch, out, size_name, suffix, width, height, motion, axe_source, report)
        browser.close()

    (out / "informe.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    problems = [entry for entry in report["console"]]
    overflow = {key: value for key, value in report["overflow"].items() if value["offenders"] or value["scrollWidth"] > value["clientWidth"]}
    violations = {key: value for key, value in report["axe"].items() if value}
    hidden_headings = [key for key, value in report["heading"].items() if value and not value["visible"]]
    print(json.dumps({
        "console_messages": len(problems),
        "overflow_states": list(overflow),
        "axe_violations": violations,
        "fps": report["fps"],
        "fps_develop": report["fps_develop"],
        "headings_outside_viewport": hidden_headings,
    }, ensure_ascii=False, indent=1))


def run_size(browser, scratch, out, size_name, suffix, width, height, motion, axe_source, report) -> None:
    folders = build_fixtures(scratch / f"{suffix}")
    server = AppServer()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}/"
    context = browser.new_context(viewport={"width": width, "height": height}, reduced_motion=motion)
    page = context.new_page()
    simulated = {"network_failure": False}

    def on_console(message) -> None:
        if message.type not in ("error", "warning"):
            return
        # The «resultado desconocido» capture aborts /api/confirm on purpose.
        if simulated["network_failure"] and "ERR_FAILED" in message.text:
            return
        report["console"].append(f"[{suffix}] {message.type}: {message.text}")

    page.on("console", on_console)
    page.on("pageerror", lambda error: report["console"].append(f"[{suffix}] pageerror: {error}"))
    picked = {"folder": ""}
    page.route(
        "**/api/select-folder",
        lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(picked)),
    )

    def shot(state: str, full_page: bool = False, heading: bool = True, settle: bool = True) -> None:
        if not settle:
            page.screenshot(path=out / f"{state}-{suffix}.jpg", full_page=full_page, type="jpeg", quality=85)
            report["states"].append(f"{state}-{suffix}")
            return
        page.wait_for_timeout(450 if motion == "no-preference" else 120)
        # Let finite animations (view transitions, the develop reveal) settle first.
        page.wait_for_function(
            "() => document.getAnimations().every(a => a.playState !== 'running'"
            " || a.effect.getComputedTiming().iterations === Infinity)",
            timeout=5000,
        )
        page.screenshot(path=out / f"{state}-{suffix}.jpg", full_page=full_page, type="jpeg", quality=85)
        report["overflow"][f"{state}-{suffix}"] = page.evaluate(OVERFLOW_SCRIPT)
        if heading and not page.evaluate("() => Boolean(document.querySelector('dialog[open]'))"):
            report["heading"][f"{state}-{suffix}"] = page.evaluate(HEADING_SCRIPT)
        report["states"].append(f"{state}-{suffix}")
        if axe_source and motion == "no-preference" and size_name != "grande":
            if not page.evaluate("() => typeof window.axe === 'object'"):
                page.evaluate(axe_source + "\n;0")
            result = page.evaluate(
                "async () => (await axe.run(document, {resultTypes: ['violations']})).violations"
                ".map(v => ({id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0] && v.nodes[0].target.join(' ')}))"
            )
            report["axe"][f"{state}-{suffix}"] = result

    def wait_view(*views: str, timeout: int = 90000) -> None:
        selector = ", ".join(f'body[data-view="{view}"]' for view in views)
        page.wait_for_selector(selector, timeout=timeout)

    def pick(folder: Path | str) -> None:
        picked["folder"] = str(folder)
        # Mark the current view as stale so the next wait_view sees the new state only.
        page.evaluate("() => { document.body.dataset.view = '__capture__'; }")
        if page.evaluate("() => document.body.dataset.mode") == "idle":
            page.click("#hero-browse")
        else:
            page.click("#change-folder")

    page.goto(url)
    page.wait_for_load_state("networkidle")
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(3600 if motion == "no-preference" else 0)
    shot("01-inicial")

    picked["folder"] = ""
    page.click("#hero-browse")
    page.wait_for_selector("#hero-message:not([hidden])")
    shot("02-seleccion-cancelada")

    page.fill("#hero-path", str(scratch / "no-existe"))
    page.press("#hero-path", "Enter")
    page.wait_for_selector("#hero-message.is-error")
    shot("03-ruta-inexistente")

    pick(folders["vacia"])
    wait_view("empty")
    shot("04-carpeta-vacia")

    pick(folders["sin-imagenes"])
    wait_view("nophotos")
    shot("05-sin-imagenes")

    pick(folders["miles"])
    wait_view("scanning")
    page.wait_for_function(f"() => {COUNT % '#progress-total'} > 0", timeout=30000)
    shot("06-analizando", settle=False)  # transient: the scan may finish at any moment
    page.click("#cancel-scan")
    wait_view("cancelled")
    shot("07-analisis-cancelado")

    page.evaluate("() => { document.body.dataset.view = '__capture__'; }")
    page.click("#message-primary")
    wait_view("preview")
    shot("08-miles")
    if motion == "no-preference":
        report["fps"][suffix] = page.evaluate(FPS_SCRIPT)

    pick(folders["mixta"])
    wait_view("preview")
    page.focus("#list-scroller")
    for _ in range(3):
        page.keyboard.press("ArrowDown")
    shot("09-vista-previa", heading=False)  # the user moved focus into the list

    page.click('.filter[data-filter="conflict"]')
    shot("10-filtro-conflictos", heading=False)
    page.click('.filter[data-filter="dated"]')
    shot("10b-filtro-ya-fechadas", heading=False)
    page.click('.filter[data-filter="all"]')
    if size_name != "grande":
        page.click("#frame-1")
        page.wait_for_selector("#detail-dialog[open]")
        shot("10c-detalle")
        page.keyboard.press("Escape")
    if size_name == "min":
        page.click(".format-summary")
        page.wait_for_timeout(200)
        shot("10d-formato-abierto", full_page=True, heading=False)

    if not page.evaluate("() => document.querySelector('#format-details').open"):
        page.click(".format-summary")
    page.evaluate("() => { document.body.dataset.view = '__capture__'; }")
    page.click('.preset[data-preset="original_date"]')
    wait_view("preview")
    page.wait_for_selector("#apply-button:not([disabled])")
    shot("11-formato-cambiado", heading=False)  # the user is editing the format panel
    page.evaluate("() => { document.body.dataset.view = '__capture__'; }")
    page.click('.preset[data-preset="date_original"]')
    wait_view("preview")
    page.wait_for_selector("#apply-button:not([disabled])")

    page.click("#apply-button")
    page.wait_for_selector("#confirm-dialog[open]")
    shot("12-confirmar")
    page.click("#confirm-apply")
    wait_view("success", "partial", "total")
    shot("13-exito")

    page.click("#undo-button")
    wait_view("restored")
    shot("14-deshecho")

    pick(folders["miles"])
    wait_view("preview")
    if motion == "no-preference":
        report["fps_develop"][suffix] = page.evaluate(DEVELOP_FPS_SCRIPT)
    page.wait_for_selector("#apply-button:not([disabled])")
    page.click("#apply-button")
    page.click("#confirm-apply")
    wait_view("applying")
    page.wait_for_function(f"() => {COUNT % '#progress-count'} > 0", timeout=30000)
    page.screenshot(path=out / f"15-aplicando-{suffix}.jpg", type="jpeg", quality=85)
    report["states"].append(f"15-aplicando-{suffix}")
    wait_view("success", "partial", "total")
    shot("16-exito-miles")
    page.click("#undo-button")
    wait_view("restored")

    pick(folders["parcial"])
    wait_view("preview")
    page.wait_for_selector("#apply-button:not([disabled])")
    page.click("#apply-button")
    locked = [open(folders["parcial"] / name, "rb") for name in ("IMG_0002.jpg", "IMG_0004.jpg")]
    try:
        page.click("#confirm-apply")
        wait_view("partial")
    finally:
        for handle in locked:
            handle.close()
    shot("17-error-parcial")

    renamed_now = sorted(path for path in folders["parcial"].iterdir() if path.name.startswith("2020_"))
    held = open(renamed_now[0], "rb")
    try:
        page.click("#undo-button")
        wait_view("undo-partial")
        shot("17b-deshacer-incompleto")
    finally:
        held.close()
    page.evaluate("() => { document.body.dataset.view = '__capture__'; }")
    page.click("#result-primary")
    wait_view("restored")

    pick(folders["total"])
    wait_view("preview")
    page.wait_for_selector("#apply-button:not([disabled])")
    simulated["network_failure"] = True
    page.route("**/api/confirm", lambda route: route.abort())
    page.click("#apply-button")
    page.click("#confirm-apply")
    wait_view("unknown")
    page.unroute("**/api/confirm")
    page.wait_for_timeout(300)
    simulated["network_failure"] = False
    shot("17c-resultado-desconocido")

    pick(folders["total"])
    wait_view("preview")
    page.wait_for_selector("#apply-button:not([disabled])")
    page.click("#apply-button")
    locked = [open(path, "rb") for path in sorted(folders["total"].iterdir())]
    try:
        page.click("#confirm-apply")
        wait_view("total")
    finally:
        for handle in locked:
            handle.close()
    shot("18-error-total")

    context.close()
    server.shutdown()
    server.server_close()


if __name__ == "__main__":
    os.environ["PHOTODATERENAMER_NO_BROWSER"] = "1"
    started = time.time()
    main()
    print(f"Capturas completadas en {time.time() - started:.0f} s")
