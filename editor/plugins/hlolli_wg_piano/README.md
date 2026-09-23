# hlolli_wg_piano

`hlolli_wg_piano` is a Csound piano module written in C. It exports a note
opcode, a piano-handle creator, and a wet-output opcode. The model uses no
samples or external data files.

Create one handle for each piano:

```csound
giPiano hlolli_wg_piano_create
giNamed hlolli_wg_piano_create "concert_grand_a"
```

The note opcode keeps its ten controls and takes the handle as an optional
last input:

```csound
aLeft, aRight hlolli_wg_piano \
    kTrigger, kFrequency, kHardness, kHammerPosition, kDecay, \
    kStiffness, kDetune, kBody, kStrange, kPedal, giPiano
```

The wet opcode reads that piano's hidden send and returns wet signal only:

```csound
aWetLeft, aWetRight hlolli_wg_piano_resonance \
    giPiano, kBody, kPedal
```

The creator signatures are `i <- ""` and `i <- S`. The note and handled wet
signatures are `aa <- kkkkkkkkkko` and `aa <- ikk`. Keep the direct note
outputs in the mix; the wet opcode does not pass them through. The handle owns
the body, sympathetic strings, delay tail, control smoothing, and their phases
until Csound resets. Keep one wet-output instrument alive for each piano. If it
ends, a later one resumes the same stored state.

The old `aa <- aakk` wet form remains available. It takes an explicit stereo
bus and uses one default piano state. Use it when the score needs a custom send
level or routing path.

The project builds as a stand-alone Csound runtime module. It can also enter a
Csound source build through `add_subdirectory()` and Csound's `make_plugin()`
helper. The source was tested with Csound 7.0, double-precision samples, on
macOS arm64.

## Files

```text
CMakeLists.txt                 Stand-alone and Csound-tree build rules
hlolli_wg_piano.c              Complete opcode source
README.md                      Build and control reference
LICENSE                        MIT license
Custom.cmake.example           Optional local path settings
profiles/manifest.json         Profile order and default choice
profiles/generic_2018.json     Source data for the default modeled piano
profiles/concert_grand_a.json  Small concert-grand recording fit
profiles/schema/               Versioned profile format
tools/generate_profiles.py     Profile checker and C-table generator
recordings/README.md           Piano recording and data rules
recordings/example-capture.json  Small capture input example
examples/basic.csd             Short chord example
examples/chopin_aeolian_harp.csd  Longer musical example
tests/smoke.csd                Native load and render test
tests/measure_note.csd         Handled-note and profile measurement render
tests/shared_resonance.csd     Shared-state and tail render
tests/handle_resonance.csd     Two-piano isolation render
tests/handle_handoff.csd       Wet-output handoff and error render
tests/held_renderer_gap.csd    Held-key renderer restart render
tests/stress.csd               Range and polyphony stress render
tests/audio_analysis.py        PCM WAV metrics and tuning checks
tests/initial_controls.csd     First-block note control render
tests/run_initial_controls_test.py  Initial and k-rate control comparison
tests/run_shared_resonance_test.py  Shared-tail test driver
tests/run_handle_state_test.py Piano-handle state test driver
```

## Piano profile data

The JSON files under `profiles` are the source for fixed piano data. The
manifest lists each profile and selects the default. The versioned schema sets
the field names, units, sizes, and limits. The generator applies matching
built-in checks without an added JSON Schema package. Version 3 stores direct
per-key string loss, stiffness, choir, unison, hammer, felt, damper, and
sympathetic terms. It also stores a key-to-body-mode coupling matrix and
profile-wide mechanical-sound gains. The shipped profiles use 88 keys and 12
body modes. A profile can set a default key and then override its values by
MIDI number.

The generator checks the JSON and replaces only the marked profile-data block
inside `hlolli_wg_piano.c`:

```sh
python3 -B tools/generate_profiles.py --check
python3 -B tools/generate_profiles.py
```

In a stand-alone build, when CMake finds Python, the same actions are available
as targets:

```sh
cmake --build build --target hlolli_wg_piano_check_profiles
cmake --build build --target hlolli_wg_piano_generate_profiles
```

Edit the JSON, not the generated C block. The generator needs Python 3.8 or
newer, has no third-party packages, and writes no date or machine path. The
same input therefore gives the same C text. It also rejects output above the
browser compiler's 256 KiB source limit. Builds never run it on their own. The
checked-in C file still holds all runtime data and remains a single source file
for native and WASI builds.

