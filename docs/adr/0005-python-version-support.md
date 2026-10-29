# ADR 0005: Minimum supported Python version

- Status: Accepted
- Date: 2026-10-29

## Context

The project depends on Pillow 13 for image metadata handling, including XMP support. Pillow 13 requires Python 3.11 or newer, while the project previously declared Python 3.10 support. That mismatch made dependency installation fail on Python 3.10 and prevented the configured CI matrix from validating the declared support range.

## Decision

Set Python 3.11 as the minimum supported version. Keep Pillow 13 and test the minimum and newest supported Python versions in CI.

## Consequences

- Python 3.10 is no longer supported.
- Package metadata, Ruff's target version, CI, and user documentation must stay aligned with Python 3.11 as the minimum.
- XMP support remains available without a Python-version-specific Pillow fallback.
- The current CI matrix validates Python 3.11 and 3.14 on Windows, Linux, and macOS.
