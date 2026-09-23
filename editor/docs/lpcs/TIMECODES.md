# Timecodes for frontends

This guide shows how a frontend can use LPCS time and identity data.

It covers:

- semantic IR version 3
- timeline version 1
- gesture sidecar version 1

These files define the exact rules:

- [contract v0.3](docs/contract-v0.3.md)
- [timeline schema](schemas/lpcs-timeline.schema.json)
- [semantic IR schema](schemas/lpcs-ir.schema.json)
- [gesture schema](schemas/lpcs-gestures.schema.json)

If this guide differs from one of these files, follow that file.

## Current status

LPCS can export:

- repeat-aware notation ids
- unique playback occurrence ids
- exact quarter-note positions
- reference sample frames
- constant tempo segments
- cursor points for notes, chords, rests, skips, and score end
- a fixed link from each Csound event id to its IR event
- mapped unpitched percussion keys
- explicit gesture spans with repeat data and four frontend sync modes
- SVG data attributes for visible note heads, rests, and multi-measure rests
- an SVG class on staff symbols for cursor geometry

LPCS cannot yet:

- export SVG system geometry
- render audio
- measure an audio file or effects tail
- rebuild live Csound state after a seek

Current timelines contain `svgId: null` and `mediaEndFrame: null`. Current
gesture files contain `sync.svgId: null`. The SVG backend writes data
attributes instead of one SVG id because a chord or an unfolded repeat can
produce more than one visible group for one notation anchor.

A frontend can already support:

- transport
- indexes
- repeat logic
- the cursor clock
- gesture state

Visible rhythmic placement works from the SVG data attributes. Full system
geometry still needs a later SVG step or DOM measurement.

## Export the files

Enable timeline output and prepare ids before repeat unfolding:

```lilypond
\csoundExportOptions #'(
  (strict . #t)
  (emit-timeline . #t)
  (reference-sample-rate . 48000)
  (cursor-tail-policy . "freeze")
)

\score {
  \new Staff {
    \new Voice {
      \csoundUnfoldForExport {
        \tempo 4 = 90
        c'4 d'4 e'4 f'4
      }
    }
  }
  \layout { }
}
```

This produces:

```text
piece.lpcs.json
piece.lpcs.timeline.json
piece.sco
```

When the music contains `\csoundGesture`, LPCS also writes:

```text
piece.lpcs.gestures.json
```

Gesture output turns on timeline output for that export. This happens even
when `emit-timeline` is false.

A LilyPond SVG pass and a later audio step can add:

```text
piece.svg
piece.wav
```

Set `reference-sample-rate` to the rate of the reference audio render.
The browser output device may use another rate.

`currentTime` gives media time in seconds. Multiply it by the timeline's
sample rate. Do not use the device rate.

Keep all files from one export together:

- IR
- timeline
- optional gesture file
- score
- SVG
- audio

Do not mix files from different exports.

## The five domains

A frontend action can touch five kinds of data:

| Domain | Main fields | Meaning |
| --- | --- | --- |
| Notation | `notationEventId`, `notationAnchorId`, `svgId` | A written note or rhythmic position |
| Playback | `id`, `playbackOccurrenceId` | One occurrence in unfolded playback |
| Gesture | `notationGestureId`, gesture `id`, `sync.mode` | One written gesture and one resolved playback span |
| Score time | `qbeat`, `resolvedPerformanceQbeat` | Exact quarter-note position |
| Media time | `frame`, `seconds` | Position on the reference sample clock |

The normal lookup path is:

```text
audio.currentTime
  -> media frame
  -> score/reference frame
  -> cursor point
  -> notation anchor id
  -> SVG element id
```

The reverse path supports score clicks:

```text
SVG element id
  -> notation anchor id
  -> next playback cursor point
  -> score/reference frame
  -> media time
```

These links are not one-to-one:

- One written anchor can occur many times in a repeat.
- One cursor point can contain many events at the same time.
- A score-end point can have no event or visual anchor.
- One written gesture can have several playback spans.

## File roles

### Semantic IR

Use `*.lpcs.json` when the UI needs music details:

- event kind, pitch, mapped drum key, and voice
- tie and slur state
- dynamics and articulations
- source locations
- notation and playback ids
- links from expanded events to an explicit gesture

