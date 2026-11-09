import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class BuildSiteTests(unittest.TestCase):
    """The published web version is assembled from the application's own interface."""

    def build(self) -> Path:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        output = Path(temporary.name) / "_site"
        subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "build_site.py"), str(output)],
            check=True,
            capture_output=True,
        )
        return output

    def test_the_site_reuses_the_interface_and_adds_the_browser_backend(self) -> None:
        output = self.build()
        web = ROOT / "src" / "photodaterenamer" / "web"
        for name in ("app.js", "helpers.js", "styles.css"):
            self.assertEqual((output / name).read_bytes(), (web / name).read_bytes())
        for name in ("metadata.js", "backend.js"):
            self.assertEqual((output / name).read_bytes(), (ROOT / "site" / name).read_bytes())
        for font in ("fraunces", "fraunces-italic", "instrument-sans", "jetbrains-mono", "dseg7"):
            self.assertTrue((output / "fonts" / f"{font}.woff2").is_file())
        self.assertTrue((output / "images" / "hero-print.webp").is_file())
        self.assertTrue((output / ".nojekyll").is_file())

    def test_the_page_cannot_reach_the_network_and_loads_the_backend_first(self) -> None:
        page = (self.build() / "index.html").read_text(encoding="utf-8")
        self.assertNotIn("__APP_TOKEN__", page)
        policy = re.search(r'http-equiv="Content-Security-Policy" content="([^"]+)"', page).group(1)
        self.assertIn("connect-src 'none'", policy)
        self.assertIn("script-src 'self'", policy)
        self.assertNotIn("unsafe-inline", policy)
        scripts = re.findall(r'<script src="([^"]+)"', page)
        self.assertEqual(scripts, ["metadata.js", "backend.js", "helpers.js", "app.js"])

    def test_assets_use_relative_paths_so_the_site_works_under_a_subpath(self) -> None:
        output = self.build()
        page = (output / "index.html").read_text(encoding="utf-8")
        stylesheet = (output / "styles.css").read_text(encoding="utf-8")
        self.assertNotRegex(page, r'(src|href)="/(?!/)')
        self.assertNotRegex(stylesheet, r'url\("?/')

    def test_every_referenced_asset_exists_and_the_windows_download_is_offered(self) -> None:
        output = self.build()
        page = (output / "index.html").read_text(encoding="utf-8")
        assets = re.findall(r'<(?:script|img)[^>]*\ssrc="([^"]+)"', page)
        assets += re.findall(r'<link[^>]*\shref="([^"]+)"', page)
        self.assertTrue(assets)
        for asset in assets:
            self.assertTrue((output / asset).is_file(), asset)
        self.assertIn(
            "https://github.com/AlonsoVine/PhotoDateRenamer/releases/latest/download/PhotoDateRenamer.exe",
            page,
        )
        self.assertNotRegex(page, r'(src|href)="(https?:)?//(?!alonsovine|github|www\.linkedin)')


if __name__ == "__main__":
    unittest.main()
