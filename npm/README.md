# @hlolli/lilypond-wasm

Early access to the SVG-only LilyPond WebAssembly build in this repository.

This package contains:

- `dist/lilypond.wasm`;
- LilyPond Scheme files, input files, music fonts, and text fonts;
- compiled LilyPond Scheme modules for faster start-up;
- the LilyPond Csound Score plugin and its compiled Scheme modules;
- Guile compiled modules needed at run time;
- project and source details in the `lilypond-wasm.metadata` Wasm custom section;
- the full licence and third-party notice trees.

The package does not yet include a browser WASI host or worker. A host must
provide WASI Preview 1, WebAssembly exception handling, the file mounts listed
in `runtimeMounts`, and a writable `/work` directory.

```js
import {
  guileCompiledUrl,
  lilypondCompiledUrl,
  lilypondDataUrl,
  lilypondWasmUrl,
  runtimeEnvironment,
  runtimeMountOrder,
  runtimeMounts,
  runtimeRequirements,
} from "@hlolli/lilypond-wasm";
```

Each exported URL is relative to the installed package. Bundlers and hosts can
copy those files without relying on a Nix store path. The same information is
available in `runtime-manifest.json`.

Hosts must apply `runtimeMounts`, `runtimeEnvironment`, and
`runtimeRequirements`. Some compiled fallback paths record the Nix build
store and are not valid run-time defaults outside that build.

Mount or copy the entries in `runtimeMountOrder`. Guile only loads a compiled
LilyPond module when its file time is the same as, or newer than, its source
file. Hosts that create an in-memory file system should preserve the package
file times, use one fixed time for every run-time file, or write each mount in
the given order. The LilyPond compiled files come after their source files in
that order. `runtime-manifest.json` includes the same `mountOrder` list.

The Guile source search path is left unmounted on purpose. The package has the
matching compiled modules, so the source is not needed at run time. This also
keeps host-created file times from making those compiled modules look stale.
The complete Guile source remains in the source archive named in `SOURCE.md`.

The npm package version tracks this wrapper and bundle format. The
`lilypondVersion` export records the pinned upstream LilyPond version.

## Csound score export

The package bundles the precompiled LilyPond Csound Score plugin. Include it
without adding an include path:

```lilypond
\include "lpcs.ily"
```

The plugin writes `.lpcs.json` and `.sco` files beside the LilyPond output.
It prepares Csound score data, but this package does not include or run
Csound.

## MusicXML export

Include `musicxml.ily`, or pass `-dinclude-settings=musicxml.ily` to LilyPond:

```lilypond
\include "musicxml.ily"
melody = \relative c' { \time 3/4 c4\p d e | f2. }
\score { \new Staff \melody }
```

The exporter writes `<output>.musicxml`, then `<output>-1.musicxml` and so on
for more scores. `musicxmlIncludeUrl` points to the bundled include. It uses
LilyPond's resolved music tree, so variables, includes, relative pitch, and
transposition use the compiler's rules. No Python parser or server is needed.

The initial subset covers pitched notes, chords, rests, skips, voices, piano
staves, exact tuplet durations, ties, simple repeats, pickups, meter changes,
major/minor keys, fixed tempos, common dynamics, slurs, articulations, and
sustain pedal marks. It omits page layout and headers. It exports written
events, not a predicted performance. A PianoStaff or GrandStaff becomes one
MusicXML part; other staves become separate parts.

This is not a full MusicXML backend. Grace notes, repeat alternatives, nested repeats,
tremolos, cross-staff changes, microtones, transposing clefs, custom context
functions/settings, and music outside parallel part contexts fail with a
`MusicXML export:` error. Do not use files from a failed compiler run. Plain
SVG rendering does not enable this exporter and keeps its usual behavior.

For model input without engraving, use `musicxml-only.ily`. The editor worker
accepts `{type: "musicxml", requestId, source}` and returns
`musicxml: [{name, source}]` with empty SVG arrays. It skips page layout.
For both outputs, set `exportMusicXML: true` on a `render` request.
A failed export returns
an error, never an apparently successful XML result. The editor UI does not
yet expose an export button.

Run the export tests with a native compiler or the built WASM package:

```sh
node --test npm/test/musicxml.test.mjs
LILYPOND_WASM_PACKAGE=/path/to/package node --test npm/test/musicxml.test.mjs
cd editor
bun run build
bun run test:musicxml-browser
```

Native tests need `lilypond` and Python 3. WASM tests also need `wasmtime`.
Set `LILYPOND_BIN`, `WASMTIME_BIN`, or `CHROME_PATH` for non-default locations.
The browser test needs Playwright's Chromium or `CHROME_PATH`. Optional
`ANALYZER_BIN` and `MUSICXML_SCHEMA` checks import each result through the
analyzer and validate it with `xmllint`, respectively.

## Licence and source

The JavaScript wrapper and LilyPond Wasm are GPL-3.0-or-later. Bundled data
and fonts keep the terms listed in `THIRD_PARTY_NOTICES.md`. Keep the complete
`licenses/` directory with every copy.

See `SOURCE.md` for the matching source bundle. Do not publish this npm package
without making that source bundle available.
