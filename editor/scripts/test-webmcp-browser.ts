import { strict as assert } from "node:assert";
import { resolve, sep } from "node:path";
import { chromium } from "playwright";

interface BrowserTool { name: string }
interface BrowserModelContext {
  getTools(): Promise<BrowserTool[]>;
  executeTool(tool: BrowserTool, input: string | Record<string, unknown>): Promise<unknown>;
}
interface ToolResult {
  ok: boolean;
  source: string;
  revision: number;
  render_state: string;
  rendered_pages: unknown[];
  has_csound_score: boolean;
  score_file: string;
  playback_state: string;
  duration_seconds: number;
  position_seconds: number;
  error?: { code: string };
  default_instrument: { name: string };
  orchestra: { source: string };
  documents: Array<{ id: string; local_url: string | null }>;
  matches: Array<{ document_id: string; start_line: number }>;
  unavailable_documents: string[];
  text: string;
}

const root = resolve(import.meta.dir, "../dist");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const pathname = new URL(request.url).pathname.replace(/\/$/, "/index.html");
    const path = resolve(root, `.${pathname}`);
    const file = Bun.file(path);
    if (!path.startsWith(root + sep) || !(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(file);
  },
});
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-experimental-web-platform-features", "--enable-features=WebMCP"],
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
try {
  const page = await browser.newPage({ acceptDownloads: true });
  page.setDefaultTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  // Keep Csound loading when the first Play call reaches the editor.
  let releaseCsound!: () => void;
  const csoundGate = new Promise<void>(resolve => { releaseCsound = resolve; });
  await page.route("**/assets/csound-*.js", async route => {
    await csoundGate;
    await route.continue();
  });
  await page.goto(process.env.WEBMCP_TEST_URL ?? server.url.href);
  await page.waitForFunction(async () => {
    const context = (document as Document & { modelContext?: BrowserModelContext }).modelContext;
    return (await context?.getTools())?.length === 13;
  });
  // Chrome 155 replaced JSON text arguments with objects.
  const objectInput = Number(browser.version().split(".")[0]) >= 155;
  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const result = await page.evaluate(async ({ name, input, objectInput }) => {
      const context = (document as Document & { modelContext: BrowserModelContext }).modelContext;
      const tool = (await context.getTools()).find(tool => tool.name === name);
      if (!tool) throw new Error(`Missing WebMCP tool: ${name}`);
      const raw = await context.executeTool(tool, objectInput ? input : JSON.stringify(input));
      return (typeof raw === "string" ? JSON.parse(raw) : raw) as ToolResult;
    }, { name, input, objectInput });
    console.log(`${name}: ${result.ok ? "ok" : result.error?.code}`);
    return result;
  };
  const initial = await call("read_workspace");
  assert.equal(initial.ok, true);
  assert.match(initial.source, /lpcs\.ily/);
  assert.match(initial.source, /PianoStaff/);
  assert.equal(initial.default_instrument.name, "hlolli_wg_piano");
  assert.match(initial.orchestra.source, /hlolli_wg_piano/);
  const found = await call("search_documentation", { query: "kHammerPosition" });
  assert.deepEqual(found.unavailable_documents, []);
  assert.ok(found.matches.some(match => match.document_id === "piano"));
  const reference = await call("read_documentation", { document_id: "piano", line_count: 40 });
  assert.match(reference.text, /hlolli_wg_piano_create/);
  const opcodes = await call("search_documentation", { query: "linsegr" });
  assert.ok(opcodes.matches.some(match => match.document_id === "csound-opcodes"));
  // Allow media playback through a real click, without an autoplay override.
  await page.locator("h1").click();
  await page.locator("#render-button:enabled").waitFor();
  assert.equal((await call("render_score")).ok, true);
  const ready = await call("read_workspace");
  assert.equal(ready.render_state, "rendered");
  assert.equal(ready.has_csound_score, true);
  assert.match(ready.score_file, /\.sco$/);
  assert.ok(ready.rendered_pages.length > 0);
  await page.frameLocator("iframe").first().locator("[data-lpcs-anchor-id]").first().waitFor();

  const playing = call("play_score");
  await page.waitForFunction(() => document.querySelector("#score-transport")?.getAttribute("data-state") === "preparing");
  releaseCsound();
  const played = await playing;
  if (!played.ok) console.error(await page.locator("body").innerText());
  assert.equal(played.ok, true);
  assert.equal(played.playback_state, "playing");
  assert.ok(played.duration_seconds > 0);
  assert.equal((await call("pause_playback")).playback_state, "paused");
  assert.equal((await call("seek_playback", { position_seconds: 1 })).position_seconds, 1);
  assert.equal((await call("resume_playback")).playback_state, "playing");
  assert.equal((await call("stop_playback")).position_seconds, 0);

  const peak = await page.evaluate(async () => {
    const audio = document.querySelector<HTMLAudioElement>("#score-audio")!;
    const bytes = await (await fetch(audio.src)).arrayBuffer();
    const context = new OfflineAudioContext(2, 1, 48_000);
    const decoded = await context.decodeAudioData(bytes);
    let peak = 0;
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      for (const sample of decoded.getChannelData(channel)) {
        if (!Number.isFinite(sample)) throw new Error("Non-finite audio sample");
        peak = Math.max(peak, Math.abs(sample));
      }
    }
    return peak;
  });
  assert.ok(peak > 0.001, `Csound audio is silent: peak ${peak}`);
  for (const name of ["export_svg", "export_pdf"]) {
    const download = page.waitForEvent("download");
    assert.equal((await call(name)).ok, true);
    assert.equal(await (await download).failure(), null);
  }
  assert.equal((await call("update_lilypond", {
    source: initial.source + "\n% WebMCP regression check\n", base_revision: initial.revision,
  })).ok, true);
  assert.equal((await call("update_lilypond", {
    source: initial.source, base_revision: initial.revision,
  })).error?.code, "revision_conflict");
  assert.equal((await call("play_score")).error?.code, "stale_render");
  assert.equal((await call("export_svg")).ok, false);

  const rendering = call("render_score");
  await page.waitForFunction(() => document.querySelector("#render-button")?.textContent?.includes("Cancel"));
  assert.equal((await call("cancel_render")).ok, true);
  assert.equal((await rendering).ok, false);
  assert.deepEqual(errors, []);
  console.log("Passed: native WebMCP, LPCS score/timeline, audible Csound WAV, playback, exports, stale edits, and cancellation.");
} finally {
  await browser.close();
  server.stop(true);
}
