# LilyPond Csound Score

LilyPond Csound Score (LPCS) exports performance events during a LilyPond
layout pass. It writes:

- semantic JSON events to `*.lpcs.json`
- a Csound score to `*.sco`, with one fixed 28-field layout
- an optional reference timeline to `*.lpcs.timeline.json`
- repeat-aware gestures to `*.lpcs.gestures.json` when the score uses
  `\csoundGesture`

This repository contains a tested v0.3 implementation.

Local tests use native LilyPond 2.24.4. The code targets native LilyPond
2.24 and later. LilyPond 2.26 CI has not run yet. LilyPond WASM support
comes later.

Version 0.3 uses semantic IR version 3. It adds:

- mapped unpitched percussion
- links from explicit gestures to IR events
- a gesture sidecar
- repeat-aware notation ids
- unique playback ids

The timeline and gesture formats remain at version 1. The fixed 28-field
Csound ABI still uses marker `1000` in `p4`.

LPCS does not parse LilyPond source text. It does not use MIDI as an
intermediate form.

## Quick start

You need:

- `just`
- native LilyPond 2.24 or later
- Guile for the stand-alone Scheme tests
- Csound 7 or later
- `jq`
- a POSIX shell

CI builds Csound from its upstream `develop` branch. Ubuntu's Csound 6
package is too old for this adapter.

Run all five test layers:

```sh
just test
```

Run one layer:

```sh
just test-scheme
just test-contract
just test-lilypond
just test-csound
just test-e2e
```

Build the native examples:

```sh
just build
```

The recipes accept tool overrides:

```sh
LILYPOND=/path/to/lilypond GUILE=/path/to/guile CSOUND=/path/to/csound just test
```

Use `just`, not `make`, for builds and tests.

## LilyPond API

Add the repository's `src` directory to LilyPond's include path. Then include
the plug-in:

```lilypond
\version "2.24.0"
\include "lpcs.ily"

\csoundExportOptions #'(
  (output . "piece")
  (strict . #t)
  (adapter-instrument . 17)
  (target . "trace")
  (default-level . 0.70)
  (drum-map . ((bassdrum . 36) (snare . 38)))
  (emit-timeline . #t)
  (reference-sample-rate . 48000)
  (cursor-tail-policy . "freeze")
)

\score {
  \new Staff {
    \new Voice = "lead" {
      \csoundUnfoldForExport {
        \tempo 4 = 90
        c'4~ c'4-. d'4(-> e'4)
      }
    }
  }
  \layout { }
}
```

Compile it with native LilyPond:

```sh
lilypond -I "$PWD/src" -o build/piece piece.ly
```

LilyPond changes to the `-o` directory before it reads the score. A relative
`output` stem starts there.

The command above writes:

- `build/piece.lpcs.json`
- `build/piece.sco`
- `build/piece.lpcs.timeline.json` when timeline output is on

Use an absolute include path when `-o` names another directory. If you omit
`output`, LPCS uses LilyPond's output path.

The options are:

| Option | Value | Default |
| --- | --- | --- |
| `output` | output path stem | LilyPond output path |
| `strict` | Scheme boolean | `#t` |
| `adapter-instrument` | positive integer | `17` |
| `target` | target id string | `"trace"` |
| `default-level` | number from 0 through 1 | `0.70` |
| `drum-map` | semantic drum name to positive target id pairs | built-in trace map |
| `emit-timeline` | Scheme boolean | `#f` |
| `reference-sample-rate` | positive exact integer | `48000` |
| `cursor-tail-policy` | `"freeze"`, `"fade"`, or `"hide"` | `"freeze"` |

`\csoundUnfoldForExport` assigns notation ids before it unfolds repeats.
Each playback pass shares those notation ids. Each pass still gets unique
playback ids.

Use `\csoundPrepareMusic` when you need ids without repeat unfolding. Strict
timeline output requires one of these two functions.

Treat all ids as opaque. They stay stable only among copies from one prepared
music tree in one export. A new run or source edit may change them.

Without preparation, non-strict timeline export assigns fallback ids to
playback occurrences.

You can also set `csoundTarget` on a voice or staff:

```lilypond
\set Voice.csoundTarget = "trace"
```

The checked-in [trace target](targets/trace.json) records the built-in policy.
The exporter does not load target manifest files at run time yet.

The target id goes into event metadata. The adapter instrument sets the score
instrument number. The exporter applies the fixed built-in trace rules.

The [graphical-native target](targets/graphical-native.json) lists the
dimension codes in the worked native-resource example. The current exporter
does not select or emit that native form.

## Unpitched percussion

