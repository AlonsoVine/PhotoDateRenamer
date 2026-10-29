# ADR 0002: Preview before changing filenames

- Status: Accepted
- Date: 2026-10-29

## Context

The original script changes filenames as soon as it starts, without checking duplicate destinations or giving the user an opportunity to inspect the result.

## Decision

Separate planning from execution. The UI displays the proposed names and any skipped files or conflicts before requiring explicit confirmation. Existing or duplicate destination names are conflicts, and an execution-time recheck prevents overwriting a destination that appeared after preview. Keep a session-local undo record for the most recent rename.

## Consequences

- Preview and confirmation are the only UI path for renaming.
- The application may complete only conflict-free items from a preview.
- Undo is available while the application process remains open; it is not a persistent recovery journal.
- Concurrent external filesystem changes can still cause an OS-level operation to fail; errors must be reported and successful prior operations rolled back where possible.
