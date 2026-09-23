import { describe, expect, test } from "bun:test";
import { documentationContext, EditorDocumentation } from "./documentation";

const base = "https://example.com/lilypond/";
describe("editor documentation", () => {
  test("exposes versions, the piano and subpath-safe documentation URLs", () => {
    const context = documentationContext(base);
    expect(context.default_instrument.name).toBe("hlolli_wg_piano");
    expect(context.default_instrument.plugin_url).toBe(`${base}plugins/hlolli_wg_piano.wasm`);
    expect(context.versions.lpcs_revision).toHaveLength(40);
    expect(context.documents.find(doc => doc.id === "piano")?.local_url).toStartWith(base);
    expect(context.documents.find(doc => doc.id === "lilypond-notation")?.available_in_tab).toBe(false);
    expect(context.playback_limits).toContain("does not include the newer direct JSON playback API");
  });

  test("searches local text and supplies line numbers and external manual queries", async () => {
    const docs = new EditorDocumentation(base, async url => url.includes("piano") ? "Piano\nThe kHammerPosition control sets the strike point.\nPedal controls damping." : "Other reference");
    const result = await docs.search("kHammerPosition");
    expect(result.matches[0]).toMatchObject({ document_id: "piano", start_line: 1 });
    expect(result.matches[0]?.excerpt).toContain("strike point");
    expect(result.external_searches[0]?.query).toContain("site:lilypond.org");
    expect(result.unavailable_documents).toEqual([]);
    const page = await docs.read("piano", 2, 1);
    expect(page).toMatchObject({ text: "The kHammerPosition control sets the strike point.", next_line: 3, total_lines: 3 });
  });

  test("rejects arbitrary document paths and points to online-only manuals", async () => {
    const docs = new EditorDocumentation(base, async () => "unused");
    await expect(docs.read("../../secret")).rejects.toMatchObject({ code: "unknown_document" });
    expect(await docs.read("lilypond-notation")).toMatchObject({ available_in_tab: false, source_url: "https://lilypond.org/doc/v2.27/Documentation/notation/index.html" });
  });

  test("reports a missing reference and retries it on the next search", async () => {
    let fail = true;
    const docs = new EditorDocumentation(base, async url => {
      if (url.includes("piano") && fail) throw new Error("offline");
      return "hammer";
    });
    expect((await docs.search("hammer")).unavailable_documents).toContain("piano");
    fail = false;
    expect((await docs.search("hammer")).unavailable_documents).toEqual([]);
  });
});
