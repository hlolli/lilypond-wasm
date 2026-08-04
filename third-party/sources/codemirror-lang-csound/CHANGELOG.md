# Changelog

## 1.0.0-alpha11 - 2026-07-30

- Move builds, tests, and local development to Bun.
- Replace the separate CSD, ORC, and SCO grammars with one parser.
- Add Csound 7 syntax for typed names, structs, modern UDOs, arrays, loops,
  switches, raw strings, preprocessors, and typed opcode calls.
- Add parser tests and scan all 1,256 files in the Csound test suite.
- Fix global constant highlighting, including the full `0dbfs` token.
- Export the three language modes and their shared `csound` helper.
- Add package exports, generated declarations, and third-party notices.

This alpha changes syntax-tree node names. It also limits package imports to
the public root export.