Use a `DrumVoice` and map each semantic drum name to a positive target id:

```lilypond
\csoundExportOptions #'(
  (strict . #t)
  (target . "trace")
  (drum-map . (
    (bassdrum . 36)
    (snare . 38)
    (hihat . 42)
  ))
)

\score {
  \new DrumStaff {
    \new DrumVoice {
      \csoundPrepareMusic \drummode { bd4 sn4 hh4 }
    }
  }
  \layout { }
}
```

LPCS reads LilyPond's resolved `drum-type`, such as `bassdrum`.

It does not use any of these values to find the key:

- staff position
- note-head shape
- the drum style table

Moving or redrawing a drum note does not change its sound.

A custom LilyPond drum alias works when its resolved name appears in
`drum-map`. Names may be Scheme symbols or strings. Each name must be unique.
Each id must be a positive integer.

IR v3 writes an unpitched event with:

- `kind: "unpitched-percussion"`
- `pitch: null`
- a `drumKey` object that holds the name and mapped id

Its Csound event writes `p8 = -1` and `p9 = -1`. It writes the positive drum
id in `p10`.

A pitched event writes its pitch in `p8` and `p9`. It writes `p10 = -1`.
LPCS does not yet support an event that needs both a pitch and a semantic
percussion key.

The default trace map covers:

- `bassdrum`
- `sidestick`
- `snare`
- `hihat`
- `closedhihat`
- `lowtom`
- `openhihat`
- `hightom`
- `crashcymbal`
- `ridecymbal`

Set `drum-map` when a target uses other names or ids.

In strict mode, an unmapped drum key stops export. Non-strict mode reports
the error and omits that event.

The trace manifest records the default map. A `drum-map` option replaces the
whole map for one export. Add each default entry that the score still needs.

These outputs state the final mapping:

- the resolved IR `drumKey`
- gesture percussion data
- score `p10`

## Explicit gestures

`\csoundGesture` adds named semantics to a positive-length block of music:

```lilypond
clusterGesture = \csoundGesture #'(
  (kind . "cluster")
  (render-strategy . "expand")
  (sync-mode . "region")
  (dimensions . (
    (level . (
      (type . "scalarCurve")
      (unit . "normalized")
      (curve . (
        (interpolation . "linear")
        (points . (
          ((position . (0 1)) (value . 0.3))
          ((position . (1 1)) (value . 0.8))
        ))
      ))
    ))
  ))
  (techniques . ("cluster"))
  (seed . 0)
  (graphical-source . #t)
) {
  \makeClusters {
    <c' e' g'>2 <d' f' a'>2
  }
}
```

The current exporter accepts two lowering strategies.

`expand`:

- exports the pitched or mapped drum events already inside the block
- links those IR v3 events to the gesture
- lists their event ids in the gesture file
- keeps each pitch in `\makeClusters` as one child event

LilyPond drops the source origin of each pitch in a cluster. Those child
events use the source position of the chord that contains them. LPCS does
not create notes from `dimensions`.

`preserve`:

- records the semantic gesture
- leaves `lowering.eventIds` empty
- emits no gesture-linked score event

Ordinary notes inside a `preserve` block still export as ordinary events.
They have no gesture link. Use time-bearing skips when the block must remain
sidecar-only.

A gesture makes LPCS write both of these files:

- `*.lpcs.gestures.json`
- `*.lpcs.timeline.json`

This happens even when `emit-timeline` is false.

Put gesture music inside `\csoundPrepareMusic` or
`\csoundUnfoldForExport`. The latter assigns one notation gesture id before
it unfolds repeats. Each playback pass keeps that shared notation gesture
id. It also gets its own numeric gesture id and resolved time.

The four sync modes are:

- `anchor`
- `region`
- `horizontalProgress`
- `pathProgress`

They tell a frontend what it may show. They do not supply sound data.

The exporter leaves each `sync.svgId` set to null. A separate SVG step can
add an explicit link.

`graphical-source` defaults to false. Set it to true only when an explicit
graphic is part of the authored gesture.

## Strict export

Strict mode follows one rule. An in-scope performance event must meet one of
these conditions:

- it maps to the fixed score fields
- it remains in JSON metadata
- it stops the export

It must not vanish without a report.

The built-in target supports these articulations:

- `staccato`
- `tenuto`
- `accent`
- `marcato`

It supports `pp`, `p`, `mp`, `mf`, `f`, and `ff` when the mark lives in a
`Voice`.

A separate `Dynamics` context needs a routing rule. Strict v0.3 rejects it.

