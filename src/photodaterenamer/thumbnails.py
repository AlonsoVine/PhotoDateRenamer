"""Small, read-only previews of photos for the contact sheet.

Thumbnails are generated in memory from files the user already selected and are only
served over the loopback interface. The source file is opened read-only and never
modified.
"""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

THUMBNAIL_SIZES = {96, 360}


def make_thumbnail(path: Path, size: int) -> bytes | None:
    """Return a JPEG preview no larger than ``size`` pixels, or ``None`` if unreadable."""
    if size not in THUMBNAIL_SIZES:
        raise ValueError("El tamaño de miniatura no es válido.")
    try:
        with Image.open(path) as image:
            if image.format == "JPEG":
                image.draft("RGB", (size * 2, size * 2))
            image = ImageOps.exif_transpose(image)
            image.thumbnail((size, size))
            if image.mode not in ("RGB", "L"):
                image = image.convert("RGB")
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=78, optimize=True)
            return buffer.getvalue()
    except (OSError, UnidentifiedImageError, ValueError, Image.DecompressionBombError):
        return None
