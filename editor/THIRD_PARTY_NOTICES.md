# Third-party notices

This editor ships code, fonts, and run-time data from the projects below.
Each project keeps its own licence terms.

The editor code uses GPL-3.0-or-later. The full terms are in
[LICENSE](LICENSE) and [COPYING](COPYING). Its exact source snapshot and
revision are in the [editor source record](EDITOR_SOURCE.md).

## LilyPond WASM run time

The editor uses `@hlolli/lilypond-wasm@0.1.0-alpha.4`. Its full dependency
list and licence links are in the bundled
[LilyPond WASM notices](licenses/lilypond-wasm/THIRD_PARTY_NOTICES.md).
The output also keeps the LilyPond assets and Csound score plugin licence
trees under `licenses/`.

## Csound browser host

The player uses `@csound/browser@7.0.0-beta31` under the
[Apache License 2.0](licenses/csound-browser/LICENSE). Its vendored code and
run-time package credits are in the
[Csound third-party list](licenses/csound-browser/THIRD_PARTY.md).

## Csound CodeMirror mode

Csound source editing uses `@hlolli/codemirror-lang-csound@1.0.0-alpha11`,
declared under LGPL-2.0. Its npm tarball omits the declared licence file, so
the build supplies the standard GNU Library GPL version 2 text at
[`licenses/npm/@hlolli/codemirror-lang-csound/LICENSE`](licenses/npm/%40hlolli/codemirror-lang-csound/LICENSE).
The package's opcode help text comes from the Public Csound Reference Manual
under GFDL-1.2-or-later. The [manual notice and full terms](licenses/npm/%40hlolli/codemirror-lang-csound/CSOUND_MANUAL_COPYING)
ship beside the package's own third-party notice, which credits the
MIT-licensed Csound grammar code that it adapts. The source snapshot keeps the
exact published bundle and the preferred source and build files from its
pinned tag.

## Browser package bundle

The production build records every npm package that Bun includes in the
browser code. It copies each package's top-level licence and notice files,
plus its package metadata, under [`licenses/npm`](licenses/npm/README.md).
Two npm tarballs omit their declared MIT text, so the source tree supplies
that text from upstream source or the package metadata. The published
`@napi-rs/wasm-runtime` file-system module is itself a prebundle; the build
also keeps its [embedded third-party terms](licenses/npm/%40napi-rs/wasm-runtime/PREBUNDLED_THIRD_PARTY_NOTICES.md).
That list covers CodeMirror, Lezer, the LilyPond and Csound language modes, the
Wasm file system helpers, Csound's loaded run time, and their bundled
dependencies.

The vector PDF export uses `pdfkit` and `svg-to-pdfkit` under the MIT licence.
PDFKit publishes its browser build as one prebuilt file, so Bun cannot list
all code packed inside it. The build keeps the exact published file and its
embedded notices as
[`PREBUNDLED_SOURCE.js`](licenses/npm/pdfkit/PREBUNDLED_SOURCE.js), with a
[prebuilt-code record](licenses/npm/pdfkit/PREBUNDLED_THIRD_PARTY_NOTICES.md).
The C059, Nimbus Sans, and Nimbus Mono PS fonts come from the LilyPond run time
and remain covered by the URW Base35 terms in the canonical LilyPond WASM
licence tree.

## Lekton

Copyright (c) 2008, 2009, 2010, Accademia di Belle Arti di Urbino.

Lekton is available under the SIL Open Font License, Version 1.1. The full
licence text is embedded in the bundled
[font file](licenses/lekton/Lekton-Regular.ttf).