Index its events by `id`. In IR version 3:

```text
event.id == event.playbackOccurrenceId
```

Csound score `p5` has the same numeric id.

Each event has `kind`, `pitch`, and `drumKey`.

A pitched event has:

- a numeric `pitch`
- a null `drumKey`

An unpitched percussion event has:

- `pitch: null`
- a `drumKey` with a semantic name and positive target id

Do not derive a drum key from an SVG position or note-head style.

### Timeline

Use `*.lpcs.timeline.json` for playback and cursor work:

- `render` defines the frame clock
- `scoreEnd` defines the written score end
- `tempoSegments` records the resolved tempo map
- `notationAnchors` maps notation ids to later SVG ids
- `cursorPoints` maps playback time to events and notation anchors

Each tempo segment has one fixed BPM.

A segment boundary can cause an immediate tempo jump. LPCS does not support
tempo ramps. Do not interpolate BPM between segment bounds.

### Gesture sidecar

Use `*.lpcs.gestures.json` for explicit gesture spans:

- `notationGestureId` links repeat copies to one written gesture
- numeric `id` and `playbackOccurrenceId` name one playback span
- `resolvedTiming` gives its qbeat and frame bounds
- `notationAnchorIds` and `sync.svgId` provide display links
- `sync.mode` limits what the frontend may show
- `lowering.eventIds` links an expanded gesture to IR and score events

The exporter writes a gesture file only for `\csoundGesture`. It does not
inspect graphics to create gestures.

It supports two current forms:

- `expand` lists the normal events inside the gesture.
- `preserve` writes no linked event. Its `lowering.eventIds` list is empty.

Notes inside `preserve` still export as normal events. Their `gesture` field
is null.

The exporter writes metric source timing. It does not write native Csound
table resources.

`\makeClusters` keeps each pitch. In an `expand` gesture, these pitches
become linked child events.

LilyPond drops the separate source positions of those pitches. IR v3 uses
the source position of the containing chord. The exporter does not derive a
pitch band or other control from the cluster shape.

### Csound score

Score `p2` and `p3` use quarter-note beats in the written file. Csound
applies the `t` statement before an instrument runs.

Do not use score `p2` or run-time `p3` as frontend media seconds.

Timeline frames come from the same tempo compiler as the Csound `t`
statement. Use those frames. Do not parse the score or rebuild LilyPond
tempo rules.

Reference frames give scheduled score time. They do not measure audio
attacks. An instrument envelope, Csound control rate, or effects chain can
move an audible change away from its scheduled frame.

## Minimal frontend types

These types have the fields used below:

```ts
type Rational = readonly [number, number];
type CursorTailPolicy = "freeze" | "fade" | "hide";
type GestureSyncMode =
  | "anchor"
  | "region"
  | "horizontalProgress"
  | "pathProgress";

interface CursorPoint {
  id: number;
  qbeat: Rational;
  frame: number;
  seconds: number;
  eventIds: readonly number[];
  playbackOccurrenceIds: readonly number[];
  notationAnchorIds: readonly string[];
}

interface NotationAnchor {
  id: string;
  notationEventIds: readonly string[];
  kinds: readonly ("note" | "rest" | "skip")[];
  svgId: string | null;
}

interface TimelineV1 {
  format: "lpcs-timeline";
  version: 1;
  timeUnit: "quarter-note";
  render: {
    sampleRate: number;
    scoreZeroFrame: 0;
    scoreEndFrame: number;
    mediaEndFrame: number | null;
    presentationOffsetFrames: number;
    frameRounding: "nearest-half-up";
    timingMode: "sample-accurate-reference";
  };
  scoreEnd: {
    qbeat: Rational;
    frame: number;
  };
  cursorTailPolicy: CursorTailPolicy;
  notationAnchors: readonly NotationAnchor[];
  cursorPoints: readonly CursorPoint[];
}

interface GestureOccurrence {
  id: number;
  playbackOccurrenceId: number;
  notationGestureId: string;
  notationAnchorIds: readonly string[];
  resolvedTiming: {
    startQbeat: Rational;
    endQbeat: Rational;
    startFrame: number;
    endFrame: number;
  };
  sync: {
    mode: GestureSyncMode;
    svgId: string | null;
  };
  lowering: GestureLowering;
}

type GestureLowering =
  | {
      strategy: "direct";
      eventIds: readonly [number];
      seed: number;
    }
  | {
      strategy: "expand";
      eventIds: readonly number[];
      seed: number;
    }
  | {
      strategy: "native";
      eventIds: readonly [number];
      seed: number;
      bundleResourceId: number;
    }
  | {
      strategy: "preserve";
      eventIds: readonly [];
      seed: number;
    };

interface GestureSidecarV1 {
  format: "lpcs-gestures";
  version: 1;
  identityMode: "prepared" | "occurrence-fallback" | "mixed";
  gestures: readonly GestureOccurrence[];
}
```