The browser demo keeps a byte-for-byte copy of `hlolli_wg_piano.c` at
`demos/demo1/wg-piano.c` in the
[`csound-wasm-plugin-compiler`](https://github.com/hlolli/csound-wasm-plugin-compiler)
repository. Make model and profile changes here first, run the native checks,
then replace that demo file and run its piano build-and-play check. The WASI
build uses the same model and tables; only mutex and reset cleanup code differs.

## Piano capture data

The [capture guide](recordings/README.md) sets out a practical recording method
for notes, pedals, sympathetic strings, body taps, and room sweeps. The small
[capture example](recordings/example-capture.json) shows the data needed by a
fitting tool.

Use a generic public piano ID and class. Keep the maker, model, serial number,
names, and exact place in local notes when needed. Raw audio stays out of Git.
Only fitted numbers enter the profile JSON and the fixed arrays in
`hlolli_wg_piano.c`; the runtime still uses no samples or data files.

## Stand-alone build

The Csound include directory must contain `csdl.h`, `version.h`, and
`float-version.h`. For a Csound source checkout, use the generated include
directory in the build tree. The raw source `include` directory is not enough.

```sh
cmake -S . -B build -G Ninja \
  -DHLOLLI_CSOUND_BUILD_DIR=/path/to/csound/build \
  -DCSOUND_EXECUTABLE=/path/to/csound/build/csound
cmake --build build --target hlolli_wg_piano
ctest --test-dir build --output-on-failure
```

You can give the header directory instead:

```sh
cmake -S . -B build -G Ninja \
  -DHLOLLI_CSOUND_INCLUDE_DIR=/path/containing/csdl.h
```

`CSOUND_INCLUDE_DIR` also works for compatibility with older local plugin
projects. You may copy `Custom.cmake.example` to `Custom.cmake` instead of
putting local paths on every command line. Git ignores `Custom.cmake`.

The output name is normally:

| System | Module |
|---|---|
| macOS | `build/libhlolli_wg_piano.dylib` |
| Linux | `build/libhlolli_wg_piano.so` |
| Windows | `build/hlolli_wg_piano.dll` |

Run the short example on macOS with:

```sh
csound --opcode-lib=build/libhlolli_wg_piano.dylib examples/basic.csd
```

Change the module suffix for Linux or Windows. The CSD files do not contain a
fixed plugin path, so the same files work on all three systems.

## Add it to a Csound source build

Add this after Csound has defined `make_plugin()`, for example from Csound's
`Opcodes/CMakeLists.txt`:

```cmake
add_subdirectory(
  "/absolute/path/to/hlolli_wg_piano"
  "${CMAKE_BINARY_DIR}/hlolli_wg_piano"
)
```

The project detects the Csound build helper and uses it. Csound then supplies
the public headers, compile definitions, output directory, and correct plugin
install directory. The target is `hlolli_wg_piano`; the build-tree alias is
`hlolli::wg_piano`.

When a parent project does not provide `make_plugin()`, this project creates
the runtime module itself. Set `HLOLLI_CSOUND_BUILD_DIR` or
`HLOLLI_CSOUND_INCLUDE_DIR` before `add_subdirectory()`.

Do not link another target to this module. Csound loads it at runtime. The alias
exists so a parent can test for the target or add a build dependency.

## Install

A stand-alone build derives a default such as
`lib/csound/plugins64-7.0` under `CMAKE_INSTALL_PREFIX`:

```sh
cmake --install build --prefix "$HOME/.local"
```

Set an exact user plugin directory when the local Csound install uses another
layout. For example, configure a Csound 7 macOS user install with:

```sh
cmake -S . -B build -G Ninja \
  -DHLOLLI_CSOUND_BUILD_DIR=/path/to/csound/build \
  -DHLOLLI_CSOUND_PLUGIN_DIR="$HOME/Library/csound/7.0/plugins64"
cmake --build build
cmake --install build
```

When built inside Csound, Csound's own install rule takes over. No CMake package
export is installed because this is a loaded module, not a link library.

## Note opcode inputs

The ten sound controls run at k-rate. Values outside the accepted range are
clamped. The suggested range is not a hard limit; it marks the area that stays
close to an acoustic grand. The optional last input is the i-rate handle from
`hlolli_wg_piano_create`. Omit it for a detached note with no hidden wet send.

| Input | Accepted range | Suggested range | Grand value | Effect |
|---|---:|---:|---:|---|
| `kTrigger` | 0 to 1.25 | 0.05 to 1.0 | about 0.65 | Strike velocity and key state. Values above 1 give a harder accent. Zero releases and rearms the hammer. |
| `kFrequency` | 20 Hz to `0.45*sr` | 27.5 to 4186 Hz | note pitch | Fundamental frequency. Stay below `0.43*sr` for the fundamental rail. The paper-based partial fit is meant for the 88-key range at normal audio sample rates. |
| `kHardness` | 0 to 1 | 0.15 to 0.75 | 0.43 | Soft, long felt contact to short, bright contact. It also changes the attack sent to the bridge. |
| `kHammerPosition` | 0.025 to 0.45 | 0.07 to 0.20 | 0.12 | Strike point as a fraction of string length. It moves comb notches in the attack spectrum. |
| `kDecay` | 0 to 1 | 0.40 to 0.90 | 0.70 | Short to long scaling of the paper-calibrated two-term string loss. Key state and pedal add damper loss. |
| `kStiffness` | 0 to 1 | 0.15 to 0.70 | 0.42 | Low to high scaling of the paper-based inharmonicity curve. Large values can sound metallic. |
| `kDetune` | 0 to 1 | 0.20 to 0.80 | 0.60 | Spread of the active unison strings. Zero keeps a small built-in spread and drift. |
| `kBody` | 0 to 1 | 0.30 to 0.90 | 0.72 | Common bridge reflection and coupling, plus the short per-note bridge response. |
| `kStrange` | -1 to 1 | -0.30 to 0.30 | 0 | Prepared and unstable colors. Both signs add detune, nonlinear partials, coupling, and bridge motion. |
| `kPedal` | 0 to 1 | 0 to 1 | 0 or 0.82 held | Sets the local damper for a detached note. For a handled note, the wet opcode's shared pedal rail sets the damper. The dampers fully clear by about 0.82. |

## Piano handle and wet output

Each call to `hlolli_wg_piano_create` returns a new positive i-rate handle.
Pass the same handle to all notes and the one wet-output opcode for that piano.
Create a second handle for a second piano. Their modes, phases, held keys, and
delay memory remain separate.

```csound
giDefault hlolli_wg_piano_create
giNamed   hlolli_wg_piano_create "concert_grand_a"
```

The no-input form selects the compiled default profile, currently
`generic_2018`, which is also the current manifest default. The named form
binds its profile when it creates the handle; the profile cannot change while
that piano runs. An unknown name stops orchestra initialization with an error.
Profiles hold fixed acoustic data,
while each handle keeps its own changing state. The registry contains
`generic_2018` and `concert_grand_a`, in the order listed in
`profiles/manifest.json`.

The handle form of `hlolli_wg_piano_resonance` has one i-rate input and two
k-rate controls:

| Input | Range | Usual value | Effect |
|---|---:|---:|---|
| `iPiano` | valid handle | from `hlolli_wg_piano_create` | Selects the piano state and hidden note send. |
| `kBody` | 0 to 1 | 0.72 | Wet level, body-mode decay, and tail length and tone. Zero mutes the wet return. |
| `kPedal` | 0 to 1 | 0 or about 0.82 | Moves the piano's shared damper rail, opens the sympathetic bank, and lengthens the tail. The dampers fully clear by about 0.82. |

Handled notes write a tagged block buffer and the wet opcode reads the prior
block. This fixed one-`ksmps` delay makes the result independent of instrument
order and Csound worker count. The handle creator, handled notes, and handle
output must run at the orchestra's engine `ksmps`; the module rejects local
`setksmps` rates. Detached notes can still use a local rate. Use one live
wet-output opcode per handle.

For offline sample-accurate scores, two back-to-back instances of the same
output instrument can switch without resetting state. Csound may keep both
alive for one control block, so the module accepts only an exact,
non-overlapping handoff. Keep one output instance alive in real-time use.

The opcode clamps and smooths the controls. For handled notes, the wet opcode's
`kPedal` drives one shared damper rail for that piano. Half-pedal and repedalling
therefore affect the direct strings, sympathetic strings, and tail together. A
held note keeps its damper open even when the pedal is closed. Counts keep that
damper open until every overlapping voice for the key has released. Detached
notes still use their own `kPedal` input.

The sympathetic bank tracks three inharmonic partials for each of the 88 keys.
It uses the profile's per-key tuning, decay, and partial levels. The note opcode
can still bend a voice away from that stored pitch. A handled voice reports the
key nearest its initial frequency. Keep large pitch moves in a detached voice,
or start a new handled voice for the new key.

## Explicit-bus wet form

`hlolli_wg_piano_resonance` has two audio inputs and two k-rate controls:

| Input | Range | Usual value | Effect |
|---|---:|---:|---|
| `aBusLeft`, `aBusRight` | audio | summed note bus | Drives all shared modes and the common tail. |
| `kBody` | 0 to 1 | 0.72 | Wet level, body-mode decay, and tail length and tone. Zero mutes the wet return. |
| `kPedal` | 0 to 1 | 0 or about 0.82 | Opens the sympathetic modes and lengthens the shared tail. The dampers fully clear by about 0.82. |

This form has the old `aa <- aakk` signature. It uses a default global piano
state, so its modes also survive a wet-output instrument handoff. It has no
handle-tagged notes or held-key reports. Run only one live explicit-bus wet
opcode at a time. This persistent output form also requires engine `ksmps`.

## Two-opcode routing

The handle route needs no audio bus and does not depend on instrument order.
Schedule the wet output for the performance and final tail.

```csound
giPiano hlolli_wg_piano_create
gkPedal init 0.82

instr PianoNote
  iNote = p4
  iVelocity = p5
  xtratim 2.60
  kRelease release
  kTrigger = (kRelease == 0 ? iVelocity : 0)
  kFrequency init cpsmidinn(iNote)
  kTail linsegr 1, 0.01, 1, 2.60, 0

  aLeft, aRight hlolli_wg_piano \
      kTrigger, kFrequency, 0.43, 0.12, 0.70, \
      0.42, 0.60, 0.72, 0, gkPedal, giPiano

  aLeft *= kTail
  aRight *= kTail
  outs aLeft, aRight
endin

instr PianoResonance
  aWetLeft, aWetRight hlolli_wg_piano_resonance \
      giPiano, 0.72, gkPedal
  outs 0.35 * aWetLeft, 0.35 * aWetRight
endin
```

For example, schedule `PianoResonance` from time zero through the last note and
tail, such as `i "PianoResonance" 0 3600`. Do not run two output instances for
the same handle at once. Back-to-back instances are valid: the second resumes
the state that belongs to the handle. Keep an output running while notes play;
with no output, the wet phases stop and the two-block send buffer keeps only the
newest note blocks.

## Note control details

### Trigger and note life

A value above `0.0001` means key down. The first positive value strikes the
hammer. Return it to zero before the next ordinary strike. A rise of more than
about `0.035` can restrike a voice while it remains positive.

Velocity also makes the felt a little harder. A trigger of `1.25` is safe but
is meant for an accent, not a normal MIDI velocity map.

The note opcode still needs release time. After key-up, a detached note uses
its own `kPedal`; a handled note uses its piano's shared pedal rail. The highest
keys stay undamped. Give the host instrument enough release time and fade its
output at the end. A useful note-only pattern is:

```csound
xtratim 2.60
kRelease release
kTrigger = (kRelease == 0 ? iVelocity : 0)
kPedal = 0.82
kTail linsegr 1, 0.01, 1, 2.60, 0

aLeft, aRight hlolli_wg_piano \
    kTrigger, kFrequency, 0.43, 0.12, 0.70, \
    0.42, 0.60, 0.72, 0, kPedal
outs aLeft * kTail, aRight * kTail
```

Each note instance owns its string rails, hammer, and short bridge response.
When it has a handle, it sends its raw stereo output for the sympathetic modes
and tail. It also sends the bridge signal through that key's 12 body-mode
coupling values. Both sends happen before any gain or pan that follows the
opcode. The handle owns the long body and sympathetic state. Use the
explicit-bus wet form when the wet send must follow an outside gain, pan, or
effect. That form has no key identity, so its body modes use the supplied
stereo position instead of the key-coupling matrix.

The handle also gives each key a stable felt scale and slow unison-drift phase.
New voices for that key start from the same piano profile at the current Csound
time. Strike errors still vary. A note voice still owns its waveguide rails;
this version does not keep all 88 struck-string rails in the global state.

### Frequency

`kFrequency` can change while a note rings. Control values are smoothed over
about 25 ms and the string delay follows over about 18 ms, so pitch changes
glide instead of stepping. Normal piano use should pass `cpsmidinn()` values
from MIDI note 21 through 108. With a piano handle, held-key damping and the
shared drift state keep using the key chosen at the first performance block.
The opcode reads the first k-rate control values before it strikes, so `init`
and ordinary k-rate assignments give the same initial sound. Handled and
detached notes keep that key's string, hammer, and felt profile for the full
voice.

Each profile sets the second- and third-string level for every key. In
`generic_2018`, the second string fades in from about 39 to 49 Hz and the third
from about 116 to 147 Hz. Small inactive-string floors keep the internal state
safe but remain inaudible.

### Hammer hardness and position

`kHardness` sets felt contact time, attack brightness, and some bridge
brightness. A low value gives a soft attack. A high value shortens contact and
passes more high-frequency energy. Velocity adds a small amount of hardness at
each strike.

The hammer uses a reduced nonlinear contact. A compression state drives a
power-law felt force, reads back the common string motion, and loses a small
amount of force on release. Contact ends when the felt separates from the
string. This is more than a fixed force pulse, but it is not a full action or
felt material model.

`kHammerPosition` sets the delay of the hammer-position comb. Values near the
suggested range give common piano spectra. Large values move the notches lower
and can make the attack hollow. Hardness and position matter most at the next
strike.

### Decay, stiffness, and detune

`kDecay` scales each key's direct string-loss terms. At `kDecay=0.70` and
`kStiffness=0.42`, the complete string loop uses the profile's base fit. This
remains an approximation because the same loop also contains the unison bridge
and delay filters. Bass strings keep more energy than short treble strings, and
upper partials lose energy faster. After key release, the local or shared
pedal rail sets a separate damper loss.

`kStiffness` scales each key's direct inharmonicity value. The generic profile
stores the curve through the Bensa et al. C2, C4, and C7 values; recording
profiles can replace it key by key. Four to eight dispersion stages fit the
fundamental and one upper reference partial. The partials between them remain
approximate; normal-range test renders stay within about 12 cents of the target
curve. At `0.42`, the control uses the profile value without extra scale. Keep
it below about `0.70` for a piano; higher values are useful for bell-like tones.

`kDetune` scales each key's `unison_width_cents`; `0.35` uses the stored width.
Every strike also gets very small errors in pitch, level, contact time, and
comb position. Each string has its own slow pitch drift. These changes stop
repeated notes from being exact copies without making a normal preset sound
out of tune.

### Body and pedal

The two opcodes give these controls different jobs:

- On `hlolli_wg_piano`, `kBody` changes the common unison bridge reflection,
  coupling, and short four-line bridge response. It does not add a long body
  tail.
- On `hlolli_wg_piano_resonance`, `kBody` sets the wet level and shapes the 12
  body modes and eight-line tail.
- On a detached note, `kPedal` opens that note's damper after key release.
- On the wet opcode, `kPedal` moves the shared damper rail for handled notes,
  opens the sympathetic bank, and lengthens the shared tail.

For handled notes, the profile's key-to-body-mode matrix sets which shared
body modes the bridge excites. The shipped matrix uses a smooth modeled bridge
shape. Body-tap data can replace it with a piano-specific fit later.

Half-pedal and repedalling work on handled notes through the shared rail. On a
detached note, half-pedal works through its local control. Values up to about
`0.82` cover the useful damper travel; larger values remain fully open. The wet
opcode is a wet return, so mix it with the direct note output.

### Strange

Leave `kStrange` at zero for the acoustic preset.

- Negative values add loss and lower the third string. At `-1`, that string is
  one octave below its usual pitch.
- Positive values add more dispersion.
- Both signs add unison spread, nonlinear partials, stronger string coupling,
  and a signed cyclic path in the short bridge response.

Values between about `-0.30` and `0.30` keep the note identity clear. The full
range is for prepared and unstable sounds.

## Starting settings

This is the main realistic starting point:

```text
kHardness        0.43
kHammerPosition  0.12
kDecay           0.70
kStiffness       0.42
kDetune          0.60
kBody            0.72
kStrange         0.00
kPedal           0.00 key up, about 0.82 for a held pedal
```

Some useful variants:

| Sound | Hardness | Position | Decay | Stiffness | Detune | Body | Strange |
|---|---:|---:|---:|---:|---:|---:|---:|
| Soft grand | 0.28 | 0.14 | 0.80 | 0.34 | 0.55 | 0.80 | 0 |
| Plain grand | 0.43 | 0.12 | 0.70 | 0.42 | 0.60 | 0.72 | 0 |
| Bright studio | 0.58 | 0.10 | 0.66 | 0.48 | 0.58 | 0.62 | 0 |
| Worn piano | 0.38 | 0.13 | 0.76 | 0.40 | 0.78 | 0.75 | 0.04 |
| Prepared | 0.64 | 0.08 | 0.72 | 0.70 | 0.82 | 0.66 | 0.55 |

## Nonfinite input handling

NaN and infinity are replaced before control clamping. The fallbacks are
trigger `0`, frequency `440`, hardness `0.45`, position `0.12`, decay `0.65`,
stiffness `0.45`, detune `0.35`, body `0.65`, strange `0`, and pedal `0`.
These are safety values, not optional arguments or the recommended preset.
The wet opcode uses `0.72` for a nonfinite body control and `0` for a
nonfinite pedal control. A nonfinite wet result clears its shared state.
Nonfinite shared audio inputs are replaced with zero before they reach that
state. Piano handles must be finite positive integers returned by
`hlolli_wg_piano_create`; an unknown handle stops the new opcode instance at
init time.

## Model notes

The reduced signal path follows ideas in Balazs Bank and Juliette Chabassier,
"Model-based digital pianos: from physics to sound synthesis" (2019). Its
string calibration also uses Julien Bensa, Stefan Bilbao, Richard
Kronland-Martinet, and Julius O. Smith III, "The simulation of piano string
vibration: From physical models to finite difference schemes and digital
waveguides" (2003).

Each note instance contains:

- one to three detuned string rails;
- four to eight dispersion stages fitted to a note-based inharmonicity curve;
- two-term, frequency-dependent string loss fitted across the keyboard;
- a reduced nonlinear hammer contact with pitch-scaled duration, compression,
  release loss, string-motion feedback, and filtered felt noise;
- fixed and slowly moving unison errors;
- a filtered common bridge junction that lets the unison rails exchange
  energy;
- three short hammer and felt modes, low-level nonlinear color, direct bridge
  radiation, and a short four-line bridge response.

The paper loss values describe an equivalent string measured at the bridge.
They do not split internal string loss from bridge and soundboard loss.

Each piano handle owns:

- one immutable piano profile choice;
- 12 shared body modes from 58 Hz to 3220 Hz;
- three sympathetic partial resonators for each key from A0 to C8;
- an eight-line feedback-delay tail with stereo input and output;
- one shared pedal and damper rail, per-key held counts, and fixed drift and
  felt profiles;
- short synthesized key, damper, and pedal sounds scaled by the profile;
- stereo note sends, per-body-mode bridge sends, and all wet filter phases.

Csound stores these objects in one named global registry per Csound instance.
It allocates their delay memory outside any note or wet-output instrument and
frees it at Csound reset. Native builds use a plugin reset callback. The WASI
loader cannot retain that callback, so Csound's own reset frees the named global
and its tracked blocks. A wet-output opcode advances one object and returns its
audio. The sympathetic bank models three inharmonic partials per key, not every
partial of every unstruck string.

This remains a reduced real-time model, not a full piano action, string set,
soundboard, or radiation model.

## Examples

`examples/basic.csd` plays two sustained chords and shows one piano handle,
tagged notes, and a dry/wet mix.

`examples/chopin_aeolian_harp.csd` plays the opening of Chopin's Etude in
A-flat major, Op. 25 No. 1. Its top melody overlaps each next beat. It routes
all notes through one piano handle, then adds a small room.

`tests/smoke.csd` gives a short render that calls both opcodes.

`tests/run_initial_controls_test.py` compares direct and wet renders from
equivalent initial and k-rate controls across both profiles and three block
sizes. `tools/test_audio_analysis.py` checks known pitch, silence, truncated
files, and measurement limits. Both run through CTest.

`tools/piano_fit_adapter.py` uses the analyzer's same checked renderer and
fit/check selector as the violin project. It sweeps the public body, hammer
hardness, and hammer-position controls over low, middle, and high notes. This
proves that the fit interface does not depend on violin strings or profiles.

The current piano adapter is render-only. Its fit manifest has no saved-profile
paths, so the shared profile writer rejects it. This is deliberate: the three
public controls do not each map to one fixed field in a piano profile. Add an
exact profile rule before enabling piano profile output.

Reference conversion uses a windowed-sinc filter to preserve the measured
bands and remove frequencies above the new sample rate's Nyquist limit.

The same C source and either CSD can also be pasted into the
[Csound opcode workbench](https://hlolli.github.io/plugin-compiler/).

## License

MIT. See `LICENSE`.
