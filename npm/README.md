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

## Licence and source

The JavaScript wrapper and LilyPond Wasm are GPL-3.0-or-later. Bundled data
and fonts keep the terms listed in `THIRD_PARTY_NOTICES.md`. Keep the complete
`licenses/` directory with every copy.

See `SOURCE.md` for the matching source bundle. Do not publish this npm package
without making that source bundle available.
