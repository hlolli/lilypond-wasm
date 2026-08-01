import { describe, expect, test } from "bun:test";
import {
  PlaybackFrameLoop,
  ScorePlayhead,
  translateFrameRectangle,
  type AnimationFrameScheduler,
} from "./score-playhead";

class FakeFrameScheduler implements AnimationFrameScheduler {
  nextHandle = 1;
  callbacks = new Map<number, FrameRequestCallback>();
  cancelled: number[] = [];

  request(callback: FrameRequestCallback) {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number) {
    this.cancelled.push(handle);
    this.callbacks.delete(handle);
  }

  runNext() {
    const entry = this.callbacks.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    if (!entry) {
      throw new Error("No animation frame is pending.");
    }
    const [handle, callback] = entry;
    this.callbacks.delete(handle);
    callback(0);
  }
}

describe("PlaybackFrameLoop", () => {
  test("samples once per animation frame and does not start twice", () => {
    const scheduler = new FakeFrameScheduler();
    let currentTime = 0;
    const samples: number[] = [];
    const loop = new PlaybackFrameLoop(
      () => currentTime,
      (value) => samples.push(value),
      scheduler,
    );

    loop.start();
    loop.start();
    expect(samples).toEqual([0]);
    expect(scheduler.callbacks.size).toBe(1);

    currentTime = 0.25;
    scheduler.runNext();
    expect(samples).toEqual([0, 0.25]);
    expect(scheduler.callbacks.size).toBe(1);

    loop.stop();
    expect(scheduler.callbacks.size).toBe(0);
    expect(scheduler.cancelled).toHaveLength(1);
  });

  test("can sample a seek while the animation loop is stopped", () => {
    const scheduler = new FakeFrameScheduler();
    let currentTime = 3;
    const samples: number[] = [];
    const loop = new PlaybackFrameLoop(
      () => currentTime,
      (value) => samples.push(value),
      scheduler,
    );

    loop.sample();
    currentTime = 7;
    loop.sample();

    expect(samples).toEqual([3, 7]);
    expect(scheduler.callbacks.size).toBe(0);
  });
});

test("translates SVG element bounds out of an iframe viewport", () => {
  const translated = translateFrameRectangle(
    { top: 20, right: 80, bottom: 40, left: 60, width: 20, height: 20 },
    { top: 100, right: 500, bottom: 700, left: 200, width: 300, height: 600 },
  );

  expect(translated).toEqual({
    top: 120,
    right: 280,
    bottom: 140,
    left: 260,
    width: 20,
    height: 20,
  });
});

test("runs frames only while transport playback is active", () => {
  const scheduler = new FakeFrameScheduler();
  const audio = { currentTime: 1, duration: 8 } as HTMLAudioElement;
  const playhead = new ScorePlayhead(audio, scheduler);

  playhead.sync({ state: "playing", currentTime: 1, duration: 8 });
  expect(scheduler.callbacks.size).toBe(1);

  playhead.sync({ state: "paused", currentTime: 2, duration: 8 });
  expect(scheduler.callbacks.size).toBe(0);

  playhead.sync({ state: "playing", currentTime: 2, duration: 8 });
  expect(scheduler.callbacks.size).toBe(1);
  playhead.reset();
  expect(scheduler.callbacks.size).toBe(0);
});
