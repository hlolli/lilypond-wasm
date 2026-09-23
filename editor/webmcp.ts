type ToolInput = Record<string, unknown>;
type ToolOutput = Record<string, unknown>;

interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  execute: (input: unknown) => Promise<ToolOutput>;
}

export interface ModelContextLike {
  registerTool: (
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
}

export interface WebMcpEditorApi {
  readWorkspace: () => ToolOutput | Promise<ToolOutput>;
  searchDocumentation: (query: string, limit: number) => Promise<ToolOutput>;
  readDocumentation: (id: string, startLine: number, lineCount: number) => Promise<ToolOutput>;
  updateLilypond: (source: string, baseRevision: number) => ToolOutput;
  renderScore: () => Promise<ToolOutput>;
  cancelRender: () => ToolOutput;
  exportSvg: () => Promise<ToolOutput> | ToolOutput;
  exportPdf: () => Promise<ToolOutput>;
  playScore: (positionSeconds: number) => Promise<ToolOutput>;
  resumePlayback: () => Promise<ToolOutput>;
  pausePlayback: () => ToolOutput;
  stopPlayback: () => ToolOutput;
  seekPlayback: (positionSeconds: number) => Promise<ToolOutput> | ToolOutput;
}

export interface WebMcpRegistration {
  supported: boolean;
  toolCount: number;
  dispose: () => void;
}

export class WebMcpActionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WebMcpActionError";
    this.code = code;
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function errorCode(error: unknown): string {
  if (error instanceof WebMcpActionError) {
    return error.code;
  }
  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "AbortError"
  ) {
    return "stopped";
  }
  return "action_failed";
}

function asInput(value: unknown): ToolInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WebMcpActionError("invalid_input", "Tool input must be an object");
  }
  return value as ToolInput;
}

function emptyInput(value: unknown): ToolInput {
  const input = asInput(value);
  if (Object.keys(input).length > 0) {
    throw new WebMcpActionError("invalid_input", "This tool takes no input");
  }
  return input;
}

function lilypondUpdate(value: unknown): {
  source: string;
  baseRevision: number;
} {
  const input = asInput(value);
  const allowed = new Set(["source", "base_revision"]);
  const extra = Object.keys(input).find((key) => !allowed.has(key));
  if (extra) {
    throw new WebMcpActionError(
      "invalid_input",
      `Unknown LilyPond update field: ${extra}`,
    );
  }

  const revision = input.base_revision;
  if (!Number.isInteger(revision) || Number(revision) < 0) {
    throw new WebMcpActionError(
      "invalid_input",
      "base_revision must be a whole number at or after 0",
    );
  }

  const source = input.source;
  if (typeof source !== "string") {
    throw new WebMcpActionError("invalid_input", "source must be text");
  }
  if (source.length > 1_048_576) {
    throw new WebMcpActionError(
      "input_too_large",
      "source is longer than 1048576 characters",
    );
  }

  return {
    source,
    baseRevision: Number(revision),
  };
}

function playbackPosition(
  value: unknown,
  required: boolean,
): { positionSeconds: number } {
  const input = asInput(value);
  const allowed = new Set(["position_seconds"]);
  const extra = Object.keys(input).find((key) => !allowed.has(key));
  if (extra) {
    throw new WebMcpActionError(
      "invalid_input",
      `Unknown playback field: ${extra}`,
    );
  }

  const position = input.position_seconds;
  if (position === undefined && !required) {
    return { positionSeconds: 0 };
  }
  if (
    typeof position !== "number" ||
    !Number.isFinite(position) ||
    position < 0
  ) {
    throw new WebMcpActionError(
      "invalid_input",
      "position_seconds must be a finite number at or after 0",
    );
  }

  return { positionSeconds: position };
}

const resultFlags = [
  "updated",
  "rendered",
  "cancelled",
  "exported",
  "playing",
  "resumed",
  "paused",
  "stopped",
  "seeked",
] as const;

