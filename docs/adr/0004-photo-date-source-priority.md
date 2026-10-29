# ADR 0004: Photo date source priority

- Status: Accepted
- Date: 2026-10-29

## Context

Photos do not always have `DateTimeOriginal`. Some devices store only a digitization or general EXIF timestamp; editing and publishing tools may retain an XMP date. Filesystem timestamps can provide a final fallback but may represent a copy or edit rather than the moment of capture.

## Decision

Resolve dates in this order: EXIF `DateTimeOriginal`, EXIF `DateTimeDigitized`, EXIF `DateTime`, supported XMP capture/create/digitized/modified properties, then filesystem last-modification time and finally filesystem birth/creation time. Expose the selected source in every preview row.

## Consequences

- Photos without EXIF can still be organized when XMP or filesystem timestamps exist.
- A filesystem-derived date is explicitly labeled and should not be assumed to be the capture date.
- The application does not infer a date from the filename or use a timestamp without reporting its source.
- Files with no readable image metadata still require a readable filesystem timestamp; failures are reported rather than silently interpreted.
