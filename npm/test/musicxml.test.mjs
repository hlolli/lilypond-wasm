import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const include = process.env.LILYPOND_MUSICXML_INCLUDE || fileURLToPath(new URL("../musicxml/", import.meta.url));
const reader = fileURLToPath(new URL("./read-musicxml.py", import.meta.url));

function events(xml) {
  const result = spawnSync(process.env.PYTHON || "python3", [reader], { input: xml, encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function compile(source, expectedError, scoreCount = 1, expectSVG = true) {
  const directory = await mkdtemp(resolve(tmpdir(), "lilypond-musicxml-"));
  try {
    const input = resolve(directory, "input.ly");
    for (const name of ["musicxml.ily", "musicxml-only.ily", "musicxml.scm"]) {
      await writeFile(resolve(directory, name), await readFile(resolve(include, name)));
    }
    await writeFile(input, '\\include "musicxml.ily"\n' + source);
    let executable = process.env.LILYPOND_BIN || "lilypond";
    let args = [
      "-dbackend=svg", "-I", include,
      "-o", resolve(directory, "score"), input,
    ];
    if (process.env.LILYPOND_WASM_PACKAGE) {
      const root = resolve(process.env.LILYPOND_WASM_PACKAGE);
      const manifest = JSON.parse(await readFile(resolve(root, "runtime-manifest.json"), "utf8"));
      await Promise.all(["home", "tmp", "cache/fontconfig"].map(path => mkdir(resolve(directory, path), { recursive: true })));
      executable = process.env.WASMTIME_BIN || "wasmtime";
      args = ["run", "-W", "exceptions=y", "--dir", `${directory}::/work`, "--dir", `${include}::/exporter`,
        ...manifest.mountOrder.flatMap(path => ["--dir", `${resolve(root, manifest.mounts[path])}::${path}`]),
        ...Object.entries(manifest.environment).flatMap(([name, value]) => ["--env", `${name}=${value}`]),
        "--argv0", manifest.argv0, resolve(root, manifest.wasm),
        "-dbackend=svg", "-I", "/exporter", "-o", "/work/score", "/work/input.ly"];
    }
    const result = spawnSync(executable, args, { encoding: "utf8", timeout: 60_000 });
    if (result.error) throw result.error;
    result.stderr = result.stderr.replace(/;;;[^\n]*\n/g, "");
    if (expectedError) {
      assert.notEqual(result.status, 0, result.stderr);
      assert.match(result.stderr, expectedError);
      assert.deepEqual((await readdir(directory)).filter(name => name.endsWith(".musicxml")), []);
      return;
    }
    assert.equal(result.status, 0, result.stderr);
    const scores = (await readdir(directory)).filter(name => name.endsWith(".musicxml"));
    assert.equal(scores.length, scoreCount);
    assert.equal((await readdir(directory)).some(name => name.endsWith(".svg")), expectSVG);
    for (const name of scores) events(await readFile(resolve(directory, name), "utf8"));
    const xml = (await readFile(resolve(directory, "score.musicxml"), "utf8")).replace(/\s+\/>/g, "/>");
    events(xml);
    if (process.env.MUSICXML_SCHEMA) {
      const checked = spawnSync("xmllint", ["--nonet", "--noout", "--schema", process.env.MUSICXML_SCHEMA, "-"],
        { input: xml, encoding: "utf8" });
      if (checked.error) throw checked.error;
      assert.equal(checked.status, 0, checked.stderr);
    }
    if (process.env.ANALYZER_BIN) {
      const imported = spawnSync(process.env.ANALYZER_BIN, ["import-score", resolve(directory, "score.musicxml")],
        { encoding: "utf8" });
      if (imported.error) throw imported.error;
      assert.equal(imported.status, 0, imported.stderr);
      const score = JSON.parse(imported.stdout);
      assert.equal(score.schema, "hwa-musicxml-score");
      assert.ok(score.events.some(e => e.kind === "note"));
    }
    return xml;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("the LilyPond compiler exports resolved notes as MusicXML", async () => {
  const xml = await compile(String.raw`music = \relative c' { \time 4/4 c4 d e f }
    \score { \new Staff \music }`);
  assert.match(xml, /<score-partwise version="4.0">/);
  assert.equal((xml.match(/<note>/g) || []).length, 4);
  assert.match(xml, /<step>C<\/step>.*<octave>4<\/octave>/s);
  assert.match(xml, /<beats>4<\/beats><beat-type>4<\/beat-type>/);
});

test("piano staves, tuplets, ties, dynamics, repeat signs, and a pickup survive", async () => {
  const xml = await compile(String.raw`\score { \new PianoStaff <<
    \new Staff \relative c' {
      \key d \minor \time 3/4 \tempo 4 = 80 \partial 4 c4\p
      \repeat volta 2 { <d f a>4~ <d f a>8 r8 \tuplet 3/2 { c8 d e } }
      f2.\f
    }
    \new Staff { \clef bass \time 3/4 \partial 4 c4 c2. c2. }
  >> }`);
  assert.equal((xml.match(/<part id=/g) || []).length, 1);
  assert.match(xml, /<staves>2<\/staves>/);
  assert.match(xml, /<fifths>-1<\/fifths><mode>minor<\/mode>/);
  assert.match(xml, /<key number="1">/);
  assert.match(xml, /tempo="80.0"/);
  assert.equal((xml.match(/<chord\/>/g) || []).length, 4);
  assert.equal((xml.match(/<tie type="start"\/>/g) || []).length, 3);
  assert.equal((xml.match(/<tie type="stop"\/>/g) || []).length, 3);
  assert.equal((xml.match(/<actual-notes>3<\/actual-notes>/g) || []).length, 3);
  assert.match(xml, /<repeat direction="forward"\/>/);
  assert.match(xml, /<repeat direction="backward" times="2"\/>/);
  assert.match(xml, /<dynamics><p\/><\/dynamics>/);
  assert.match(xml, /<dynamics><f\/><\/dynamics>/);
  assert.match(xml, /implicit="yes"/);
});

test("unsupported music fails without publishing a partial score", async () => {
  await compile(String.raw`\score { \new Staff { \grace c'16 d'4 } }`, /MusicXML export: unsupported music GraceMusic/);
});

test("parallel voices retain independent clocks, with split notes tied across bars", async () => {
  const xml = await compile(String.raw`\score { \new Staff <<
    \new Voice = "high" { \time 3/4 c'1 d'2 }
    \new Voice = "low" { e2. f2. }
  >> }`);
  const notes = events(xml);
  assert.deepEqual(notes.filter(n => n.voice === "high").map(n => [n.midi, n.start, n.duration]),
    [[60, 0, 3], [60, 3, 1], [62, 4, 2]]);
  assert.deepEqual(notes.filter(n => n.voice === "low").map(n => [n.midi, n.start, n.duration]),
    [[52, 0, 3], [53, 3, 3]]);
  assert.equal((xml.match(/<tie type="start"\/>/g) || []).length, 1);
  assert.equal((xml.match(/<tie type="stop"\/>/g) || []).length, 1);
});

test("transposition, meter changes, and unfolded repeats use compiler semantics", async () => {
  const xml = await compile(String.raw`phrase = \relative c' { c4 d e }
    \score { \new Staff { \time 3/4 \transpose c d \phrase
      \time 2/4 \repeat unfold 2 { f'8 g' a' b' } } }`);
  assert.deepEqual(events(xml).map(n => [n.midi, n.start, n.duration]),
    [[62, 0, 1], [64, 1, 1], [66, 2, 1], [65, 3, .5], [67, 3.5, .5],
     [69, 4, .5], [71, 4.5, .5], [65, 5, .5], [67, 5.5, .5], [69, 6, .5], [71, 6.5, .5]]);
});

test("unsupported structure and ambiguous timing fail closed", async () => {
  for (const [source, error] of [
    [String.raw`\score { << { \tempo 4 = 90 } \new Staff { c'1 } >> }`, /outside parallel part contexts/],
    [String.raw`\score { \new Staff { \time 4/4 c'4 \time 3/4 d'2. } }`, /inside a measure/],
    [String.raw`\score { \new Staff { \repeat volta 2 { c'1 } \alternative { { d'1 } { e'1 } } } }`, /repeat alternatives/],
    [String.raw`\score { \new Staff { c'1~ } }`, /unterminated tie/],
  ]) await compile(source, error);
});

test("written expression and final pedal release survive without invented notes", async () => {
  const xml = await compile(String.raw`\score { \new Staff \relative c' {
    \time 4/4 c4\p(\sustainOn d-. e->\< f\trill) | g2\!\f a2\fermata \sustainOff
  } }`);
  assert.equal(events(xml).length, 6);
  for (const pattern of [/<staccato\/>/, /<accent\/>/, /<trill-mark\/>/, /<fermata\/>/,
                         /<slur type="start"/, /<slur type="stop"/,
                         /<wedge type="crescendo"/, /<wedge type="stop"/,
                         /<pedal type="start"/, /<pedal type="stop"/]) assert.match(xml, pattern);
});

test("including the module twice exports each bookpart score once", async () => {
  const xml = await compile(String.raw`\include "musicxml.ily"
    \book { \bookpart { \score { \new Staff { c'1 } } }
            \bookpart { \score { \new Staff { d'1 } } } }`, undefined, 2);
  assert.deepEqual(events(xml).map(n => n.midi), [60]);
});

test("export-only mode skips engraving but writes the same musical data", async () => {
  const score = String.raw`\score { \new Staff { \time 3/4 c'4 d' e' } }`;
  const both = await compile(score);
  const only = await compile('\\include "musicxml-only.ily"\n' + score, undefined, 1, false);
  assert.equal(only, both);
});