For a full app, generate types from the JSON Schemas.

## Treat ids as opaque

Do not parse the number inside ids such as `na-000042` or `ng-000007`.

Do not derive ids from:

- source file names
- line numbers
- note names
- array positions

Prepared notation ids stay stable within one prepared music tree and one
export.

A source edit or new export may assign new ids. Clear cached DOM and
timeline indexes when the asset set changes.

The IR top-level `identityMode` has three values:

| Value | Frontend meaning |
| --- | --- |
| `prepared` | Repeat copies can share notation identity |
| `occurrence-fallback` | Ids name playback occurrences only |
| `mixed` | Some items have prepared ids and some use fallback ids |

For a folded score with repeat-aware clicks, require `prepared`. Strict
timeline and gesture export already require it.

Prepared repeat copies can share a `notationGestureId`. Each copy still has
its own:

- numeric gesture `id`
- playback occurrence id
- resolved time

Build two gesture indexes:

- Use the numeric id for one playback span.
- Use the notation gesture id for all repeat copies.

## Rational score time

Quarter-note positions use reduced rational arrays:

```json
[3, 2]
```

This means 1.5 quarter-note beats.

The first item is the numerator. The second is a positive denominator.

Use cross multiplication for comparisons. Do not convert to a float first:

```ts
function compareRational(a: Rational, b: Rational): number {
  const left = BigInt(a[0]) * BigInt(b[1]);
  const right = BigInt(b[0]) * BigInt(a[1]);
  return left < right ? -1 : left > right ? 1 : 0;
}
```

Before you convert to `BigInt`, check that both JSON values are safe
JavaScript integers.

Use a lossless JSON parser if a future file can exceed that range.

Use rationals for:

- labels
- score navigation
- checks

Use integer frames for cursor animation and media seeks.

Do not create cursor frames by adding rounded tempo segment lengths. LPCS
rounds each absolute frame once.

Use the supplied cursor frames. If you need an exact frame for another
qbeat, use the same tempo compiler as the exporter.

## Frame coordinates

Timeline version 1 has two frame coordinates:

- a media frame from the audio element
- a score/reference frame used by cursor points

The current exporter writes:

```text
scoreZeroFrame = 0
presentationOffsetFrames = 0
```

A later media step may set a positive presentation offset. This happens
when score zero starts after media frame zero.

`presentationOffsetFrames` is the media frame that matches
`scoreZeroFrame`.

Use these conversions:

```ts
function roundFrame(value: number): number {
  return Math.floor(value + 0.5);
}

function mediaSecondsToScoreFrame(
  timeline: TimelineV1,
  mediaSeconds: number,
): number {
  const mediaFrame = roundFrame(
    mediaSeconds * timeline.render.sampleRate,
  );

  return (
    timeline.render.scoreZeroFrame +
    mediaFrame -
    timeline.render.presentationOffsetFrames
  );
}

function scoreFrameToMediaSeconds(
  timeline: TimelineV1,
  scoreFrame: number,
): number {
  const mediaFrame =
    timeline.render.presentationOffsetFrames +
    scoreFrame -
    timeline.render.scoreZeroFrame;

  return Math.max(0, mediaFrame) / timeline.render.sampleRate;
}
```

The calculated score frame can be negative before score zero. A player
should usually hide its notation cursor during this media lead-in.

`cursorPoint.frame` and `scoreEnd.frame` use the score/reference frame.

When present, `mediaEndFrame` uses the media-presentation frame at
`render.sampleRate`. It does not need to match the native sample index of
the encoded file.

