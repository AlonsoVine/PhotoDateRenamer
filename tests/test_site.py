from html.parser import HTMLParser
from pathlib import Path
import unittest


SITE_ROOT = Path(__file__).resolve().parents[1] / "site"


class StaticAssetParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.assets: list[str] = []
        self.content: list[str] = []

    def handle_starttag(self, tag: str, attributes: list[tuple[str, str | None]]) -> None:
        values = dict(attributes)
        if tag == "script" and values.get("src"):
            self.assets.append(str(values["src"]))
        elif tag == "link" and values.get("href", "").startswith("./"):
            self.assets.append(str(values["href"]))
        elif tag == "img" and values.get("src"):
            self.assets.append(str(values["src"]))


class StaticSiteTests(unittest.TestCase):
    def test_static_site_assets_are_local_and_present(self) -> None:
        page = (SITE_ROOT / "index.html").read_text(encoding="utf-8")
        parser = StaticAssetParser()
        parser.feed(page)

        self.assertIn("las fotografías no se envían", page)
        self.assertIn('id="recursive"', page)
        self.assertIn('class="header-author"', page)
        self.assertIn('href="https://alonsovine.github.io/portfolioR/" target="_blank"', page)
        self.assertIn("¿Prefieres una aplicación para Windows? ↓", page)
        self.assertNotIn(">Descargar para Windows</a>", page)
        self.assertIn(
            "https://github.com/AlonsoVine/PhotoDateRenamer/releases/latest/download/PhotoDateRenamer.exe",
            page,
        )
        self.assertNotIn("__APP_TOKEN__", page)
        self.assertNotIn('src="/app.js"', page)
        for asset in parser.assets:
            self.assertTrue((SITE_ROOT / asset.removeprefix("./")).is_file(), asset)

    def test_static_site_does_not_depend_on_python_api_routes(self) -> None:
        app = (SITE_ROOT / "app.js").read_text(encoding="utf-8")
        self.assertNotIn("/api/", app)
        self.assertIn("showDirectoryPicker", app)
        self.assertIn("createWritable", app)


if __name__ == "__main__":
    unittest.main()
