import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

// Exercise the real worker filesystem: a mock cannot catch corrupt WAV headers.
const temp = await mkdtemp(join(tmpdir(), "lilypond-csound-test-"));
const entry = join(temp, "entry.ts");
await Bun.write(entry, `
import Csound from ${JSON.stringify(resolve(import.meta.dir, "../node_modules/@csound/browser/dist/csound.js"))};
import { renderScoreToWav } from ${JSON.stringify(resolve(import.meta.dir, "../audio/csound-renderer.ts"))};
window.render = async (sampleRate, channels, amplitude) => Array.from(await renderScoreToWav(
  'i 17 0 0.05\\ne',
  \`sr = \${sampleRate}
ksmps = 16
nchnls = \${channels}
0dbfs = 1
instr 17
aSignal oscili \${amplitude}, 440
out aSignal\${channels === 2 ? ', aSignal' : ''}
endin\`,
  { createCsound: options => Csound({ ...options, audioContext: new AudioContext({ sampleRate }) }) },
));
`);
const build = await Bun.build({ entrypoints: [entry], target: "browser", format: "esm", outdir: temp });
assert.ok(build.success, String(build.logs));
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  return new URL(request.url).pathname === "/entry.js"
    ? new Response(Bun.file(join(temp, "entry.js")))
    : new Response('<script type="module" src="/entry.js"></script>', { headers: { "content-type": "text/html" } });
} });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(server.url.href);
  await page.waitForFunction(() => typeof (window as any).render === "function");
  for (const [sampleRate, channels, amplitude] of [[48000, 2, 0], [44100, 1, 0.2]]) {
    const output = await page.evaluate(async ({ sampleRate, channels, amplitude }) =>
      (window as any).render(sampleRate, channels, amplitude), { sampleRate, channels, amplitude });
    const bytes = Uint8Array.from(output as number[]);
    const view = new DataView(bytes.buffer);
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), "RIFF");
    assert.equal(view.getUint32(4, true), bytes.length - 8, "RIFF size must cover the full audio file");
    assert.equal(view.getUint16(20, true), 1, "PCM format");
    assert.equal(view.getUint16(22, true), channels);
    assert.equal(view.getUint32(24, true), sampleRate);
    assert.equal(view.getUint16(34, true), 16);
    assert.equal(new TextDecoder().decode(bytes.subarray(36, 40)), "data");
    assert.equal(view.getUint32(40, true), bytes.length - 44);
    const duration = (bytes.length - 44) / (sampleRate * channels * 2);
    assert.ok(Math.abs(duration - 0.05) < 0.01, `Wrong audio length ${duration}`);
    let peak = 0;
    for (let i = 44; i < bytes.length; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)) / 32768);
    if (amplitude === 0) assert.equal(peak, 0, "Silent output must not contain WAV headers interpreted as sound");
    else assert.ok(peak > 0.19 && peak < 0.21, `Wrong sine amplitude ${peak}`);
    console.log(`Passed: ${sampleRate} Hz, ${channels} channels, ${duration}s, peak ${peak}`);
  }
} finally {
  await browser.close();
  server.stop(true);
  await rm(temp, { recursive: true, force: true });
}