function resultObject(
  name: string,
  callback: (input: ToolInput) => ToolOutput | Promise<ToolOutput>,
  parse: (value: unknown) => ToolInput = asInput,
): (input: unknown) => Promise<ToolOutput> {
  return async (value) => {
    try {
      const output = await callback(parse(value));
      const failed = resultFlags.some(
        (field) => field in output && output[field] === false,
      );
      if (failed) {
        const reason =
          typeof output.reason === "string" ? output.reason : "action_failed";
        return {
          ...output,
          ok: false,
          action: name,
          error: {
            code: reason,
            message: `The ${name} action did not finish: ${reason.replaceAll("_", " ")}`,
          },
        };
      }

      return {
        ...output,
        ok: true,
        action: name,
      };
    } catch (error) {
      return {
        ok: false,
        action: name,
        error: {
          code: errorCode(error),
          message: errorText(error),
        },
      };
    }
  };
}

const noInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

const positionProperty = {
  type: "number",
  minimum: 0,
  description: "Playback position in seconds",
};

function documentInput(input: ToolInput, allowed: string[]) {
  if (Object.keys(input).some(key => !allowed.includes(key))) {
    throw new WebMcpActionError("invalid_input", "Unknown documentation field");
  }
}

function documentText(value: unknown, name: string, maximum: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new WebMcpActionError("invalid_input", `${name} must contain 1 to ${maximum} characters`);
  }
  return value.trim();
}

function documentInteger(value: unknown, name: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new WebMcpActionError("invalid_input", `${name} must be a whole number from 1 to ${maximum}`);
  }
  return value;
}