In strict mode, an unknown in-scope articulation or performance event stops
export. In non-strict mode, LPCS adds a warning. It also keeps the source
term when the current IR has a place for it.

Layout marks do not enter the performance contract. Rests do not become
events. They remain gaps in score time.

Collected score time can extend `scoreEnd`. This includes a trailing rest or
skip.

## Contract

[Contract v0.3](docs/contract-v0.3.md) defines IR v3, percussion, and the
gesture sidecar.

[Contract v0.2](docs/contract-v0.2.md) and
[contract v0.1](docs/contract-v0.1.md) record the older forms.

[TIMECODES.md](TIMECODES.md) explains how a frontend should:

- load the files
- update a cursor or gesture
- handle repeats
- seek rendered media

Machine-readable files live here:

- [JSON IR schema](schemas/lpcs-ir.schema.json)
- [timeline schema](schemas/lpcs-timeline.schema.json)
- [gesture schema](schemas/lpcs-gestures.schema.json)
- [target schema](schemas/lpcs-target.schema.json)
- [score ABI definition](schemas/lpcs-score-abi.json)
- [trace target](targets/trace.json)
- [graphical native target](targets/graphical-native.json)
- [worked examples](docs/examples)

The checked-in worked files are hand-written, abridged contract examples.

The Csound score starts with `C 0`. Every `i` line has all 28 fields.

When `scoreEnd` is greater than zero, the score writes `f 0 scoreEnd`. This
keeps Csound open through collected trailing rests and skips.

Score time stays in exact quarter-note beats until LPCS writes the score.

Ties reuse one tagged `p1`. Non-final tie parts have a negative `p3`. The
final part has a positive `p3`.

The timeline uses the same compiled tempo map as the Csound `t` statement.
Frames use the chosen reference sample rate and nearest-half-up rounding.
They provide a sample-frame reference. The exporter does not render or
inspect a WAV file.

Score-file `p2` and `p3` use quarter-note beats. Csound applies the `t` map
before an instrument runs. The adapter therefore sees a tempo-scaled `p3` in
seconds. Its sign still marks a held or releasing tie segment.

## Current limits

- Native LilyPond 2.24.4 has local test coverage.
- LilyPond 2.26 CI is pending.
- Csound 7.0 has local contract and end-to-end coverage.
- LilyPond WASM support is deferred.
- Run-time target manifest loading is deferred.
- Grace time stays exact in JSON.
  - Strict score export rejects a non-zero grace component in v0.3.
  - Non-strict export uses `onset.main`.
  - Non-strict export leaves `resolvedPerformanceQbeat` null.
  - Non-strict export omits the event from cursor-point event id lists.
- Slurs remain metadata. They do not change note time or pitch.
- Unpitched percussion needs an explicit semantic drum map.
- Pitched percussion has no separate drum-key identity yet.
- Gesture meaning comes only from `\csoundGesture`.
  - LPCS does not infer sound from staff position, markup, stencils, paths,
    or other graphics.
- Inside an explicit `expand` gesture, `\makeClusters` exports its pitches as
  child events.
  - LPCS does not derive a pitch band or other cluster controls.
  - LPCS does not turn glissandi, tremolos, rolls, or ornaments into
    gestures.
- The current gesture writer supports only metric `expand` and `preserve`.
  - It emits no native Csound table resources.
  - `csoundResources` stays empty.
  - Generated `p25` through `p27` stay zero.
- A voice cannot nest one `\csoundGesture` inside another.
- Gestures in separate voices may overlap.
- `direct` and `native` lowering remain contract-only and deferred.
- Their resource records also remain contract-only and deferred.
- These native LilyPond events need later target rules:
  - hairpins
  - text techniques
  - repeat ties
  - laissez-vibrer ties
  - glissandi
  - tremolos
  - ornaments
  - sustain
  - sostenuto
  - una corda
  - bend-after
  - fermata timing
- Use `\csoundUnfoldForExport` for repeat-aware playback order and shared
  folded notation ids.
  - Plain `\unfoldRepeats` has playback order.
  - It cannot recover folded identity.
  - Fallback ids name only the resulting playback occurrences.
- Timeline v1 records note, rest, skip, score-moment, and note-end points.
- The SVG backend tags note heads and rests with timeline identity data and
  tags staff symbols for DOM bounds. Timeline v1 still has no page map, full
  system geometry, or singular enriched `svgId` values.
- WAV rendering, media tails, browser seeking, and live Csound state rebuild
  stay outside v0.3.
- One LilyPond run may export one `Score` block to a given output stem.

## License

LPCS is licensed under the [GNU General Public License, version 3](LICENSE).
