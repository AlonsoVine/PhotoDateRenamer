# Changelog

Notable changes to PhotoDateRenamer are documented here.

## Unreleased

### Added
- «Revelado», a redesigned darkroom-themed interface for the local application, with:
  - a single first step;
  - an automatic preview that refreshes when the format changes;
  - a virtualised contact sheet with filters, search, and a detail loupe;
  - a styled confirmation dialog;
  - dedicated views for empty folders, folders without photos, cancelled scans, applying, success, partial failure, total failure, and undo.
- Self-hosted OFL fonts (Fraunces, Instrument Sans, JetBrains Mono, DSEG7).
- Apply progress, and a per-file report of renamed and failed files.
- Keyboard shortcuts: `Alt+O` chooses a folder and `Alt+B` searches the preview.
- Local thumbnails of each photo in the contact sheet and in the detail loupe. They are generated in memory and served only to the local window.
- A «ya fechada» tag, filter, and confirmation warning for photos whose name already starts with a date.
- A persistent «Deshacer incompleto» view that lists files that could not be restored and offers to retry.
- A «Último lote» bar that keeps the last batch undoable from any view, even after choosing another folder or after an interrupted apply.
- A «MOD»/«CREA» sticker, a «Fecha del archivo» filter and a confirmation warning when a photo has no capture date and the file date is used.
- Optional fixed port through `PHOTODATERENAMER_PORT`, still bound to `127.0.0.1`.
- Regression tests that pin the proposed names of 0.5.0, plus data-safety tests on generated folders. They cover:
  - empty folders;
  - accents, symbols, and uppercase extensions;
  - collisions;
  - read-only and locked files;
  - long names;
  - hidden files;
  - thousands of files.

### Changed
- A confirmed batch is applied file by file. A locked or changed file is reported with its reason while the rest continue, and undo restores the renamed files. Previously the whole batch was rolled back.
- Cancelling a scan, and checking a missing folder, return explicit results instead of HTTP errors.
- Undo restores file by file and never overwrites; a locked file no longer blocks the rest.
- If the apply request itself fails, the interface says the result is unknown and asks to re-scan, instead of claiming nothing changed.
- On narrow windows the contact sheet comes first and the format panel collapses into a summary.
- Changing the format updates the preview in place, keeps the filter, search and selection, and reuses dates already read instead of reading every photo again.
- The loupe follows the selected row, not the pointer. On narrow windows, statuses use short text labels instead of colour alone.
- The «Fecha + título» recipe is now called «Fecha, sin extensión»; it produces the same names.

### Fixed
- Destination names longer than 255 characters are flagged as conflicts in the preview instead of failing during the rename.
- Unreadable images and OS errors show a readable message instead of a raw exception with escaped paths.
- On Windows the local server no longer binds to a port another process is already using.
- The interface no longer overflows horizontally on narrow windows.

## [0.5.0] - 2026-10-29

### Security
- Reject rename plans when a source photo changes after preview.
- Add a nonce-based Content Security Policy, `X-Content-Type-Options`, and `Referrer-Policy` to the local interface.
- Restrict GitHub Actions token permissions, pin third-party actions to verified commit SHAs, and add Dependabot update checks.
- Publish a SHA-256 checksum and build-provenance attestation for Windows releases.

### Added
- Cancellable scan progress and paginated previews for large photo libraries.
- Add Node integration tests for preview pagination, scan cancellation, rename confirmation, and undo.

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
