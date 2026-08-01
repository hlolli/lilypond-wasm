import { describe, expect, test } from "bun:test";
import type { CsoundObj, PublicEvents } from "@csound/browser";
import {
  renderScoreToWav,
  type CsoundCreateOptions,
} from "./csound-renderer";
import { PLAYBACK_WAV_FILE } from "./playback-csd";

const score =
  "i 17.0001 0 1 1000 1 1 1 60 60 -1 0.7 0.7 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 \"id=1\"\ne";

function waveFile() {
  const bytes = new Uint8Array(44);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WAVE"), 8);
  return bytes;
}

class FakeCsound {
  readonly calls: string[] = [];
  readonly listeners = new Map<PublicEvents, Set<(...args: unknown[]) => void>>();
  readonly output = waveFile();
  compileResult = 0;
  startResult = 0;
  resetResult = 0;
  resetGate: Promise<void> | null = null;
  endRender = true;
  compiledCsd = "";

  fs = {
    readFile: async (path: string) => {
      this.calls.push(`read:${path}`);
      return this.output;
    },
  };

  on(event: PublicEvents, listener: (...args: unknown[]) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: PublicEvents, listener: (...args: unknown[]) => void) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: PublicEvents, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }

  async compileCSD(csd: string) {
    this.calls.push("compile");
    this.compiledCsd = csd;
    return this.compileResult;
  }

  async start() {
    this.calls.push("start");
    if (this.endRender && this.startResult === 0) {
      queueMicrotask(() => {
        this.emit("message", "rendering score");
        this.emit("renderEnded");
      });
    }
    return this.startResult;
  }

  async stop() {
    this.calls.push("stop");
  }

  async reset() {
    this.calls.push("reset");
    await this.resetGate;
    return this.resetResult;
  }

  async terminateInstance() {
    this.calls.push("terminate");
  }

  asCsound() {
    return this as unknown as CsoundObj;
  }
}

describe("renderScoreToWav", () => {
  test("uses the worker backend and returns a copied WAV file", async () => {
    const fake = new FakeCsound();
    const messages: string[] = [];
    let createOptions: CsoundCreateOptions | undefined;

    const result = await renderScoreToWav(score, {
      createCsound: async (options) => {
        createOptions = options;
        return fake.asCsound();
      },
      onMessage: (message) => messages.push(message),
    });

    expect(createOptions).toEqual({
      autoConnect: false,
      useWorker: true,
      useSAB: false,
    });
    expect(fake.compiledCsd).toContain("instr 17");
    expect(fake.calls).toEqual([
      "compile",
      "start",
      "reset",
      `read:${PLAYBACK_WAV_FILE}`,
      "terminate",
    ]);
    expect(messages).toEqual(["rendering score"]);
    expect(result).toEqual(fake.output);
    expect(result).not.toBe(fake.output);
  });

  test("stops and terminates Csound after cancellation", async () => {
    const fake = new FakeCsound();
    fake.endRender = false;
    const controller = new AbortController();
    const rendering = renderScoreToWav(score, {
      createCsound: async () => fake.asCsound(),
      signal: controller.signal,
    });

    while (!fake.calls.includes("start")) {
      await Promise.resolve();
    }
    controller.abort();

    await expect(rendering).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.calls).toContain("stop");
    expect(fake.calls.at(-1)).toBe("terminate");
  });

  test("times out a render that never ends", async () => {
    const fake = new FakeCsound();
    fake.endRender = false;

    await expect(
      renderScoreToWav(score, {
        createCsound: async () => fake.asCsound(),
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(fake.calls).toContain("stop");
    expect(fake.calls.at(-1)).toBe("terminate");
  });

  test("cleans up when compilation fails", async () => {
    const fake = new FakeCsound();
    fake.compileResult = -1;

    await expect(
      renderScoreToWav(score, {
        createCsound: async () => fake.asCsound(),
      }),
    ).rejects.toThrow("could not compile");
    expect(fake.calls).toEqual(["compile", "stop", "terminate"]);
  });

  test("does not start a second reset when cancellation wins during reset", async () => {
    const fake = new FakeCsound();
    const controller = new AbortController();
    let releaseReset: (() => void) | undefined;
    fake.resetGate = new Promise((resolve) => {
      releaseReset = resolve;
    });
    const rendering = renderScoreToWav(score, {
      createCsound: async () => fake.asCsound(),
      signal: controller.signal,
    });

    while (!fake.calls.includes("reset")) {
      await Promise.resolve();
    }
    controller.abort();
    releaseReset?.();

    await expect(rendering).rejects.toMatchObject({ name: "AbortError" });
    expect(fake.calls.filter((call) => call === "reset")).toHaveLength(1);
    expect(fake.calls.at(-1)).toBe("terminate");
  });

  test("cleans up the operation when a factory throws synchronously", async () => {
    const controller = new AbortController();

    await expect(
      renderScoreToWav(score, {
        createCsound: (() => {
          throw new Error("factory failed");
        }) as never,
        signal: controller.signal,
      }),
    ).rejects.toThrow("factory failed");

    controller.abort();
  });

  test("terminates an instance that arrives after cancellation", async () => {
    const fake = new FakeCsound();
    const controller = new AbortController();
    let resolveFactory: ((csound: CsoundObj) => void) | undefined;
    const rendering = renderScoreToWav(score, {
      createCsound: () =>
        new Promise((resolve) => {
          resolveFactory = resolve;
        }),
      signal: controller.signal,
    });

    controller.abort();
    await expect(rendering).rejects.toMatchObject({ name: "AbortError" });
    resolveFactory?.(fake.asCsound());
    await Promise.resolve();
    await Promise.resolve();

    expect(fake.calls).toEqual(["terminate"]);
  });
});
