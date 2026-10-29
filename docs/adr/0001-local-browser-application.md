# ADR 0001: Local browser application

- Status: Accepted
- Date: 2026-10-29

## Context

The original project is a short Python script that directly renames files in a fixed directory. The product needs a friendly interface while keeping photo content on the user's device and leaving room for future macOS and container adaptations.

## Decision

Use a Python application that binds an HTTP server to loopback only and serves its own static browser UI. Keep EXIF and filesystem operations in a separate naming engine. Start with a Windows Shell folder-picker adapter and Windows packaging; defer platform-specific adapters for macOS and Docker.

## Consequences

- The interface needs no separately installed browser framework or frontend server.
- The browser communicates only with the local process, and the application never uploads photos.
- The engine can be reused by other interfaces.
- Docker cannot browse arbitrary host folders without explicit volume mounts and a future folder-access adapter.
- A packaged executable must include its static web assets and image metadata dependency.
