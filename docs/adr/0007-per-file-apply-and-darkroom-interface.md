# ADR 0007: Per-file apply policy and the «Revelado» interface

- Status: Accepted
- Date: 2026-11-09

## Context

Version 0.5.0 applied a confirmed preview as an all-or-nothing batch: the first OS error rolled back every rename already made. A single locked file therefore blocked a whole library, and the interface could only show a generic error. The interface itself was a paginated table with a native `window.confirm`, and it did not distinguish an empty folder from a folder without photos.

## Decision

- Add `apply_plan` to the naming engine. Each ready item is revalidated immediately before it moves (source still present and unchanged, destination still free). It is moved without overwriting, and a failure is recorded with its reason while the remaining items continue. The result lists renamed items and failures. `execute_plan` keeps its all-or-nothing behaviour for API compatibility.
- The HTTP adapter uses `apply_plan`, exposes apply progress, and reports partial and total failures with HTTP 200 and an explicit result. Undo restores only the items that were renamed.
- Results the user causes (a cancelled scan, a missing folder) are returned as explicit results rather than HTTP errors.
- The browser interface becomes a darkroom-themed workbench:
  - A virtualised listbox replaces pagination.
  - A styled confirmation dialog states the guarantees (no overwrite, per-file failures, undo).
  - Every state has a dedicated view.
- Fonts are self-hosted under the OFL and served from the loopback server, with `font-src 'self'`.

## Consequences

- A partial failure leaves the folder in a mixed but consistent state: every file has exactly one name and no content is lost. The user sees which files failed and can undo the rest.
- Overlong destination names are detected in the preview instead of failing during apply.
- The packaged application includes `web/fonts/*`; PyInstaller already bundles the whole `web` directory.
- The static `site/` application keeps its own interface and copy-then-remove engine; see `DECISIONES.md`.