`cursorPoint.seconds` is a useful float value.

`frame` uses nearest-half-up rounding. This means
`seconds * sampleRate` can differ from `frame` by up to half a frame.

## Score end and media end

These fields answer different questions:

| Field | Question |
| --- | --- |
| `scoreEndFrame` | When does collected score time end? |
| `scoreEnd.frame` | The same reference value, beside its qbeat |
| `mediaEndFrame` | When does the measured media presentation end? |

`scoreEndFrame` includes trailing written rests and skips.

It does not include:

- release time
- reverb
- delay
- encoder padding
- a Csound control block difference at the file end

Never use `scoreEndFrame` as the audio file length. Prefer:

1. a non-null `mediaEndFrame` from a verified media step
2. otherwise, the loaded media element's `duration`
3. only then, a frontend fallback.

PCM WAV is the simplest reference format.

For compressed audio, check its decoded offset and duration. Then fill
`presentationOffsetFrames` and `mediaEndFrame`.

When `mediaEndFrame` is present, compare it in media coordinates. Convert
score end to media coordinates with:

```text
presentationOffsetFrames + scoreEnd.frame - scoreZeroFrame
```

The measured media end may differ from that value. Causes include an
effects tail, encoder padding, and render-block behavior.

## Build frontend indexes

Build indexes once after loading:

```ts
const eventById = new Map(
  ir.events.map((event) => [event.id, event]),
);

const anchorById = new Map(
  timeline.notationAnchors.map((anchor) => [anchor.id, anchor]),
);

const pointsByAnchor = new Map<string, CursorPoint[]>();

for (const point of timeline.cursorPoints) {
  for (const anchorId of point.notationAnchorIds) {
    const points = pointsByAnchor.get(anchorId) ?? [];
    points.push(point);
    pointsByAnchor.set(anchorId, points);
  }
}

const gesturesByNotationId =
  new Map<string, GestureOccurrence[]>();

for (const gesture of gestureSidecar?.gestures ?? []) {
  const occurrences =
    gesturesByNotationId.get(gesture.notationGestureId) ?? [];
  occurrences.push(gesture);
  gesturesByNotationId.set(
    gesture.notationGestureId,
    occurrences,
  );
}
```

Keep each `pointsByAnchor` array in frame order. The file already puts
cursor points in score order.

`notationAnchorIds` is plural. A point can name several anchors at the same
time.

A chord often has several notation event ids. It usually has one shared
notation anchor.

`eventIds` and `playbackOccurrenceIds` list event onsets at that cursor
point. They do not list every note that is still sounding.

## Find the active cursor point

Use binary search for the last point whose frame is at or before the current
score frame:

```ts
function pointIndexAtOrBefore(
  points: readonly CursorPoint[],
  frame: number,
): number {
  let low = 0;
  let high = points.length;

  while (low < high) {
    const middle = (low + high) >>> 1;
    if (points[middle].frame <= frame) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low - 1;
}
```

The result is `-1` before the first point.

The final point may come before `scoreEnd.frame`. In that case, keep it
through score end. Apply the tail rule only after score end.

Different qbeats can round to the same frame. The search selects the last
same-frame point in file order. File order is also qbeat order.

Keep this rule stable in tests.

Some cursor points have empty `notationAnchorIds`. These points can mark:

- note ends
- score moments
- score end

Do not clear the cursor only because a point has no anchor. Keep the most
recent visible anchor until:

- another visible anchor appears
- the tail policy says to change it

## Update the cursor from media time

Read `audio.currentTime` inside `requestAnimationFrame`.

Do not use a separate JavaScript clock. Do not use the sparse `timeupdate`
event as the animation clock.

```ts
function updateCursor(): void {
  const scoreFrame = mediaSecondsToScoreFrame(
    timeline,
    audio.currentTime,
  );

  if (scoreFrame < timeline.render.scoreZeroFrame) {
    hideCursor();
    requestAnimationFrame(updateCursor);
    return;
  }

  if (scoreFrame > timeline.scoreEnd.frame) {
    applyTailPolicy(timeline.cursorTailPolicy);
    requestAnimationFrame(updateCursor);
    return;
  }

  const index = pointIndexAtOrBefore(
    timeline.cursorPoints,
    scoreFrame,
  );

  if (index >= 0) {
    showPointOrLastVisibleAnchor(index);
  }

  requestAnimationFrame(updateCursor);
}
```

