# LilyPond–Csound Contract v0.3

## Status

Version 0.3 adds mapped unpitched percussion, semantic IR version 3, and a
gesture sidecar. It builds on [contract v0.2](contract-v0.2.md), which
introduced identity and the playback timeline. The 28-field Csound score
layout comes from [contract v0.1](contract-v0.1.md). Those two files remain
as records of the older forms.

This file states both the v0.3 data model and the smaller part that the
current native exporter writes. The current exporter:

- reads pitched notes and mapped unpitched `DrumVoice` events;
- writes IR v3 and timeline v1;
- writes gesture sidecar v1 only for an explicit `\csoundGesture`;
- supports `expand` and `preserve` gesture lowering;
- writes metric gesture timing; and
- writes no native Csound table resources.

The schema also reserves `direct`, `native`, other source timing modes, and
Csound resource records. Those forms remain contract-only and deferred in
the native exporter.

The versions are:

| Data | Format version |
| --- | ---: |
| Semantic IR | `3` |
| Timeline sidecar | `1` |
| Gesture sidecar | `1` |
| Csound score ABI marker in `p4` | `1000` |

The gesture schema is
[lpcs-gestures.schema.json](../schemas/lpcs-gestures.schema.json). The worked
files are:

- [gesture sidecar](examples/basic.lpcs.gestures.json);
- [linked IR v3](examples/graphical-piece.lpcs.json);
- [linked timeline v1](examples/graphical-piece.lpcs.timeline.json); and
- [linked Csound score](examples/graphical-piece.sco).

The linked worked set uses the
[graphical-native target](../targets/graphical-native.json). That manifest
assigns dimension codes for the reserved native-resource example. It does
not mean that the current exporter emits native resources.

This addendum does not make an arbitrary LilyPond stencil a performance
instruction.

## Main rules

The exporter must follow these rules:

1. Read performance meaning from music events or an explicit gesture object.
2. Never infer a drum key from staff position or note-head shape.
3. Never infer pitch, level, density, or another control from SVG geometry.
4. Keep the source timing rule and one fixed resolved timing interval.
5. State how a frontend should show each gesture.
6. Keep `p1` through `p28` and `p4 = 1000`.

A change to engraving must not change sound unless it also changes the
semantic gesture.

## Semantic IR v3

IR v3 keeps the v0.2 time, tempo, source, voice, tie, slur, and identity
fields. It adds three required event fields:

- `kind`, either `"pitched"` or `"unpitched-percussion"`;
- `drumKey`, either a semantic name/id object or null; and
- `gesture`, either a gesture link or null.

A pitched event has a numeric `pitch` and null `drumKey`. An unpitched
percussion event has null `pitch` and a `drumKey` with a non-empty `name` and
positive integer `id`.

An event inside an explicit gesture has:

```json
{
  "gesture": {
    "id": 7,
    "notationGestureId": "ng-000003",
    "loweringStrategy": "expand"
  }
}
```

The numeric id names the resolved gesture occurrence. The notation id may
be shared by repeat copies. Events outside a gesture use `gesture: null`.
The IR event rule remains:

```text
event.id == event.playbackOccurrenceId
```

Timeline v1 stays at version 1 but writes `source.irVersion: 3`. A consumer
must reject an unknown IR version rather than treating v3 as v2.

## File

When the score contains `\csoundGesture`, the exporter writes:

```text
piece.lpcs.gestures.json
```

The top object is:

```json
{
  "format": "lpcs-gestures",
  "version": 1,
  "timeUnit": "quarter-note",
  "source": {
    "file": "piece.ly",
    "ir": "piece.lpcs.json",
    "irVersion": 3,
    "timeline": "piece.lpcs.timeline.json",
    "timelineVersion": 1
  },
  "target": "stringMass",
  "identityMode": "prepared",
  "render": {
    "sampleRate": 48000,
    "frameRounding": "nearest-half-up",
    "timingMode": "sample-accurate-reference"
  },
  "csoundResources": [],
  "gestures": [],
  "warnings": []
}
```

The `source.ir` and `source.timeline` strings come from the chosen output
stem and may be relative or absolute. A package must resolve relative values
from the gesture file and must not expose an absolute build path as a public
URL.

The native exporter writes this file when it sees at least one
`\csoundGesture`. It also writes the timeline, even when `emit-timeline` is
false. Strict export requires prepared identity.

The render fields must match the timeline render fields. Integer frames are
the stable clock. Frontends must not rebuild them from floating-point
seconds.

