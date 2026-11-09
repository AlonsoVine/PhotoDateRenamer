# ADR 0009: Date cache for previews and a persistent last batch

- Status: Accepted
- Date: 2026-11-09

## Context

Every change to the name format re-read the metadata of every photo, which takes seconds for thousands of files. The interface also showed undo only on the result view: choosing another folder made the batch impossible to undo, even though the confirmation dialog promised otherwise. A crash in the middle of applying a batch lost the undo record entirely, because the server stored it only after `apply_plan` returned.

## Decision

- `create_preview` accepts an optional `date_cache`, keyed by the path and the file fingerprint (device, inode, size, mtime, ctime).
  - A changed file is read again.
  - Proposed names are identical with and without the cache.
  - The loopback adapter keeps one cache per analysed folder, capped at 200,000 entries.
- `apply_plan` accepts `on_renamed`, called after each successful move. The adapter records each move as it happens, so an interrupted batch can still be undone.
- The adapter keeps the run's root folder with the run, and exposes `POST /api/last-run`. The interface shows a «Último lote» bar in every view until another batch renames its first file. A batch that renames nothing leaves the previous one undoable.

## Consequences

- Format changes refresh the preview almost instantly, and the sheet keeps its filter, search and selection.
- Undo no longer depends on the result view or on the folder currently analysed.
- The cache holds only dates and date sources, in memory, for the life of the process.
