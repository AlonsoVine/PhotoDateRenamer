# Changelog

Notable changes to PhotoDateRenamer are documented here.

## Unreleased

### Security
- Reject rename plans when a source photo changes after preview.

### Added
- Cancellable scan progress and paginated previews for large photo libraries.

### Changed
- The browser reads EXIF/XMP metadata in bounded file ranges instead of loading each complete photo into memory.
- Browser metadata chunks larger than 16 MiB are reported as skipped rather than loaded into memory all at once.

## [0.4.0] - 2026-10-29

### Added
- Static, browser-only version prepared for GitHub Pages; photo data is processed locally and never sent to a server.
- Recursive preview and renaming for photos in subfolders, preserving their directory structure.
- A download section linking to the latest Windows portable release.
- GitHub Pages deployment workflow and browser metadata parser tests.

### Changed
- The Windows interface now offers an opt-in subfolder scan.
- The browser version uses the File System Access API and requires a current Chromium browser on HTTPS.

## [0.3.1] - 2026-10-29

### Changed
- Raised the minimum supported Python version to 3.11 to match Pillow 13 and retain XMP support.

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
