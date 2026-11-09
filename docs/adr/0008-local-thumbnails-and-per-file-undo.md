# ADR 0008: Local thumbnails and per-file undo

- Status: Accepted
- Date: 2026-11-09

## Context

The «Revelado» contact sheet showed only file names, so users could not easily recognise which photo they were about to rename. Undo was still all-or-nothing: if one renamed file was locked, nothing was restored, and the interface reported it only in a short toast.

## Decision

- Add `thumbnails.make_thumbnail(path, size)`:
  - It opens the photo read-only with Pillow (already a dependency), applies the EXIF orientation, and returns an in-memory JPEG of 96 or 360 pixels, or `None` if the file is unreadable.
  - Nothing is written to disk.
- Add `POST /api/thumbnail` to the loopback adapter:
  - It requires the session token.
  - It serves only relative paths that belong to the last analysed folder: original names plus names created by the last apply. Any other path returns 400.
  - An unreadable image returns 204.
  - The CSP allows `img-src blob:`, so the page can show the JPEG bytes as object URLs.
  - The browser limits itself to four concurrent requests, keeps a 500-entry cache, and aborts pending requests when a new scan starts.
- Add `undo_each(renamed)` to the naming engine:
  - It restores files in reverse order and never overwrites.
  - It collects failures and continues with the rest.
  - The adapter keeps unrestored files in the run, so undo can be retried.
  - `undo_renames` keeps its all-or-nothing behaviour for API compatibility.

## Consequences

- Image data never leaves the device. The adapter serves it only to the token-holding local page, and only for the folder the user chose.
- Scrolling stays at 60 fps with 3,000 rows, because thumbnails load lazily for visible rows only.
- A partially failed undo leaves every file with exactly one name. The interface lists the pending files with their reasons and offers «Reintentar deshacer».