function createTools(api: WebMcpEditorApi): WebMcpTool[] {
  return [
    {
      name: "read_workspace",
      description:
        "Read the LilyPond source, current Csound orchestra, revision, render and playback state, runtime versions, default piano, and documentation index. Call this before edits. Use search_documentation and read_documentation for piano controls, LPCS export rules, notation help, and Csound opcode references.",
      inputSchema: noInputSchema,
      annotations: {
        readOnlyHint: true,
        untrustedContentHint: true,
      },
      execute: resultObject(
        "read_workspace",
        () => api.readWorkspace(),
        emptyInput,
      ),
    },
    {
      name: "search_documentation",
      description: "Search the bundled editor, hlolli_wg_piano, LilyPond-to-Csound (LPCS), timeline, MusicXML, and Csound opcode references. Returns excerpts with document ids and line numbers plus queries and URLs for the official LilyPond and Csound manuals. Use exact terms such as csoundExportOptions, pedal, or linsegr.",
      inputSchema: {
        type: "object", properties: {
          query: { type: "string", minLength: 1, maxLength: 200 },
          limit: { type: "integer", minimum: 1, maximum: 20, default: 8 },
        }, required: ["query"], additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: resultObject("search_documentation", input => {
        documentInput(input, ["query", "limit"]);
        return api.searchDocumentation(documentText(input.query, "query", 200), documentInteger(input.limit, "limit", 8, 20));
      }),
    },
    {
      name: "read_documentation",
      description: "Read a bundled reference by document_id from read_workspace or search_documentation. Use start_line and line_count to read further. For online-only manuals, returns the official URL to open with your browser tool.",
      inputSchema: {
        type: "object", properties: {
          document_id: { type: "string", minLength: 1, maxLength: 80 },
          start_line: { type: "integer", minimum: 1, default: 1 },
          line_count: { type: "integer", minimum: 1, maximum: 160, default: 80 },
        }, required: ["document_id"], additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: resultObject("read_documentation", input => {
        documentInput(input, ["document_id", "start_line", "line_count"]);
        return api.readDocumentation(documentText(input.document_id, "document_id", 80), documentInteger(input.start_line, "start_line", 1), documentInteger(input.line_count, "line_count", 80, 160));
      }),
    },
    {
      name: "update_lilypond",
      description:
        "Replace the full LilyPond source. Read the workspace first and pass its revision as base_revision. A stale revision is rejected so an edit is not lost.",
      inputSchema: {
        type: "object",
        properties: {
          source: {
            type: "string",
            maxLength: 1_048_576,
            description: "Full LilyPond source text",
          },
          base_revision: {
            type: "integer",
            minimum: 0,
            description: "Revision returned by read_workspace",
          },
        },
        required: ["source", "base_revision"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: true,
      },
      execute: resultObject("update_lilypond", (input) => {
        const update = lilypondUpdate(input);
        return api.updateLilypond(update.source, update.baseRevision);
      }),
    },
    {
      name: "render_score",
      description:
        "Render the current LilyPond source and update the score preview. Return when the render finishes or fails.",
      inputSchema: noInputSchema,
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: true,
      },
      execute: resultObject("render_score", () => api.renderScore(), emptyInput),
    },
    {
      name: "cancel_render",
      description: "Cancel the active LilyPond render, if one is running.",
      inputSchema: noInputSchema,
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: false,
      },
      execute: resultObject("cancel_render", () => api.cancelRender(), emptyInput),
    },
    {
      name: "export_svg",
      description:
        "Export the current vector score as SVG files. Render the score first if the source has changed.",
      inputSchema: noInputSchema,
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: true,
      },
      execute: resultObject("export_svg", () => api.exportSvg(), emptyInput),
    },
    {
      name: "export_pdf",
      description:
        "Export the current vector score as a PDF file. Render the score first if the source has changed.",
      inputSchema: noInputSchema,
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: true,
      },
      execute: resultObject("export_pdf", () => api.exportPdf(), emptyInput),
    },
    {
      name: "play_score",
      description:
        "Prepare score audio and start playback. Omit position_seconds to play from the beginning, or pass a seek position in seconds.",
      inputSchema: {
        type: "object",
        properties: {
          position_seconds: positionProperty,
        },
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: true,
      },
      execute: resultObject("play_score", (input) => {
        const { positionSeconds } = playbackPosition(input, false);
        return api.playScore(positionSeconds);
      }),
    },
    {
      name: "resume_playback",
      description: "Resume paused score playback from its current position.",
      inputSchema: noInputSchema,
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: false,
      },
      execute: resultObject(
        "resume_playback",
        () => api.resumePlayback(),
        emptyInput,
      ),
    },
    {
      name: "pause_playback",
      description: "Pause score playback at its current position.",
      inputSchema: noInputSchema,
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: false,
      },
      execute: resultObject(
        "pause_playback",
        () => api.pausePlayback(),
        emptyInput,
      ),
    },
    {
      name: "stop_playback",
      description: "Stop score playback and return its position to the beginning.",
      inputSchema: noInputSchema,
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: false,
      },
      execute: resultObject(
        "stop_playback",
        () => api.stopPlayback(),
        emptyInput,
      ),
    },
    {
      name: "seek_playback",
      description:
        "Move score playback to position_seconds without changing whether it is playing or paused.",
      inputSchema: {
        type: "object",
        properties: {
          position_seconds: positionProperty,
        },
        required: ["position_seconds"],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: false,
        untrustedContentHint: false,
      },
      execute: resultObject("seek_playback", (input) => {
        const { positionSeconds } = playbackPosition(input, true);
        return api.seekPlayback(positionSeconds);
      }),
    },
  ];
}

function pageModelContext(): ModelContextLike | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  return (document as Document & { modelContext?: ModelContextLike })
    .modelContext;
}

export async function registerWebMcpTools(
  api: WebMcpEditorApi,
  modelContext: ModelContextLike | undefined = pageModelContext(),
): Promise<WebMcpRegistration> {
  if (!modelContext) {
    return {
      supported: false,
      toolCount: 0,
      dispose: () => undefined,
    };
  }

  const controller = new AbortController();
  const tools = createTools(api);

  try {
    for (const tool of tools) {
      await modelContext.registerTool(tool, { signal: controller.signal });
    }
  } catch (error) {
    controller.abort();
    throw new WebMcpActionError(
      "registration_failed",
      `WebMCP tools could not be registered: ${errorText(error)}`,
    );
  }

  return {
    supported: true,
    toolCount: tools.length,
    dispose: () => controller.abort(),
  };
}