For a first frontend, snap to anchors. Add smooth horizontal motion later.

You may move between two adjacent points by frame when both points:

- resolve to SVG elements
- are in the same SVG system

Use:

```ts
const span = next.frame - current.frame;
const amount =
  span > 0 ? (scoreFrame - current.frame) / span : 0;
```

Clamp `amount` from 0 through 1.

Snap instead when there is:

- a repeat jump
- a system break
- a missing anchor
- a change to another SVG system

The current timeline has no system geometry. The SVG packaging step or DOM
structure must tell the frontend if two elements share a system.

## Show an active gesture

Use the same score frame as the notation cursor.

A gesture is active from `resolvedTiming.startFrame` through
`resolvedTiming.endFrame`.

Several gestures may overlap. Keep a set of active ids.

Each `sync.mode` allows a different display:

| Mode | Frontend action |
| --- | --- |
| `anchor` | Mark or snap to the linked notation anchor |
| `region` | Highlight the linked region for the resolved interval |
| `horizontalProgress` | Move across an author-tagged horizontal region |
| `pathProgress` | Move along an author-tagged SVG path |

For the two progress modes, calculate:

```ts
function gestureProgress(
  gesture: GestureOccurrence,
  scoreFrame: number,
): number {
  const {startFrame, endFrame} = gesture.resolvedTiming;
  if (endFrame <= startFrame) return 0;
  return Math.max(
    0,
    Math.min(1, (scoreFrame - startFrame) / (endFrame - startFrame)),
  );
}
```

Use `horizontalProgress` or `pathProgress` only after an enrichment step
sets an explicit `sync.svgId`.

If it stays null, keep the semantic gesture state. Do not guess an SVG
node.

`region` marks a time span. It does not give a source-defined position to
each point in that span.

Display sync works in one direction. Do not derive any of these sound values
from the SVG shape:

- pitch
- drum key
- level
- density
- any other sound value

## Link cursor points to SVG

Each notation anchor has:

```json
{
  "id": "na-000005",
  "notationEventIds": ["ne-000002", "ne-000003"],
  "kinds": ["note"],
  "svgId": null
}
```

The current exporter leaves `svgId` null. When LilyPond uses its SVG backend,
LPCS adds these attributes to the `<g>` for each visible `NoteHead`, `Rest`,
or `MultiMeasureRest` grob:

```xml
<g class="lpcs-anchor"
   data-lpcs-anchor-id="na-000005"
   data-lpcs-qbeat="2/1"
   data-lpcs-playback-occurrence-id="3"
   data-lpcs-notation-event-id="ne-000002">
```

`data-lpcs-anchor-id` and `data-lpcs-qbeat` are present on every tagged
rhythmic grob. Note heads also have
`data-lpcs-playback-occurrence-id` and
`data-lpcs-notation-event-id`. Rests have no performance event, so they omit
those two attributes.

The qbeat text is the same reduced rational value as the timeline pair,
written as `numerator/denominator`.

A chord has one anchor and can have several tagged note-head groups. An
unfolded repeat can have several groups with one prepared anchor id. Use the
playback occurrence id for a note when it is present. Otherwise use the
anchor id and qbeat together. Do not assume that an anchor selector returns
one element.

Staff-symbol groups have `class="lpcs-staff"`. Their SVG bounds give a
frontend the visible staff span for a cursor. They do not supply page or
system ids. The containing SVG document identifies the page; a frontend must
measure the DOM or use a later enrichment step to group full systems.

Skips and empty cursor points have no visible grob. Keep the most recent
visible anchor as described above.

Do not guess a DOM node from `source.line` or `source.column`.

For the native SVG tags, a frontend can use:

