# Agent and contributor guidance

## Project intent

PhotoDateRenamer is a local-first desktop utility for organizing photo filenames from image metadata and, as a last resort, filesystem timestamps. User files must stay on the user's device.

## Architecture

- Keep file-naming and filesystem rules in `src/photodaterenamer/renamer.py`.
- Keep the loopback HTTP adapter in `server.py`; keep browser assets under `web/`.
- Keep platform-specific folder selection and packaging out of the naming engine.
- Bind the local application only to loopback. Do not add a remote upload or network service.
- Preview must be generated before a user confirms file changes. Preserve collision checks and undo behavior.

## Before changing behavior

1. Read the relevant source, tests, and current ADRs.
2. Add or update tests for behavior changes.
3. Run `python -m unittest discover -s tests -v`.
4. Update `CHANGELOG.md` for user-visible changes.
5. Add or update an ADR in `docs/adr/` when an architectural decision changes.
6. Update this file when project-wide agent or contributor rules change.
7. Follow the Conventional Commits format documented in `CONTRIBUTING.md`.

## Quality and scope

- Prefer the standard library unless a dependency clearly serves the product.
- Keep error messages explicit; do not silently report successful file operations when they failed.
- Do not rename or modify user files without an explicit confirmation step.
- Keep platform adaptations behind small interfaces so macOS and container support can be explored later.
- Avoid unrelated refactors and do not commit generated build artifacts.
