# Changelog

Notable changes to PhotoDateRenamer are documented here.

## [0.3.0] - 2026-10-29

### Added
- Proprietary personal, non-commercial license and an automated GitHub Release workflow for Windows builds.
- First public release is distributed as `v0.3.0`; its GitHub Release includes the Windows executable and license.
- Ordered date fallback across EXIF capture/digitized/image dates, XMP, and filesystem timestamps, with the selected source shown in previews.
- The selected date source is displayed next to each filename in the preview.

### Fixed
- The Windows folder picker now uses the native Shell dialog owned by the foreground window, instead of a hidden helper process.

### Changed
- Removed decorative art caption text from the home screen.
- Added portfolio, GitHub, and LinkedIn links to the footer and reduced the top spacing above the main content.
- Replaced the generated landscape with the supplied PNG illustration and added the supplied app icon to the navigation bar and browser tab.
- Added an author credit linking to Alonso Viñé's portfolio in the footer.
- Standardized the Windows build output to `dist/PhotoDateRenamer.exe` and configured successful builds to remove older version-suffixed executables.

## [0.2.0] - 2026-10-29

### Added
- Local browser interface with folder selection, naming presets, custom name components, preview, confirmation, and undo.
- EXIF-aware scan and safe rename engine with collision reporting.
- Unit tests, Windows executable build script, CI workflow, and architecture decision records.

### Changed
- The root `rename_photos.py` now launches the local browser application rather than immediately renaming a hard-coded directory.
