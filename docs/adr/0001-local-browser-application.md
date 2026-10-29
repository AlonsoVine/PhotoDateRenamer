# ADR 0001: Local browser application

- Status: Accepted
- Date: 2026-10-29

## Context

The original project is a short Python script that directly renames files in a fixed directory. The product needs a friendly interface while keeping photo content on the user's device and leaving room for future macOS and container adaptations.

## Decision

Keep the portable Python application, which binds an HTTP server to loopback and serves its own browser UI, as the full-featured Windows option. Also publish a separate static browser-only application through GitHub Pages. The static version reads metadata and changes file contents through the browser's File System Access API; it does not call the Python server or upload photos. Keep the Windows Shell folder-picker adapter and package the Python application as a Windows executable.

## Consequences

- The packaged interface communicates only with the local process; the static site runs entirely in a compatible browser.
- Neither interface uploads photos. GitHub Pages serves only the public static application files.
- The browser-only version requires HTTPS and a browser implementing directory selection, read/write access, and writable file streams; Chrome and Edge are the supported browser choices.
- The browser version performs a copy-then-remove operation because a broadly supported atomic rename operation is not available in the File System Access API.
- The Python naming engine and the static browser implementation are separate adapters and must have their own focused tests.
- Docker still needs explicit volume mounts and a future folder-access adapter.
- A packaged executable must include its static web assets and image metadata dependency.
