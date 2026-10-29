# ADR 0006: Static browser application

- Status: Accepted
- Date: 2026-10-29

## Context

GitHub Pages serves static assets and cannot run the Python HTTP service used by the Windows application. A browser version can avoid a hosted backend by reading and writing user-selected files through browser APIs, but directory access and writable streams are not available in every browser.

## Decision

Publish a standalone application from `site/` using GitHub Pages and the GitHub Actions Pages deployment workflow. The app reads EXIF/XMP and filesystem modification dates in the browser, requests read/write access to the selected directory, previews all proposed changes, then creates each new file and removes its original only after the user confirms. Recursive traversal is opt-in. Keep the packaged Windows app as the cross-browser desktop option.

## Consequences

- Photo contents are not uploaded to GitHub Pages or a backend; the page only serves the app's static files.
- Directory selection and writing require HTTPS and a supporting File System Access API implementation; Chrome and Edge are the documented browser choices.
- A browser rename is not an atomic filesystem rename. The app checks destination conflicts, writes a copy, and removes the original only after the copy closes successfully. Filesystem timestamps may change.
- Undo is available only while the page remains open and has permission to the selected directory.
- The Pages site is deployed from the public repository's `site/` directory after selecting GitHub Actions as its Pages source.