The worked set is hand-written. It shows cross-file ids and schema forms,
including a reserved native resource form that the current exporter does not
emit.

## Gesture identity

Each resolved playback occurrence has:

```json
{
  "id": 301,
  "playbackOccurrenceId": 301,
  "notationGestureId": "ng-000001",
  "notationAnchorIds": ["na-000004"]
}
```

`id` and `playbackOccurrenceId` must be equal and unique in one gesture
file. `notationGestureId` and notation anchor ids are opaque strings.

Preparation follows v0.2. Two unfolded repeat occurrences may share a
`notationGestureId` and notation anchor ids, but they must have different
numeric occurrence ids and resolved times. Consumers must not parse a
numeric suffix from an opaque id.

The native preparation functions also cover gestures:

- `\csoundPrepareMusic` assigns notation event, anchor, and gesture ids.
- `\csoundUnfoldForExport` assigns those ids before it unfolds repeats.

For a gesture inside a repeat, the second function keeps one shared
`notationGestureId` and creates one numeric gesture id and resolved interval
for each playback pass.

## Native LilyPond gesture API

The native API is:

```lilypond
\csoundGesture #'(
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
          ((position . (0 1)) (value . 0.2))
          ((position . (1 1)) (value . 0.8))
        ))
      ))
    ))
  ))
  (techniques . ("cluster"))
  (seed . 0)
  (graphical-source . #t)
  (control-only . #f)
) {
  \makeClusters {
    <c' e' g'>1
  }
}
```

`kind` is a name supplied by the author. The exporter does not inspect that
name to derive a cluster range, a glissando, a tremolo, or any other native
control. `dimensions` and `techniques` are also explicit input.

The wrapped music must have a positive metric duration. One voice must not
nest a `\csoundGesture` inside another. Gestures in separate voices may
overlap. The current exporter accepts only these strategies:

- `expand` keeps the ordinary pitched or mapped drum events in the wrapped
  music. It links each event to the gesture in IR v3 and lists each id in
  `lowering.eventIds`. For `\makeClusters`, each underlying pitch becomes an
  expand child. LilyPond drops each cluster pitch's source origin, so the
  exporter uses the containing chord's source position for those children.
  It does not create events from a curve or a graphic.
- `preserve` writes the semantic gesture with `lowering.eventIds: []` and
  emits no gesture-linked score event. Any ordinary notes inside the block
  still export as ordinary events with `gesture: null`. An author should use
  skips when the block must remain sidecar-only.

The native writer always emits `sourceTiming.mode: "metric"` and derives
the resolved qbeat and frame bounds from the wrapped music and the shared
tempo map.

## Source and resolved timing

`onset` keeps the exact LilyPond moment:

```json
{
  "main": [3, 1],
  "grace": [0, 1]
}
```

Rational values use two-integer arrays, not strings. Writers must reduce
fractions and keep the denominator positive. Zero is `[0,1]`.

`sourceTiming.mode` records what the notation says:

| Mode | Required source value |
| --- | --- |
| `metric` | `durationQbeat` |
| `proportional` | `minimumSeconds` and `maximumSeconds` |
| `explicitSeconds` | `durationSeconds` |
| `open` | No duration bound |

Every contract mode also has one `resolvedTiming`:

```json
{
  "startQbeat": [3, 1],
  "endQbeat": [12, 1],
  "startFrame": 96000,
  "endFrame": 384000
}
```

This is the chosen performance result, not another source claim. An offline
export must not leave the end open or ask a frontend to choose it.

An artifact must pass these checks:

- `endQbeat` must not precede `startQbeat`.
- `endFrame` must not precede `startFrame`.
- Frames must come from the same tempo map, sample rate, and absolute
  nearest-half-up rule as timeline v1.
- A metric duration must equal `endQbeat - startQbeat`.
- A proportional result must stay within its inclusive second bounds when
  measured as `(endFrame - startFrame) / sampleRate`.
- An explicit-seconds result must satisfy
  `endFrame - startFrame = roundHalfUp(durationSeconds * sampleRate)`.
- A non-zero grace part needs a target rule that produces the resolved start.
  Strict export fails when no such rule exists.

An `anchor` sync gesture may have equal start and end values. The other sync
modes need a positive interval.

The current native exporter produces only positive metric intervals. It
does not produce `proportional`, `explicitSeconds`, or `open`.

## Dimensions

`dimensions` maps camel-case dimension names to typed values. Common names
include:

