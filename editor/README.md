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

The default scratchpad has two files. `main.ly` loads `lpcs.ily` and enables
its Csound score and timeline exports. `lpcs.orc` is the orchestra that plays
those score events. Its first comment maps LilyPond notes, ties, dynamics, and
drums to Csound p-fields for users who know LilyPond better than Csound. The
Csound tab has syntax colour, completion, and opcode help from
`@hlolli/codemirror-lang-csound`.

Play reads the current `lpcs.orc` edits, renders the `.sco` file to audio, and
then follows the timeline with a cursor over tagged notes and rests in the SVG
score. In folder mode, Play first uses unsaved edits from an open root
`lpcs.orc`. Otherwise it reads that file from disk. If it does not exist, Play
uses the built-in starter orchestra without writing to the folder.

After a successful render, **Export PDF** downloads one vector PDF page for
each SVG page. The PDF code loads only when it is used and embeds LilyPond’s
C059, Nimbus Sans, and Nimbus Mono PS text faces, so it does not add work to
editor start-up.

## WebMCP

The page registers WebMCP tools through `document.modelContext` when the
browser provides it. The editor works as before when WebMCP is off.

For local Chrome use:

1. Open `chrome://flags/#enable-webmcp-testing`.
2. Enable WebMCP and relaunch Chrome.
3. Open the editor in a WebMCP browser agent.

The tools can read and replace the current LilyPond source, render or cancel a
render, export SVG or PDF files, and control score playback. `play_score`
starts at zero unless it receives `position_seconds`. Separate tools resume,
pause, stop, or seek without changing the source.

Source updates require the revision from `read_workspace`. This check keeps a
new hand edit or folder switch from being replaced by an older tool call. In
folder mode, an update changes the active `.ly` editor buffer and marks it as
changed. It does not save to disk or skip the normal save check. Exports reject
an old render after the source or an open LilyPond include changes. Playback
does the same, so render again before exporting or playing it.

WebMCP runs only in the open tab. The page does not send source to a model by
itself, but a browser agent can read source when asked to use these tools.

The interface includes Lekton by the Accademia di Belle Arti di Urbino. The
font is available under the SIL Open Font License 1.1, whose full text is
embedded in the font file. The build also copies the Csound and LilyPond
licence and third-party notice files into `dist/`.
