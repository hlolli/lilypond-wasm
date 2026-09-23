import { lilypondVersion } from "@hlolli/lilypond-wasm";
import piano from "./plugins/hlolli_wg_piano/manifest.json";
import { WebMcpActionError } from "./webmcp";

const lpcsRevision = "26e16a60fadb885aefce9f62a8eb7143a7cef7e0";
const lpcsRoot = `https://github.com/hlolli/lilypond-csound-score-plugin/blob/${lpcsRevision}`;

export const documentationCatalog = [
  { id: "editor", title: "Editor and WebMCP guide", path: "source/editor/README.md", url: "https://github.com/hlolli/lilypond-wasm/tree/main/editor", topics: "tools render playback folders orchestra PDF SVG MusicXML" },
  { id: "piano", title: "hlolli_wg_piano controls and profiles", path: "plugins/hlolli_wg_piano/README.md", url: `${piano.repository}/blob/${piano.revision}/README.md`, topics: "piano hammer trigger frequency hardness decay stiffness detune body pedal resonance handles profiles" },
  { id: "lpcs", title: "LilyPond Csound Score export", path: "docs/lpcs/README.md", url: `${lpcsRoot}/README.md`, topics: "lilypond2csound lpcs.ily csoundExportOptions csoundUnfoldForExport dynamics ties repeats percussion gestures strict limits" },
  { id: "lpcs-contract", title: "LPCS v0.3 score fields and IR contract", path: "docs/lpcs/contract-v0.3.md", url: `${lpcsRoot}/docs/contract-v0.3.md`, topics: "p-fields 28-field ABI instrument 17 p1 p3 p8 p9 p10 p11 p12 p13 metadata schema" },
  { id: "lpcs-timeline", title: "LPCS timeline and playback cursor", path: "docs/lpcs/TIMECODES.md", url: `${lpcsRoot}/TIMECODES.md`, topics: "tempo seconds beats sample frames cursor anchors seek repeats" },
  { id: "csound-opcodes", title: "Csound opcode signatures and manual links", path: "docs/csound-opcodes.md", url: "https://csound.com/docs/manual/index.html", topics: "Csound orchestra opcodes syntax functions audio envelopes synthesis" },
  { id: "musicxml", title: "WASM API and MusicXML export limits", path: "docs/wasm-api.md", url: "https://github.com/hlolli/lilypond-wasm/tree/main/npm", topics: "worker WASI SVG musicxml export supported unsupported" },
  { id: "lilypond-notation", title: "LilyPond 2.27 notation reference", path: null, url: "https://lilypond.org/doc/v2.27/Documentation/notation/index.html", topics: "LilyPond syntax notes chords rhythms rests ties dynamics repeats PianoStaff piano clefs score layout paper markup" },
  { id: "lilypond-learning", title: "LilyPond 2.27 learning manual", path: null, url: "https://lilypond.org/doc/v2.27/Documentation/learning/index.html", topics: "LilyPond tutorial relative pitches durations voices staff notation beginner" },
  { id: "lilypond-internals", title: "LilyPond 2.27 internals", path: null, url: "https://lilypond.org/doc/v2.27/Documentation/internals/index.html", topics: "LilyPond Scheme engravers grobs properties contexts override" },
  { id: "csound-manual", title: "Csound reference manual", path: null, url: "https://csound.com/docs/manual/index.html", topics: "Csound language orchestra score syntax opcodes instruments UDOs audio" },
  { id: "csound-browser", title: "Csound browser API", path: "docs/csound-browser.md", url: "https://github.com/csound/csound/tree/develop/wasm/browser", topics: "Csound JavaScript WebAssembly withPlugins worker offline audio render browser API" },
] as const;

