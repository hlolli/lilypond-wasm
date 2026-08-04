import { describe, expect, test } from "bun:test";
import {
  registerWebMcpTools,
  WebMcpActionError,
  type ModelContextLike,
  type WebMcpEditorApi,
} from "./webmcp";

interface CapturedTool {
  name: string;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown) => Promise<Record<string, unknown>>;
}

interface FakeApiCapture {
  api: WebMcpEditorApi;
  playPositions: number[];
  seekPositions: number[];
  readCount: () => number;
}

function fakeApi(): FakeApiCapture {
  const workspace = {
    source: "\\version \"2.24.0\"\n{ c'4 }",
    revision: 4,
    render_state: "ready",
    playback_state: "idle",
  };
  const playPositions: number[] = [];
  const seekPositions: number[] = [];
  let reads = 0;

  const api: WebMcpEditorApi = {
    readWorkspace: () => {
      reads += 1;
      return { ...workspace };
    },
    updateLilypond: (source, baseRevision) => {
      if (baseRevision !== workspace.revision) {
        throw new WebMcpActionError(
          "revision_conflict",
          `Workspace is now at revision ${workspace.revision}`,
        );
      }
      workspace.source = source;
      workspace.revision += 1;
      return {
        updated: true,
        source: workspace.source,
        revision: workspace.revision,
      };
    },
    renderScore: async () => ({ rendered: true, svg_pages: 1 }),
    cancelRender: () => ({ cancelled: true }),
    exportSvg: () => ({ exported: true, file_names: ["score.svg"] }),
    exportPdf: async () => ({ exported: true, file_name: "score.pdf" }),
    playScore: async (positionSeconds) => {
      playPositions.push(positionSeconds);
      return { playing: true, position_seconds: positionSeconds };
    },
    resumePlayback: async () => ({ resumed: true }),
    pausePlayback: () => ({ paused: true }),
    stopPlayback: () => ({ stopped: true, position_seconds: 0 }),
    seekPlayback: (positionSeconds) => {
      seekPositions.push(positionSeconds);
      return { seeked: true, position_seconds: positionSeconds };
    },
  };

  return {
    api,
    playPositions,
    seekPositions,
    readCount: () => reads,
  };
}

function fakeContext() {
  const tools: CapturedTool[] = [];
  const signals: AbortSignal[] = [];
  const context: ModelContextLike = {
    registerTool: (tool, options) => {
      tools.push(tool);
      if (options?.signal) {
        signals.push(options.signal);
      }
    },
  };
  return { context, tools, signals };
}

function toolNamed(tools: CapturedTool[], name: string): CapturedTool {
  const tool = tools.find((item) => item.name === name);
  if (!tool) {
    throw new Error(`Missing captured tool: ${name}`);
  }
  return tool;
}

