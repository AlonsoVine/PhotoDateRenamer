# Contributing

## Local setup

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
python -m unittest discover -s tests -v
```

The test suite uses temporary folders and generated images. It must not depend on or rename the example image in the repository.

## Change checklist

- Keep name construction and filesystem behavior in the `renamer` module.
- Add tests for changed behavior and run the complete unit suite.
- Keep user-visible changes in `CHANGELOG.md`.
- Record significant architectural choices in `docs/adr/`.
- Update `README.md` when installation, operation, packaging, or project structure changes.
- Keep agent-specific workflows and project-wide constraints in `AGENTS.md`.
- Do not commit generated `.venv/`, `build/`, `dist/`, or PyInstaller spec files.

## Commit messages

Use the Conventional Commits shape:

```text
<type>(<optional scope>): <short imperative summary>
```

Common types are `feat`, `fix`, `docs`, `test`, `build`, and `chore`. Example: `fix(preview): invalidate stale rename plans`.