```text
pitchCenter
pitchBand
level
pan
densityHz
rateHz
position
pressure
brightness
roughness
azimuthDeg
elevationDeg
distance
```

Version 1 has four dimension types:

| Type | Meaning |
| --- | --- |
| `scalarCurve` | One numeric curve |
| `rangeCurve` | Separate low and high numeric curves |
| `categoricalSteps` | Named values that change at set positions |
| `distributionSteps` | Weighted numeric outcomes that change at set positions |

The native writer checks and copies the author-supplied dimension objects
into the sidecar. It does not sample them, turn them into notes, or derive
them from engraving. The schema and the checks below define the accepted
shape.

A scalar curve is:

```json
{
  "type": "scalarCurve",
  "unit": "normalized",
  "curve": {
    "interpolation": "linear",
    "points": [
      {"position": [0, 1], "value": 0.2},
      {"position": [1, 1], "value": 0.9}
    ]
  }
}
```

`position` is an exact normalized rational. Zero means gesture start and one
means gesture end. Writers must sort points by position. Positions must stay
from `[0,1]` through `[1,1]`. Equal positions are only valid for `step`
curves, where the last point at that position wins.

The current native writer preserves the supplied point order. Authors must
therefore provide points in contract order; the writer does not fix them.

For `rangeCurve`, every low value must not exceed the matching high value.
Each list must cover the full interval when the target needs a continuous
control.

Each outcome weight in `distributionSteps` is a positive rational. The
weights at one change must sum to one. A non-zero fixed lowering seed is
required when a target samples a distribution or makes another random
choice. An `expand` lowering also records every generated event id.

## Percussion

LilyPond keeps a drum event's `drum-type` apart from its printed staff
position and note-head style. The native exporter reads that semantic key
after LilyPond resolves `\drummode`. It never uses a drum style table, staff
position, or note-head shape to choose sound.

The `drum-map` export option maps each semantic name to a positive target id:

```scheme
(drum-map . (
  (bassdrum . 36)
  (snare . 38)
  (hihat . 42)
))
```

Keys may be Scheme symbols or strings. Names must be unique and ids must be
positive integers. The built-in trace map is:

| Key | Id |
| --- | ---: |
| `bassdrum` | 36 |
| `sidestick` | 37 |
| `snare` | 38 |
| `hihat`, `closedhihat` | 42 |
| `lowtom` | 45 |
| `openhihat` | 46 |
| `crashcymbal` | 49 |
| `hightom` | 50 |
| `ridecymbal` | 51 |

A custom LilyPond drum alias works when its resolved key appears in this
map. A custom staff style may move or redraw the note without changing the
key. An unmapped key stops strict export. Non-strict export reports a warning
and omits that event. The trace target manifest records this default map.
The `drum-map` option replaces the whole map for one export, so the author
must repeat each default entry that the score still needs. Since the exporter
does not load manifests yet, the resolved IR `drumKey`, gesture percussion
fields, and score `p10` state the result for that export.

IR v3 records:

```json
{
  "kind": "unpitched-percussion",
  "pitch": null,
  "drumKey": {
    "name": "hihat",
    "id": 42
  }
}
```

A gesture whose linked events all have the same drum key may also record:

```json
{
  "percussion": {
    "drumKey": "hihat",
    "drumKeyId": 42,
    "pitched": false
  }
}
```

Gesture sidecar v1 covers unpitched percussion. Its `pitched` field must be
`false`. The score writer sets `p8 = p9 = -1` and writes the positive target
drum key id in `p10`. The score metadata also keeps the semantic name and id.

All pitched events use `kind: "pitched"`, a numeric `pitch`, and
`drumKey: null`. Their `p8` and `p9` hold pitch and `p10` stays `-1`. The
exporter rejects one event that carries both a pitch and a drum key. A
separate pitched-percussion key mapping remains deferred.

The fixed fields keep these uses:

| Meaning | Field |
| --- | --- |
| Start and end pitch | `p8`, `p9` |
| Positive unpitched drum key id, else `-1` | `p10` |
| Start and end level | `p11`, `p12` |
| Start and end pan | `p14`, `p15` |
| Attack and release | `p17`, `p18` |
| Persistent techniques | `p19`, `p20` |
| Reserved ornament type | `p21` |
| Reserved ornament rate | `p24` |
| Reserved target extensions | `p25` through `p27` |

The current exporter writes zero in `p19` through `p27`. Choke, damp,
let-ring, roll, and tremolo marks need later target rules.

## Lowering to the fixed score ABI