describe("WebMCP tools", () => {
  test("stays optional when the page has no WebMCP API", async () => {
    const registration = await registerWebMcpTools(fakeApi().api, undefined);

    expect(registration.supported).toBeFalse();
    expect(registration.toolCount).toBe(0);
    expect(registration.dispose()).toBeUndefined();
  });

  test("registers every editor action in order with one disposable signal", async () => {
    const capture = fakeContext();
    const registration = await registerWebMcpTools(
      fakeApi().api,
      capture.context,
    );

    expect(capture.tools.map((tool) => tool.name)).toEqual([
      "read_workspace",
      "update_lilypond",
      "render_score",
      "cancel_render",
      "export_svg",
      "export_pdf",
      "play_score",
      "resume_playback",
      "pause_playback",
      "stop_playback",
      "seek_playback",
    ]);
    expect(registration).toMatchObject({ supported: true, toolCount: 11 });
    expect(capture.signals).toHaveLength(11);
    expect(new Set(capture.signals).size).toBe(1);
    expect(capture.signals.every((signal) => !signal.aborted)).toBeTrue();

    registration.dispose();
    expect(capture.signals.every((signal) => signal.aborted)).toBeTrue();
  });

  test("publishes strict JSON schemas for source updates and playback positions", async () => {
    const capture = fakeContext();
    await registerWebMcpTools(fakeApi().api, capture.context);

    expect(toolNamed(capture.tools, "update_lilypond").inputSchema).toMatchObject({
      type: "object",
      properties: {
        source: { type: "string", maxLength: 1_048_576 },
        base_revision: { type: "integer", minimum: 0 },
      },
      required: ["source", "base_revision"],
      additionalProperties: false,
    });
    expect(toolNamed(capture.tools, "play_score").inputSchema).toMatchObject({
      type: "object",
      properties: {
        position_seconds: { type: "number", minimum: 0 },
      },
      additionalProperties: false,
    });
    expect(toolNamed(capture.tools, "seek_playback").inputSchema).toMatchObject({
      type: "object",
      required: ["position_seconds"],
      additionalProperties: false,
    });
  });

  test("reads the current workspace as a structured result", async () => {
    const source = fakeApi();
    const capture = fakeContext();
    await registerWebMcpTools(source.api, capture.context);

    const result = await toolNamed(capture.tools, "read_workspace").execute({});

    expect(result).toMatchObject({
      ok: true,
      action: "read_workspace",
      source: "\\version \"2.24.0\"\n{ c'4 }",
      revision: 4,
      render_state: "ready",
      playback_state: "idle",
    });
  });

  test("rejects fields on a no-input tool before calling the editor", async () => {
    const source = fakeApi();
    const capture = fakeContext();
    await registerWebMcpTools(source.api, capture.context);

    const result = await toolNamed(capture.tools, "read_workspace").execute({
      extra: true,
    });

    expect(result).toMatchObject({
      ok: false,
      action: "read_workspace",
      error: { code: "invalid_input" },
    });
    expect(source.readCount()).toBe(0);
  });

  test("updates LilyPond only from the current revision", async () => {
    const source = fakeApi();
    const capture = fakeContext();
    await registerWebMcpTools(source.api, capture.context);
    const update = toolNamed(capture.tools, "update_lilypond");

    const updated = await update.execute({
      base_revision: 4,
      source: "{ d'1 }",
    });
    expect(updated).toMatchObject({
      ok: true,
      action: "update_lilypond",
      updated: true,
      source: "{ d'1 }",
      revision: 5,
    });

    const stale = await update.execute({
      base_revision: 4,
      source: "{ e'1 }",
    });
    expect(stale).toMatchObject({
      ok: false,
      action: "update_lilypond",
      error: { code: "revision_conflict" },
    });
  });

  test("rejects malformed and oversized LilyPond updates", async () => {
    const capture = fakeContext();
    await registerWebMcpTools(fakeApi().api, capture.context);
    const update = toolNamed(capture.tools, "update_lilypond");

    const malformed = await update.execute({
      base_revision: 4,
      source: "{ c'4 }",
      file_name: "other.ly",
    });
    const missingSource = await update.execute({ base_revision: 4 });
    const oversized = await update.execute({
      base_revision: 4,
      source: "x".repeat(1_048_577),
    });

    expect(malformed).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(missingSource).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(oversized).toMatchObject({
      ok: false,
      error: { code: "input_too_large" },
    });
  });

  test("plays from zero by default and accepts an explicit start position", async () => {
    const source = fakeApi();
    const capture = fakeContext();
    await registerWebMcpTools(source.api, capture.context);
    const play = toolNamed(capture.tools, "play_score");

    const fromStart = await play.execute({});
    const fromSeek = await play.execute({ position_seconds: 12.5 });

    expect(source.playPositions).toEqual([0, 12.5]);
    expect(fromStart).toMatchObject({
      ok: true,
      playing: true,
      position_seconds: 0,
    });
    expect(fromSeek).toMatchObject({
      ok: true,
      playing: true,
      position_seconds: 12.5,
    });
  });

  test("requires a finite, non-negative seek position", async () => {
    const source = fakeApi();
    const capture = fakeContext();
    await registerWebMcpTools(source.api, capture.context);
    const seek = toolNamed(capture.tools, "seek_playback");

    const missing = await seek.execute({});
    const negative = await seek.execute({ position_seconds: -1 });
    const infinite = await seek.execute({ position_seconds: Infinity });
    const extra = await seek.execute({ position_seconds: 1, extra: true });

    for (const result of [missing, negative, infinite, extra]) {
      expect(result).toMatchObject({
        ok: false,
        action: "seek_playback",
        error: { code: "invalid_input" },
      });
    }
    expect(source.seekPositions).toEqual([]);
  });

  test("turns a false action flag into a failure and keeps its reason", async () => {
    const source = fakeApi();
    source.api.renderScore = async () => ({
      rendered: false,
      reason: "no_score_output",
      ok: true,
      action: "wrong_action",
      error: { code: "wrong_error" },
    });
    const capture = fakeContext();
    await registerWebMcpTools(source.api, capture.context);

    const result = await toolNamed(capture.tools, "render_score").execute({});

    expect(result).toMatchObject({
      ok: false,
      action: "render_score",
      rendered: false,
      reason: "no_score_output",
      error: { code: "no_score_output" },
    });
  });

  test("rolls back all registrations when one registration fails", async () => {
    const names: string[] = [];
    const signals: AbortSignal[] = [];
    const context: ModelContextLike = {
      registerTool: (tool, options) => {
        names.push(tool.name);
        if (options?.signal) {
          signals.push(options.signal);
        }
        if (tool.name === "render_score") {
          throw new Error("browser rejected render_score");
        }
      },
    };

    let caught: unknown;
    try {
      await registerWebMcpTools(fakeApi().api, context);
    } catch (error) {
      caught = error;
    }

    expect(names).toEqual([
      "read_workspace",
      "update_lilypond",
      "render_score",
    ]);
    expect(caught).toBeInstanceOf(WebMcpActionError);
    expect(caught).toMatchObject({
      code: "registration_failed",
      message:
        "WebMCP tools could not be registered: browser rejected render_score",
    });
    expect(new Set(signals).size).toBe(1);
    expect(signals.every((signal) => signal.aborted)).toBeTrue();
  });

  test("returns generic thrown errors as action_failed", async () => {
    const source = fakeApi();
    source.api.exportPdf = async () => {
      throw new Error("PDF writer failed");
    };
    const capture = fakeContext();
    await registerWebMcpTools(source.api, capture.context);

    const result = await toolNamed(capture.tools, "export_pdf").execute({});

    expect(result).toEqual({
      ok: false,
      action: "export_pdf",
      error: {
        code: "action_failed",
        message: "PDF writer failed",
      },
    });
  });

  test("reports a browser AbortError as stopped", async () => {
    const source = fakeApi();
    source.api.renderScore = async () => {
      throw new DOMException("Render cancelled", "AbortError");
    };
    const capture = fakeContext();
    await registerWebMcpTools(source.api, capture.context);

    const result = await toolNamed(capture.tools, "render_score").execute({});

    expect(result).toEqual({
      ok: false,
      action: "render_score",
      error: {
        code: "stopped",
        message: "Render cancelled",
      },
    });
  });
});
