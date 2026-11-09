"""Synthetic photo folders for screenshots. Never point this at a real photo folder."""

from __future__ import annotations

from datetime import datetime
import io
import os
from pathlib import Path
import shutil

from PIL import Image


PALETTES = [
    [(38, 62, 110), (210, 120, 70), (250, 196, 120), (60, 48, 40)],
    [(120, 170, 210), (230, 230, 220), (70, 110, 60), (40, 60, 30)],
    [(250, 150, 90), (180, 60, 70), (60, 30, 50), (20, 15, 25)],
    [(200, 210, 200), (140, 160, 150), (90, 100, 80), (50, 45, 40)],
    [(240, 200, 150), (200, 140, 100), (120, 80, 60), (60, 40, 30)],
    [(90, 140, 170), (40, 90, 120), (230, 220, 190), (180, 150, 110)],
]


def _jpeg_bytes(capture_date: str | None, seed: int = 0, size: tuple[int, int] = (160, 120)) -> bytes:
    """A soft, photo-like colour field: a 3x3 grid of tones blurred by upscaling."""
    palette = PALETTES[seed % len(PALETTES)]
    small = Image.new("RGB", (3, 3))
    for y in range(3):
        for x in range(3):
            small.putpixel((x, y), palette[(y + (x * seed) % 2) % len(palette)])
    image = small.resize(size, Image.Resampling.BICUBIC)
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
    for seed, (name, capture_date) in enumerate(samples):
        (mixed / name).write_bytes(_jpeg_bytes(capture_date, seed))
    (mixed / "dañada.jpg").write_bytes(b"\xff\xd8 cabecera rota")
    (mixed / "léeme.txt").write_text("notas del viaje", encoding="utf-8")
    fixed = datetime(2021, 9, 30, 12, 0, 0).timestamp()
    os.utime(mixed / "scan_carrete_07.jpg", (fixed, fixed))

    payloads = [_jpeg_bytes("2019:07:21 09:30:00", seed, (64, 48)) for seed in range(6)]
    for index in range(3000):
        (folders["miles"] / f"IMG_{index:05d}.jpg").write_bytes(payloads[index % 6])

    for index in range(6):
        (folders["parcial"] / f"IMG_{index:04d}.jpg").write_bytes(
            _jpeg_bytes(f"2020:01:0{index + 1} 10:00:00", index)
        )
    for index in range(3):
        (folders["total"] / f"IMG_{index:04d}.jpg").write_bytes(
            _jpeg_bytes(f"2020:02:0{index + 1} 10:00:00", index + 2)
        )
    return folders
