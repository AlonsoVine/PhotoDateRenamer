# ADR 0010: One interface for the application and the web version

- Status: Accepted
- Date: 2026-11-09

## Context

The web version on GitHub Pages had its own interface (`site/index.html`, `site/app.js`, `site/styles.css`), separate from the local application. After the «Revelado» redesign, the two diverged in design, states, safety behaviour and accessibility. Keeping two interfaces in step would double every change.

## Decision

- The web version uses the application's interface files (`src/photodaterenamer/web/`) unchanged.
- `app.js` sends every request through `post()`. When `window.PDR_BACKEND` exists, `post()` hands the request to it instead of the network.
- `site/backend.js` implements the same requests inside the page with the File System Access API and `site/metadata.js`:
  - It mirrors the engine's statuses, reasons, ordering and collision rules, the 255-character limit and the image-signature check.
  - It applies each photo separately, never overwrites, and keeps the last batch undoable while the page is open.
  - It renames with `move()` when the browser offers it, and otherwise copies then removes the original.
- `scripts/build_site.py` assembles `_site/` from both sources. It replaces the local token script with a Content Security Policy meta element (`connect-src 'none'`) and the two browser scripts. The Pages workflow publishes `_site/`.
- Interface assets use relative paths, so the same files work under `/` and under `/PhotoDateRenamer/`.

## Consequences

- Design and accessibility changes reach the application and the web together.
- The web version still needs a browser with the File System Access API (Chrome or Edge on a computer). Other browsers see an explanation and a link to the Windows application.
- Naming rules exist in two languages, Python and JavaScript. `tests/web_backend.test.cjs` pins the JavaScript side to the same statuses, reasons and names.
