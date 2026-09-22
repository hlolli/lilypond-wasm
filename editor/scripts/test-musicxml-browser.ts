import { strict as assert } from "node:assert";
import { resolve, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve(import.meta.dir, "../dist");
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  fetch(request) {
    const path = resolve(root, `.${new URL(request.url).pathname}`);
    if (!path.startsWith(root + sep)) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(path));
  },
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
try {
  const page = await browser.newPage();
  await page.route("**/index.html", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>MusicXML worker test</title>" }));
  const remote: string[] = [];
  await page.route("**/*", route => {
    if (new URL(route.request().url()).origin === server.url.origin) return route.fallback();
    remote.push(route.request().url());
    return route.abort();
  });
  // A minimal host, so this exercises the worker's public messages directly.
  await page.goto(new URL("index.html", server.url).href);
  const run = (source: string, type: "render" | "musicxml") => page.evaluate(
    ({ source, type }) => new Promise<{
      type: string; musicxml?: Array<{ name: string; source: string }>;
      exitCode?: number; svgs?: string[]; message?: string; diagnostics: string[];
    }>((accept, reject) => {
      const worker = new Worker("./lilypond.worker.js", { type: "module" });
      const diagnostics: string[] = [];
      let progress = "Starting worker";
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error(`Worker timeout (${progress}): ${diagnostics.join("\n")}`));
      }, 60000);
      worker.onerror = event => { clearTimeout(timeout); worker.terminate(); reject(new Error(event.message)); };
      worker.onmessage = ({ data }) => {
        if (data.type === "progress") progress = data.message;
        if (data.type === "diagnostic") diagnostics.push(data.message);
        if (data.type === "result" || data.type === "error") {
          clearTimeout(timeout); worker.terminate(); accept({ ...data, diagnostics });
        }
      };
      worker.postMessage({ type, requestId: 1, source });
    }), { source, type });
  const source = String.raw`\version "2.27.2"
    tune = \relative c' { \time 3/4 \tempo 4 = 90 c4\p d e | f2. }
    \score { \new PianoStaff << \new Staff \tune \new Staff { \clef bass c2. d2. } >> }`;
  const result = await run(source, "musicxml");
  assert.equal(result.type, "result", JSON.stringify(result));
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.svgs, []);
  assert.equal(result.musicxml?.length, 1);
  const xml = result.musicxml![0].source;
  const notes = await page.evaluate(xml => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Invalid MusicXML");
    return Array.from(doc.querySelectorAll("note > pitch"), p => [p.querySelector("step")?.textContent, p.querySelector("octave")?.textContent]);
  }, xml);
  assert.deepEqual(notes, [["C", "4"], ["C", "3"], ["D", "4"], ["E", "4"], ["F", "4"], ["D", "3"]]);
  assert.match(xml, /<staves>2<\/staves>/);
  const invalid = await run(String.raw`\score { \new Staff { \grace c'16 d'4 } }`, "musicxml");
  assert.equal(invalid.type, "error");
  assert.match(invalid.diagnostics.join("\n"), /unsupported music GraceMusic/);
  assert.equal(invalid.musicxml, undefined);
  assert.deepEqual(remote, []);
  console.log("Browser MusicXML export and strict failure passed, using local resources only.");
} finally {
  await browser.close();
  server.stop(true);
}