export function documentationContext(baseUrl: string) {
  return {
    versions: {
      lilypond: lilypondVersion,
      lilypond_wasm: "0.1.0-alpha.4",
      csound_browser: piano.csound_browser,
      piano_revision: piano.revision,
      lpcs_revision: lpcsRevision,
    },
    default_instrument: {
      name: piano.name, score_instrument: 17,
      plugin_url: new URL("plugins/hlolli_wg_piano.wasm", baseUrl).href,
      profile: "generic_2018", sample_rate: 48000,
    },
    workflow: "Read workspace before edits; update_lilypond needs its revision. Render after changing notation, then play or export. The orchestra source below is the one used by Play; edit lpcs.orc in the UI. Source edits in folder mode stay unsaved until Save.",
    documentation_help: "Use search_documentation for local excerpts and official manual search queries, then read_documentation with the returned document id and line numbers. Built-in references match the shipped piano and LPCS revisions. Open manual URLs with your browser/search tool for full notation or opcode details. Upstream docs may describe features newer than this runtime.",
    playback_limits: "This editor consumes LPCS .sco and timeline output. Its published LPCS runtime does not include the newer direct JSON playback API. Strict LPCS rejects unsupported performance marks; consult its reference before adding pedal notation, hairpins, or ornaments. gkPedal in lpcs.orc controls this piano's pedal.",
    documents: documentationCatalog.map(doc => ({
      id: doc.id, title: doc.title, topics: doc.topics, source_url: doc.url,
      local_url: doc.path ? new URL(doc.path, baseUrl).href : null,
      available_in_tab: doc.path !== null,
    })),
  };
}

export class EditorDocumentation {
  private readonly cache = new Map<string, Promise<string[]>>();
  constructor(private readonly baseUrl: string, private readonly fetchText = async (url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load documentation (HTTP ${response.status})`);
    return response.text();
  }) {}

  private lines(id: string) {
    const doc = documentationCatalog.find(doc => doc.id === id);
    if (!doc) throw new WebMcpActionError("unknown_document", `Unknown document: ${id}`);
    if (!doc.path) return null;
    let pending = this.cache.get(id);
    if (!pending) {
      pending = this.fetchText(new URL(doc.path, this.baseUrl).href).then(text => text.split(/\r?\n/));
      this.cache.set(id, pending);
      pending.catch(() => this.cache.delete(id));
    }
    return pending;
  }

  async read(id: string, startLine = 1, lineCount = 80) {
    const doc = documentationCatalog.find(doc => doc.id === id);
    const pending = this.lines(id);
    if (!doc) throw new WebMcpActionError("unknown_document", `Unknown document: ${id}`);
    if (!pending) return { document_id: id, source_url: doc.url, available_in_tab: false, guidance: "Open this official manual URL with your browser tool." };
    const lines = await pending;
    const end = Math.min(lines.length, startLine - 1 + lineCount);
    return {
      document_id: id, title: doc.title, source_url: doc.url,
      start_line: startLine, total_lines: lines.length,
      text: lines.slice(startLine - 1, end).join("\n"),
      next_line: end < lines.length ? end + 1 : null,
    };
  }

  async search(query: string, limit = 8) {
    const terms = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
    const matches: Array<{ document_id: string; title: string; source_url: string; start_line: number; excerpt: string; score: number }> = [];
    const unavailable: string[] = [];
    await Promise.all(documentationCatalog.filter(doc => doc.path).map(async doc => {
      try {
        const lines = (await this.lines(doc.id))!;
        for (let start = 0; start < lines.length; start += 6) {
          const excerpt = lines.slice(start, start + 12).join("\n");
          const lower = excerpt.toLowerCase();
          const score = terms.filter(term => lower.includes(term)).length;
          if (score) matches.push({ document_id: doc.id, title: doc.title, source_url: doc.url, start_line: start + 1, excerpt, score });
        }
      } catch { unavailable.push(doc.id); }
    }));
    matches.sort((a, b) => b.score - a.score || a.document_id.localeCompare(b.document_id) || a.start_line - b.start_line);
    return {
      query, matches: matches.slice(0, limit), unavailable_documents: unavailable.sort(),
      external_searches: [
        { url: "https://lilypond.org/doc/v2.27/Documentation/notation/index.html", query: `site:lilypond.org/doc/v2.27/Documentation ${query}` },
        { url: "https://csound.com/docs/manual/index.html", query: `site:csound.com/docs/manual ${query}` },
        { url: piano.repository, query: `repo:hlolli/hlolli_wg_piano ${query}` },
      ],
    };
  }
}
