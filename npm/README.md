# @hlolli/lilypond-wasm

Early access to the SVG-only LilyPond WebAssembly build in this repository.

This package contains:

- `dist/lilypond.wasm`;
- LilyPond Scheme files, input files, music fonts, and text fonts;
- Guile compiled modules needed at run time;
- project and source details in the `lilypond-wasm.metadata` Wasm custom section;
- the full licence and third-party notice trees.

The package does not yet include a browser WASI host or worker. A host must
provide WASI Preview 1, WebAssembly exception handling, the file mounts listed
in `runtimeMounts`, and a writable `/work` directory.

```js
import {
  guileCompiledUrl,
  lilypondDataUrl,
  lilypondWasmUrl,
  runtimeEnvironment,
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

The Guile source search path is left unmounted on purpose. npm normalizes file
times when packing, which would make Guile reject its matching compiled
modules as stale. The complete Guile source remains in the matching source
archive named in `SOURCE.md`.

The npm package version tracks this wrapper and bundle format. The
`lilypondVersion` export records the pinned upstream LilyPond version.

## Licence and source

The JavaScript wrapper and LilyPond Wasm are GPL-3.0-or-later. Bundled data
and fonts keep the terms listed in `THIRD_PARTY_NOTICES.md`. Keep the complete
`licenses/` directory with every copy.

See `SOURCE.md` for the matching source bundle. Do not publish this npm package
without making that source bundle available.
