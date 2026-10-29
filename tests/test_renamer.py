from pathlib import Path
from datetime import datetime
import os
import tempfile
import unittest

from PIL import Image

from photodaterenamer.renamer import (
    RenamePlanError,
    create_preview,
    execute_plan,
    undo_renames,
)


def create_photo(
    path: Path,
    capture_date: str | None = "2024:05:06 07:08:09",
    digitized_date: str | None = None,
    image_date: str | None = None,
    xmp: bytes | None = None,
) -> None:
    image = Image.new("RGB", (4, 4), color="olive")
    exif = Image.Exif()
    if capture_date is not None:
        exif[36867] = capture_date
    if digitized_date is not None:
        exif[36868] = digitized_date
    if image_date is not None:
        exif[306] = image_date
    image.save(path, exif=exif, xmp=xmp)


class RenamePreviewTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.folder = Path(self.temporary_directory.name)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_default_preview_and_undo(self) -> None:
        create_photo(self.folder / "IMG_1234.jpg")

        plan = create_preview(self.folder)

        self.assertEqual(plan.rename_count, 1)
        self.assertEqual(plan.items[0].new_name, "2024_05_06_IMG_1234.jpg")
        renamed = execute_plan(plan)
        self.assertTrue((self.folder / "2024_05_06_IMG_1234.jpg").exists())

        undo_renames(renamed)

        self.assertTrue((self.folder / "IMG_1234.jpg").exists())

    def test_subfolders_are_ignored_by_default(self) -> None:
        nested_folder = self.folder / "vacaciones"
        nested_folder.mkdir()
        create_photo(nested_folder / "IMG_5678.jpg")

        plan = create_preview(self.folder)

        self.assertEqual(plan.items, ())

    def test_recursive_preview_renames_nested_photos_and_can_undo(self) -> None:
        nested_folder = self.folder / "vacaciones"
        nested_folder.mkdir()
        create_photo(nested_folder / "IMG_5678.jpg")

        plan = create_preview(self.folder, recursive=True)

        self.assertEqual(plan.rename_count, 1)
        self.assertEqual(plan.items[0].original_name, "vacaciones/IMG_5678.jpg")
        self.assertEqual(plan.items[0].new_name, "vacaciones/2024_05_06_IMG_5678.jpg")
        renamed = execute_plan(plan)
        self.assertTrue((nested_folder / "2024_05_06_IMG_5678.jpg").exists())

        undo_renames(renamed)

        self.assertTrue((nested_folder / "IMG_5678.jpg").exists())

    def test_recursive_preview_detects_existing_destinations_in_subfolders(self) -> None:
        nested_folder = self.folder / "vacaciones"
        nested_folder.mkdir()
        create_photo(nested_folder / "IMG_5678.jpg")
        (nested_folder / "2024_05_06_IMG_5678.jpg").write_text("keep", encoding="utf-8")

        plan = create_preview(self.folder, recursive=True)

        photo_item = next(
            item for item in plan.items if item.original_name == "vacaciones/IMG_5678.jpg"
        )
        self.assertEqual(photo_item.status, "conflict")
        self.assertEqual(plan.rename_count, 0)

    def test_missing_or_invalid_exif_uses_filesystem_date_as_last_resort(self) -> None:
        create_photo(self.folder / "no-date.jpg", None)
        create_photo(self.folder / "bad-date.jpg", "not a date")
        known_timestamp = datetime(2020, 3, 4, 5, 6, 7).timestamp()
        for path in self.folder.iterdir():
            os.utime(path, (known_timestamp, known_timestamp))

        plan = create_preview(self.folder)

        self.assertEqual(plan.rename_count, 2)
        self.assertTrue(all(item.date_source.startswith("Archivo") for item in plan.items))
        self.assertTrue(all(item.new_name.startswith("2020_03_04") for item in plan.items))

    def test_exif_digitized_date_is_used_when_original_date_is_missing(self) -> None:
        create_photo(self.folder / "digitized.jpg", None, digitized_date="2019:08:09 10:11:12")

        item = create_preview(self.folder).items[0]

        self.assertEqual(item.new_name, "2019_08_09_digitized.jpg")
        self.assertEqual(item.date_source, "EXIF · DateTimeDigitized")

    def test_exif_image_date_is_used_when_more_specific_dates_are_missing(self) -> None:
        create_photo(self.folder / "image-date.jpg", None, image_date="2018:07:06 05:04:03")

        item = create_preview(self.folder).items[0]

        self.assertEqual(item.new_name, "2018_07_06_image-date.jpg")
        self.assertEqual(item.date_source, "EXIF · DateTime")

    def test_xmp_capture_date_is_used_when_exif_dates_are_missing(self) -> None:
        xmp = (
            b'<x:xmpmeta xmlns:x="adobe:ns:meta/">'
            b'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
            b'<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" '
            b'exif:DateTimeOriginal="2021-02-03T04:05:06Z"/>'
            b"</rdf:RDF></x:xmpmeta>"
        )
        create_photo(self.folder / "xmp.jpg", None, xmp=xmp)

        item = create_preview(self.folder).items[0]

        self.assertEqual(item.new_name, "2021_02_03_xmp.jpg")
        self.assertEqual(item.date_source, "XMP · DateTimeOriginal")

    def test_existing_destination_is_a_conflict(self) -> None:
        create_photo(self.folder / "IMG_1234.jpg")
        (self.folder / "2024_05_06_IMG_1234.jpg").write_text("keep", encoding="utf-8")

        plan = create_preview(self.folder)

        source_item = next(item for item in plan.items if item.original_name == "IMG_1234.jpg")
        self.assertEqual(source_item.status, "conflict")
        self.assertEqual(plan.rename_count, 0)

    def test_duplicate_custom_names_are_conflicts(self) -> None:
        create_photo(self.folder / "one.jpg")
        create_photo(self.folder / "two.jpg")
        components = [{"kind": "field", "value": "date"}, {"kind": "text", "value": ".jpg"}]

        plan = create_preview(self.folder, components)

        self.assertEqual([item.status for item in plan.items], ["conflict", "conflict"])
        self.assertEqual(plan.rename_count, 0)

    def test_destination_created_after_preview_is_not_overwritten(self) -> None:
        create_photo(self.folder / "IMG_1234.jpg")
        plan = create_preview(self.folder)
        (self.folder / "2024_05_06_IMG_1234.jpg").write_text("keep", encoding="utf-8")

        with self.assertRaises(RenamePlanError):
            execute_plan(plan)

        self.assertTrue((self.folder / "IMG_1234.jpg").exists())
        self.assertEqual(
            (self.folder / "2024_05_06_IMG_1234.jpg").read_text(encoding="utf-8"), "keep"
        )

    def test_invalid_component_and_date_format_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            create_preview(self.folder, [{"kind": "field", "value": "not-a-field"}])
        with self.assertRaises(ValueError):
            create_preview(self.folder, date_format="arbitrary")

    def test_unsupported_files_are_not_included(self) -> None:
        (self.folder / "notes.txt").write_text("hello", encoding="utf-8")

        self.assertEqual(create_preview(self.folder).items, ())


if __name__ == "__main__":
    unittest.main()
