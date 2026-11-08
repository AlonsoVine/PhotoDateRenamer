"""Synthetic photo folders for screenshots. Never point this at a real photo folder."""

from __future__ import annotations

from datetime import datetime
import io
import os
from pathlib import Path
import shutil

from PIL import Image


def _jpeg_bytes(capture_date: str | None) -> bytes:
    image = Image.new("RGB", (8, 8), color=(150, 120, 90))
    exif = Image.Exif()
    if capture_date is not None:
        exif[36867] = capture_date
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif)
    return buffer.getvalue()


def build_fixtures(base: Path) -> dict[str, Path]:
    """Create every folder used by the capture scripts and return their paths."""
    if base.exists():
        shutil.rmtree(base)
    folders = {
        name: base / name
        for name in ("vacia", "sin-imagenes", "mixta", "miles", "parcial", "total")
    }
    for folder in folders.values():
        folder.mkdir(parents=True)

    for name in ("notas.txt", "presupuesto.pdf", "video.mp4", "raw_0001.CR2"):
        (folders["sin-imagenes"] / name).write_bytes(b"no es una imagen")

    mixed = folders["mixta"]
    samples = [
        ("IMG_0412.jpg", "2024:08:14 19:02:11"),
        ("IMG_0413.jpg", "2024:08:14 19:05:40"),
        ("Atardecer en Cádiz.JPG", "2024:08:15 21:13:00"),
        ("DSC_8812.jpeg", "2023:12:24 22:40:03"),
        ("cumpleaños abuela (1).jpg", "2023:03:02 17:20:55"),
        ("scan_carrete_07.jpg", None),
        ("PXL_20220611_101010.jpg", "2022:06:11 10:10:10"),
        ("2024_08_14_IMG_0414.jpg", "2024:08:14 19:09:00"),
        ("IMG_0414.jpg", "2024:08:14 19:09:00"),
    ]
    for name, capture_date in samples:
        (mixed / name).write_bytes(_jpeg_bytes(capture_date))
    (mixed / "dañada.jpg").write_bytes(b"\xff\xd8 cabecera rota")
    (mixed / "léeme.txt").write_text("notas del viaje", encoding="utf-8")
    fixed = datetime(2021, 9, 30, 12, 0, 0).timestamp()
    os.utime(mixed / "scan_carrete_07.jpg", (fixed, fixed))

    payload = _jpeg_bytes("2019:07:21 09:30:00")
    for index in range(3000):
        (folders["miles"] / f"IMG_{index:05d}.jpg").write_bytes(payload)

    for index in range(6):
        (folders["parcial"] / f"IMG_{index:04d}.jpg").write_bytes(
            _jpeg_bytes(f"2020:01:0{index + 1} 10:00:00")
        )
    for index in range(3):
        (folders["total"] / f"IMG_{index:04d}.jpg").write_bytes(
            _jpeg_bytes(f"2020:02:0{index + 1} 10:00:00")
        )
    return folders