```ts
function elementsForPoint(
  svg: SVGSVGElement,
  point: CursorPoint,
): readonly SVGGraphicsElement[] {
  const byOccurrence = point.playbackOccurrenceIds.flatMap((id) =>
    Array.from(svg.querySelectorAll<SVGGraphicsElement>(
      `[data-lpcs-playback-occurrence-id="${id}"]`,
    )),
  );

  if (byOccurrence.length) return byOccurrence;

  const qbeat = `${point.qbeat[0]}/${point.qbeat[1]}`;
  return point.notationAnchorIds.flatMap((anchorId) =>
    Array.from(svg.querySelectorAll<SVGGraphicsElement>(
      `[data-lpcs-anchor-id="${anchorId}"]` +
      `[data-lpcs-qbeat="${qbeat}"]`,
    )),
  );
}
```

The ids contain only LPCS-generated tokens, but a general consumer should
still use `CSS.escape` when it builds selectors from an external file.

An SVG enrichment step may still set the singular `svgId` when one stable
element represents the written anchor, such as in a folded notation view.
Treat an anchor as unresolved through `svgId` when it stays null.

After enrichment:

```ts
function elementForAnchor(anchorId: string): SVGElement | null {
  const anchor = anchorById.get(anchorId);
  if (!anchor?.svgId) return null;
  return document.getElementById(anchor.svgId) as SVGElement | null;
}
```

The SVG packager must make each non-null `svgId` unique in the document.
Repeated playback points may point to the same SVG element. Native LPCS data
attributes do not need to be unique.

A later enrichment step may fill:

- anchor `svgId`
- gesture `sync.svgId`
- `mediaEndFrame`
- `presentationOffsetFrames`

It must not change:

- qbeat/frame pairs
- event ids
- notation ids
- gesture ids
- dimensions
- lowering data

## Seek when the user clicks notation

One notation anchor can have several playback occurrences.

Use this default rule:

1. Find the first occurrence at or after the current score frame.
2. If no occurrence remains, use the first occurrence.
3. Convert its score frame to media seconds.
4. Assign that value to `audio.currentTime`.

```ts
function seekToAnchor(anchorId: string): void {
  const points = pointsByAnchor.get(anchorId);
  if (!points?.length) return;

  const currentFrame = mediaSecondsToScoreFrame(
    timeline,
    audio.currentTime,
  );

  const next =
    points.find((point) => point.frame >= currentFrame) ??
    points[0];

  audio.currentTime = scoreFrameToMediaSeconds(
    timeline,
    next.frame,
  );
}
```

For large repeat lists, replace `find` with binary search.

An app may offer controls for the first, previous, or next occurrence. Keep
the one-to-many index. Do not replace it with one frame.

## Tail policy

After `scoreEnd.frame`, apply `cursorTailPolicy`:

| Policy | Frontend action |
| --- | --- |
| `freeze` | Keep the last visible score position |
| `fade` | Fade the cursor, then hide it |
| `hide` | Hide the cursor at once |

Timeline version 1 does not define a fade length or curve. Set both in the
frontend.

Do not stop media playback at score end. The file may contain a release or
effects tail through `mediaEndFrame` or the media element's duration.

## Special cases

### Repeats

Repeated playback occurrences have different `playbackOccurrenceId` values.
They may share one `notationAnchorId`. This is expected.

Gesture repeat copies follow the same rule. They have different numeric ids
and resolved intervals. They may share one `notationGestureId`.

When a user clicks a written gesture:

1. Use the next occurrence at or after the current frame.
2. If none remains, wrap to the first.

### Simultaneous notes and chords

One point can contain several event ids.

Do not use event array order as layout order. Resolve every anchor id. Notes
in a chord share an anchor.

### Rests, skips, and empty points

Rests and skips can provide notation anchors with no event ids.

Score moments and note ends can provide points with no anchor ids.

Both forms are valid.

### Rest-only scores

A rest-only score can have no IR events. It can still have:

- a non-zero score end
- a tempo segment
- a rest anchor
- cursor points

### Grace notes

An unresolved grace event has:

```json
"resolvedPerformanceQbeat": null
```

It stays in non-strict IR. It does not appear in cursor-point `eventIds` or
`playbackOccurrenceIds`.

Its notation anchor has no cursor-point occurrence. This means
`pointsByAnchor` is empty, and a click cannot seek to it.

Do not invent a frame for it.

### Empty scores

A zero-length score can have an empty cursor point array. Every cursor
lookup must handle this case.

### Source paths

These fields describe export files:

- `source.file`
- `source.ir`
- `source.timeline`
- `source.score`