The gesture schema defines four lowering strategies:

| Strategy | Result |
| --- | --- |
| `direct` | One ordinary 28-field event |
| `expand` | One or more ordinary 28-field child events |
| `native` | One 28-field gesture event plus a Csound table bundle |
| `preserve` | No gesture-linked event; ordinary wrapped notes still export |

The current native API accepts only `expand` and `preserve`. `direct` and
`native` are reserved.

For `expand`, the wrapped LilyPond notes or mapped drums remain ordinary
28-field events. The sidecar lists their ids and IR v3 links each event back
to the gesture. The underlying pitches of `\makeClusters` also become child
events. Their source location is the containing chord because LilyPond drops
the pitch origins. The exporter does not create children from `dimensions`.

For `preserve`, `lowering.eventIds` is empty and the semantic gesture emits
no gesture-linked score event. A note inside the wrapper still follows the
ordinary note path with `gesture: null`. Use skips for a sidecar-only span.

`reject` is not a stored strategy. It is an export error.

Three booleans make flag selection clear:

- `graphicalSource` says that an explicit graphic supplied the gesture.
- `controlOnly` says that the event controls another process and makes no
  sound on its own.
- `stochastic` says that the target makes a fixed seeded random realization.

The author API defaults `graphicalSource` to `false`. An explicit
`\csoundGesture` is not by itself proof that a graphic exists. Set the flag
only when the score supplies one.

Every lowering has a seed. A non-random lowering uses `0`. A stochastic
lowering uses a non-zero seed and must give the same seed to each part of the
same target realization.

Version 0.3 assigns these `p16` bits for targets that support gestures:

| Name | Value |
| --- | ---: |
| `GESTURE_NATIVE` | `32768` |
| `GESTURE_CHILD` | `65536` |
| `STOCHASTIC` | `131072` |
| `CONTROL_ONLY` | `262144` |
| `GRAPHICAL_SOURCE` | `524288` |

The four v0.1 tie and slur bits keep their values. Each current `expand`
event sets `GESTURE_CHILD`. A positive seed sets `STOCHASTIC`; the other two
booleans set `GRAPHICAL_SOURCE` and `CONTROL_ONLY`. The trace adapter accepts
and reports these bits, but it does not turn them into sound. The current
exporter never sets `GESTURE_NATIVE`.

### Pitch endpoints are not a range

`p8` and `p9` always describe pitch at the start and end of one performance
segment. They must not mean the low and high pitches heard at one time.

A pitch band belongs in a `rangeCurve` such as `pitchBand`. It must not put
the low edge in `p8` and the high edge in `p9`. The current exporter does not
lower a pitch band to score fields.

### Reserved native Csound resources

The schema reserves a Csound table bundle for a later `native` lowering:

```json
{
  "id": 901,
  "descriptorTableNumber": 9010,
  "tables": [
    {
      "dimensionPath": "pitchBand.low",
      "dimensionCode": 2,
      "tableNumber": 9011,
      "generator": "gen07"
    }
  ]
}
```

Under that reserved design, the score writer would put
`descriptorTableNumber` in `p25`. The descriptor table would contain
dimension-code and table-number pairs.

`gen02` stores direct values, `gen07` stores piecewise-linear curves, and
`gen08` stores cubic curves. A target owns dimension codes and table
sampling rules. It must state those rules before it accepts `native`.

The current native exporter always writes `csoundResources: []`, never emits
table statements or bundles, and writes zero in generated `p25` through
`p27`. Consumers must not expect native gesture playback from this release.

## Frontend synchronization

The `sync.mode` field states what the display may claim:

| Mode | Frontend action |
| --- | --- |
| `anchor` | Snap to or mark the linked notation anchor |
| `region` | Highlight the full gesture for its resolved interval |
| `horizontalProgress` | Apply normalized progress to an author-tagged horizontal region |
| `pathProgress` | Apply normalized progress to an author-tagged SVG path |

For a positive interval, normalized progress is:

```text
(currentScoreFrame - startFrame) / (endFrame - startFrame)
```

The frontend clamps this value from zero through one. It uses the timeline's
media-to-score frame conversion before this calculation.

`svgId` is an explicit display link. The exporter writes `null` until an SVG
step supplies the id. That step may fill `svgId`, but it must not change
gesture meaning, timing, dimensions, ids, or lowering data.

