# LilyPond WASM editor

This private Bun package builds the browser editor deployed at
<https://hlolli.github.io/lilypond/>. The build owns its browser code, tests,
LilyPond run-time pack, Csound player dependency, fonts, and licence files.

Install and check it from this directory:

```sh
bun install --frozen-lockfile
bun run test
bun run build
```

`bun run dev` builds the editor and serves `dist/` on localhost. The output is
self-contained, so another repository can copy `editor/dist/` to any static
site path without rebuilding or repacking the LilyPond run time.

The editor uses the exact published `@hlolli/lilypond-wasm` version in
`package.json`. Update that pin only after its matching npm release is public.
The `npm/` directory at the repository root is a release template and does not
contain the generated Wasm or run-time files.

The interface includes Lekton by the Accademia di Belle Arti di Urbino. The
font is available under the SIL Open Font License 1.1, whose full text is
embedded in the font file. The build also copies the Csound and LilyPond
licence and third-party notice files into `dist/`.
