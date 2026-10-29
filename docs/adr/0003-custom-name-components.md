# ADR 0003: Custom names from validated components

- Status: Accepted
- Date: 2026-10-29

## Context

Users need both ready-made formats and a simple way to concatenate metadata and literal text without writing a template language.

## Decision

Represent a name format as an ordered list of validated components: capture date, original filename, original stem, extension, or literal text. Offer a small set of date formats and presets. Reject generated filenames that are unsafe on Windows.

## Consequences

- Formats are straightforward to preview and can be stored or edited by future interfaces.
- Arbitrary code or formatting expressions are not evaluated.
- New metadata fields can be introduced as explicit tokens with tests.
