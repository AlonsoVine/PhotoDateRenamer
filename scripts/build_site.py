"""Assemble the published web version (GitHub Pages) from the application's interface.

The page uses the same interface as the desktop application (src/photodaterenamer/web)
plus two browser-only files from site/: metadata.js reads capture dates and backend.js
answers the interface's requests inside the page with the File System Access API.

Usage: python scripts/build_site.py [output directory, default: _site]
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "src" / "photodaterenamer" / "web"
SITE = ROOT / "site"

TOKEN_SCRIPT = '  <script nonce="__APP_TOKEN__">window.PDR_TOKEN = "__APP_TOKEN__";</script>\n'
# A static page has no server headers, so the policy travels in a meta element.
# connect-src 'none' makes it impossible for the page to send anything over the network.
WEB_HEAD = """  <meta name="description" content="Renombra tus fotos con la fecha en que se tomaron, directamente en el navegador. Las imágenes no salen de tu equipo.">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
  <meta name="referrer" content="no-referrer">
  <script src="metadata.js" defer></script>
  <script src="backend.js" defer></script>
"""


def build(output: Path) -> Path:
    html = (WEB / "index.html").read_text(encoding="utf-8")
    if html.count(TOKEN_SCRIPT) != 1:
        raise SystemExit("index.html no contiene el script del token local esperado.")
    html = html.replace(TOKEN_SCRIPT, WEB_HEAD)
    if "__APP_TOKEN__" in html:
        raise SystemExit("index.html todavía contiene marcadores del servidor local.")

    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    (output / "index.html").write_text(html, encoding="utf-8")
    for name in ("app.js", "helpers.js", "styles.css"):
        shutil.copy2(WEB / name, output / name)
    for folder in ("fonts", "images"):
        shutil.copytree(WEB / folder, output / folder)
    for name in ("metadata.js", "backend.js"):
        shutil.copy2(SITE / name, output / name)
    # GitHub Pages must not run the files through Jekyll.
    (output / ".nojekyll").write_text("", encoding="utf-8")
    return output


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "_site"
    print(build(target.resolve()))
