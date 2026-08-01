import type { CsoundObj } from "@csound/browser";
import {
  createPreloadedCsound,
  type CsoundCreateOptions,
  type CsoundFactory,
} from "./csound-module";
import { createPlaybackCsd, PLAYBACK_WAV_FILE } from "./playback-csd";

export type { CsoundCreateOptions } from "./csound-module";

export type RenderScoreOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  onMessage?: (message: string) => void;
  createCsound?: CsoundFactory;
};

const defaultTimeoutMs = 5 * 60 * 1000;
const cleanupTimeoutMs = 5_000;

function abortReason(signal: AbortSignal) {
  if (signal.reason instanceof Error) {
    return signal.reason;
  }
  return new DOMException("Csound rendering was cancelled.", "AbortError");
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw abortReason(signal);
  }
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  throwIfAborted(signal);

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      reject(abortReason(signal));
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

async function settleWithTimeout(promise: Promise<unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, cleanupTimeoutMs);
      }),
    ]);
  } catch {
    // Cleanup must not replace the render result or the original error.
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function assertWaveFile(bytes: Uint8Array) {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));

  if (
    bytes.byteLength < 44 ||
    ascii(0, 4) !== "RIFF" ||
    ascii(8, 4) !== "WAVE"
  ) {
    throw new Error("Csound returned an unreadable WAV file.");
  }
}

export async function renderScoreToWav(
  score: string,
  options: RenderScoreOptions = {},
) {
  const csd = createPlaybackCsd(score);
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive, finite number.");
  }

  const operation = new AbortController();
  const handleCallerAbort = () => {
    operation.abort(
      options.signal?.reason ??
        new DOMException("Csound rendering was cancelled.", "AbortError"),
    );
  };
  options.signal?.addEventListener("abort", handleCallerAbort, { once: true });
  if (options.signal?.aborted) {
    handleCallerAbort();
  }

  const timeout = setTimeout(() => {
    operation.abort(
      new DOMException(
        `Csound rendering exceeded ${Math.round(timeoutMs / 1000)} seconds.`,
        "TimeoutError",
      ),
    );
  }, timeoutMs);

  const factory = options.createCsound ?? createPreloadedCsound;
  let csound: CsoundObj | undefined;
  let renderEnded = false;
  let resetDone = false;
  let resetPromise: Promise<number> | null = null;
  let onRenderEnded: (() => void) | undefined;
  let onRealtimeEnded: (() => void) | undefined;
  let onMessage: ((message: unknown) => void) | undefined;

  try {
    const pendingCsound = Promise.resolve().then(() =>
      factory({
        autoConnect: false,
        useWorker: true,
        useSAB: false,
      }),
    );
    pendingCsound.then((lateCsound) => {
      if (!csound && operation.signal.aborted && lateCsound) {
        void settleWithTimeout(lateCsound.terminateInstance());
      }
    }).catch(() => {});

    csound = await raceWithAbort(pendingCsound, operation.signal);
    if (!csound) {
      throw new Error("Csound could not start in this browser.");
    }

    csound.off("message", console.log);
    if (options.onMessage) {
      onMessage = (message) => options.onMessage?.(String(message));
      csound.on("message", onMessage);
    }

    let resolveRender: (() => void) | undefined;
    let rejectRender: ((error: Error) => void) | undefined;
    const rendered = new Promise<void>((resolve, reject) => {
      resolveRender = resolve;
      rejectRender = reject;
    });
    onRenderEnded = () => {
      renderEnded = true;
      resolveRender?.();
    };
    onRealtimeEnded = () => {
      rejectRender?.(
        new Error("Csound used real-time output instead of writing a WAV file."),
      );
    };
    csound.on("renderEnded", onRenderEnded);
    csound.on("realtimePerformanceEnded", onRealtimeEnded);

    const resetOnce = () => {
      resetPromise ??= Promise.resolve().then(() => csound?.reset() ?? -1);
      resetPromise.then((result) => {
        if (result === 0) {
          resetDone = true;
        }
      }).catch(() => {});
      return resetPromise;
    };

    const compileResult = await raceWithAbort(
      csound.compileCSD(csd),
      operation.signal,
    );
    if (compileResult !== 0) {
      throw new Error(`Csound could not compile the score (code ${compileResult}).`);
    }

    const startResult = await raceWithAbort(
      csound.start(),
      operation.signal,
    );
    if (startResult !== 0) {
      throw new Error(`Csound could not render the score (code ${startResult}).`);
    }

    await raceWithAbort(rendered, operation.signal);
    const resetResult = await raceWithAbort(
      resetOnce(),
      operation.signal,
    );
    if (resetResult !== 0) {
      throw new Error(`Csound could not finalize the WAV file (code ${resetResult}).`);
    }
    const bytes = await raceWithAbort(
      csound.fs.readFile(PLAYBACK_WAV_FILE),
      operation.signal,
    );
    assertWaveFile(bytes);
    return bytes.slice();
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", handleCallerAbort);

    if (csound) {
      if (onRenderEnded) {
        csound.off("renderEnded", onRenderEnded);
      }
      if (onRealtimeEnded) {
        csound.off("realtimePerformanceEnded", onRealtimeEnded);
      }
      if (onMessage) {
        csound.off("message", onMessage);
      }
      if (!renderEnded) {
        await settleWithTimeout(csound.stop());
      }
      if (renderEnded && !resetDone) {
        resetPromise ??= Promise.resolve().then(() => csound?.reset() ?? -1);
        await settleWithTimeout(resetPromise);
      }
      await settleWithTimeout(csound.terminateInstance());
    }
  }
}