They may contain paths from the build machine. A web packager should map
them to its own asset URLs. It should not fetch arbitrary paths from the
JSON.

A package may keep a relative `source.ir` or `source.score`. Resolve it
relative to the timeline file URL.

Never expose an absolute build-machine path as a public URL.

### Live Csound

The timeline can choose a score position. It cannot rebuild past Csound
state such as:

- notes
- envelopes
- delay memory
- reverb
- other prior state

For exact playback, seek in a completed audio render.

Cold or warm live-engine seek is a separate future feature.

## Load-time checks

First validate the IR, timeline, and any gesture file against their linked
JSON Schemas.

Then reject the file set if:

- `format` or `version` is unknown
- `timeUnit` is not `quarter-note`
- `render.frameRounding` is not `nearest-half-up`
- `render.timingMode` is not `sample-accurate-reference`
- `timeline.source.irVersion` does not match the IR
- timeline and IR `scoreEnd` values differ
- an event id or anchor id reference is missing
- ids that must be unique are duplicated
- cursor qbeats go backward
- cursor frames or seconds go backward
- tempo segments are not ordered and contiguous
- a segment frame does not match its qbeat and tempo map
- `scoreEnd.frame` differs from `render.scoreEndFrame`
- a cursor point frame falls outside score time

When a gesture file exists, also reject:

- a source IR or timeline version that does not match
- a source file name that differs from the IR or timeline
- a `source.ir` or `source.timeline` basename that names another artifact
- a target or identity mode that differs from the IR
- a gesture id or playback occurrence id that is missing or duplicated
- a gesture whose `id` differs from `playbackOccurrenceId`
- a missing notation anchor or lowering event id
- a resolved frame that does not match its qbeat and the timeline tempo map
- a range whose low and high curves do not share positions or have
  `low > high`
- distribution weights that do not sum to one, or a distribution with a
  zero seed
- a non-empty `eventIds` list for `preserve`
- an empty `eventIds` list for `expand`
- a progress mode with a zero-length interval
- a non-empty `csoundResources` array from the current native exporter

Also check these identity rules:

```text
event.id == event.playbackOccurrenceId
cursorPoint.eventIds == cursorPoint.playbackOccurrenceIds
```

The [contract checks](tests/contract/run.sh) show rules that JSON Schema
cannot express.

## Frontend test cases

At minimum, test:

1. constant tempo and one tempo change
2. a frame that is not on a Csound control-block boundary
3. a repeat where two playback points share one notation anchor
4. a chord with several event ids and one anchor
5. simultaneous notes with several anchor ids
6. a rest point with empty event arrays
7. a point with no visual anchor
8. a trailing rest and a rest-only score
9. an empty score
10. an unresolved grace event
11. each tail policy
12. a non-zero presentation offset
13. a media tail longer than score time
14. a click with later repeat occurrences
15. mapped unpitched percussion with `pitch: null`
16. repeated gestures that share one notation gesture id
17. all four gesture sync modes, with and without an SVG id
18. overlapping gesture intervals
19. unknown file versions and broken references

The native exporter tests cover:

- repeat identity
- chords
- rests
- multi-measure rests
- score end
- tempo frames
- mapped percussion
- explicit gestures
- Csound ABI fields
- an end-to-end rendered sample edge

## Worked data

Use these checked-in files when building a frontend fixture:

- [semantic IR example](docs/examples/basic.lpcs.json)
- [timeline example](docs/examples/basic.lpcs.timeline.json)
- [Csound score example](docs/examples/basic.sco)
- [gesture sidecar example](docs/examples/basic.lpcs.gestures.json)
- [linked gesture IR](docs/examples/graphical-piece.lpcs.json)
- [linked gesture timeline](docs/examples/graphical-piece.lpcs.timeline.json)
- [linked gesture score](docs/examples/graphical-piece.sco)

These are short, hand-written contract examples.

For integration tests, prefer files made by `just build` or the end-to-end
test.

The gesture set has real cross-file links. It also includes a reserved
native-resource form. The current exporter does not emit that form.

Their main timing check is:

```text
90 BPM
1 qbeat = 2/3 second = 32000 frames at 48000 Hz
4 qbeats = 128000 frames
```