When LilyPond uses its SVG backend, LPCS tags visible rhythmic grob groups.
`NoteHead`, `Rest`, and `MultiMeasureRest` groups have class `lpcs-anchor`, a
`data-lpcs-anchor-id`, and a reduced `data-lpcs-qbeat` written as
`numerator/denominator`. Note heads also have
`data-lpcs-playback-occurrence-id` and `data-lpcs-notation-event-id`.
`StaffSymbol` groups have class `lpcs-staff` for DOM bounds.

These data attributes are not unique SVG ids. Chord note heads share an
anchor, and unfolded repeat copies may share prepared notation ids. A
frontend resolves notes by playback occurrence id first, then resolves rests
or other visible anchors by anchor id and qbeat. The exporter keeps `svgId`
null because its singular value cannot name every native SVG group in those
cases. The tags add display links; they do not change timeline or gesture
meaning.

`pathProgress` lets a marker follow a named display path. It does not let a
consumer turn path height, width, slope, fill, or staff position into sound
controls. `region` is the right mode for a free repetition box when a moving
bar would claim source precision that the notation does not give.

## Native semantic sources

The current native exporter reads:

- LilyPond pitched note events;
- the underlying pitches of `\makeClusters`;
- unpitched drum events with a resolved key found in `drum-map`; and
- `\csoundGesture` specifications written by the author.

`\makeClusters` on its own yields ordinary pitched events. Inside an explicit
`expand` gesture, those pitches become gesture children. This does not infer
a pitch band or another cluster control.

The exporter does not infer a gesture from an ordinary chord, glissando,
tremolo, roll, ornament, duration line, feathered beam, markup, stencil,
path, image, staff position, or note-head shape. Native glissando and
tremolo events still follow the strict unsupported-event rules.

An author may put names such as `"cluster"` or `"tremolo"` in an explicit
gesture and provide dimensions. Those names remain sidecar data. The
exporter does not inspect the named feature, derive controls, or make a
native Csound model.

Layout-only graphics remain outside the performance contract and may pass
without a warning because the exporter does not treat them as performance
events. Geometry calibration and path-to-control conversion are deferred.

## Target choice and failure

The current exporter does not load target manifests at run time and does not
choose a lowering strategy. The author must select `expand` or `preserve` in
`\csoundGesture`.

Strict export stops when an expanded gesture has no ordinary performance
events, when a gesture has no notation anchor, when its resolved duration is
not positive, when its target differs from the export target, when a linked
child changes target inside the gesture, when gestures nest in one voice,
when its grace time is unresolved, or when identity was not prepared.

Non-strict export writes warnings and then makes a valid artifact set. It
omits a gesture with no anchor, a non-positive resolved duration, or the
wrong export target. It removes child links whose event target differs from
the gesture target. If no linked children remain, it changes `expand` to
`preserve`. When it omits or unlinks a gesture, it also clears that link and
its gesture flags from the IR and score event. A nested gesture gets a
warning, but its output has no promised nested-event meaning.

## Checks beyond JSON Schema

JSON Schema checks record shapes. Producers and consumers must also check:

- unique gesture, occurrence, resource, event, and table ids;
- equality of each gesture `id` and `playbackOccurrenceId`;
- booleans, strategies, seeds, and generated flags that agree;
- reduced rational pairs and normalized positions no greater than one;
- ordered curve points and categorical or distribution changes;
- distribution weights that sum to one;
- low curves that do not exceed high curves;
- source timing bounds against resolved timing;
- resolved qbeats and frames against timeline v1;
- source artifact names, source file names, target ids, and identity modes
  across the linked files;
- all notation anchor ids against the timeline;
- all event ids against semantic IR v3 and the score;
- score `p5` ids against the IR and native `p25` descriptor ids against the
  resource records;
- `expand` with at least one linked event and `preserve` with none; and
- an empty `csoundResources` array for output from the current native
  exporter.

## Deferred work

The current implementation defers:

- automatic meaning for an arbitrary stencil or image;
- sound controls derived from uncalibrated geometry;
- a distinct key mapping for pitched percussion;
- native cluster controls beyond underlying pitch expansion, plus native
  extraction of glissandi, tremolos, rolls, ornaments, or other graphic
  techniques;
- `direct` and `native` lowering;
- Csound table or bundle output and non-zero gesture use of `p25` through
  `p27`;
- non-metric gesture source timing;
- SVG `id` enrichment, page maps, or full system geometry;
- live performer choices after an offline realization;
- target-independent random number output;
- Csound state reconstruction for a warm seek;
- a media renderer or measured acoustic onset; or
- tempo ramps.
