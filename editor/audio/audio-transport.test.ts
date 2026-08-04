import { describe, expect, test } from "bun:test";
import {
  AudioTransport,
  type AudioTransportSnapshot,
} from "./audio-transport";

class FakeAudioElement extends EventTarget {
  preload = "";
  src = "";
  currentTime = 0;
  duration = 12;
  error: MediaError | null = null;
  paused = true;
  playCalls = 0;
  loadCalls = 0;
  playError: Error | null = null;

  load() {
    this.loadCalls += 1;
  }

  async play() {
    this.playCalls += 1;
    if (this.playError) {
      throw this.playError;
    }
    this.paused = false;
    this.dispatchEvent(new Event("play"));
  }

  pause() {
    if (this.paused) {
      return;
    }
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }

  removeAttribute(name: string) {
    if (name === "src") {
      this.src = "";
    }
  }

  asAudioElement() {
    return this as unknown as HTMLAudioElement;
  }
}

describe("AudioTransport", () => {
  test("loads without autoplay and exposes play, pause, stop, and seek", async () => {
    const audio = new FakeAudioElement();
    const snapshots: AudioTransportSnapshot[] = [];
    const transport = new AudioTransport(audio.asAudioElement(), {
      onChange: (snapshot) => snapshots.push(snapshot),
    });

    transport.loadWav(new Uint8Array([1, 2, 3]));
    expect(transport.snapshot.state).toBe("ready");
    expect(audio.playCalls).toBe(0);
    expect(audio.src).toStartWith("blob:");

    await transport.play();
    expect(transport.snapshot.state).toBe("playing");

    transport.seek(99);
    expect(audio.currentTime).toBe(12);

    transport.pause();
    expect(transport.snapshot.state).toBe("paused");

    transport.stop();
    expect(transport.snapshot).toEqual({
      state: "ready",
      currentTime: 0,
      duration: 12,
    });
    expect(snapshots.at(-1)?.state).toBe("ready");

    transport.dispose();
    expect(transport.snapshot.state).toBe("empty");
    expect(audio.src).toBe("");
  });

  test("restarts from zero after playback ends", async () => {
    const audio = new FakeAudioElement();
    const transport = new AudioTransport(audio.asAudioElement());
    transport.loadWav(new Uint8Array([1]));
    audio.currentTime = audio.duration;
    audio.dispatchEvent(new Event("ended"));

    expect(transport.snapshot.state).toBe("ended");
    await transport.play();
    expect(audio.currentTime).toBe(0);
    expect(transport.snapshot.state).toBe("playing");
  });

  test("plays from a seek position after playback ends", async () => {
    const audio = new FakeAudioElement();
    const transport = new AudioTransport(audio.asAudioElement());
    transport.loadWav(new Uint8Array([1]));
    audio.currentTime = audio.duration;
    audio.dispatchEvent(new Event("ended"));

    transport.seek(4.25);
    expect(transport.snapshot).toEqual({
      state: "paused",
      currentTime: 4.25,
      duration: 12,
    });

    await transport.play();
    expect(audio.currentTime).toBe(4.25);
    expect(transport.snapshot.state).toBe("playing");
  });

  test("waits for media metadata before a positioned seek", async () => {
    const audio = new FakeAudioElement();
    audio.duration = Number.NaN;
    const transport = new AudioTransport(audio.asAudioElement());
    transport.loadWav(new Uint8Array([1]));

    const seekable = transport.waitUntilSeekable(100);
    audio.duration = 9;
    audio.dispatchEvent(new Event("loadedmetadata"));

    await expect(seekable).resolves.toMatchObject({ duration: 9 });
    transport.seek(4.25);
    expect(audio.currentTime).toBe(4.25);
  });

  test("reports a rejected play request", async () => {
    const audio = new FakeAudioElement();
    const errors: Error[] = [];
    const transport = new AudioTransport(audio.asAudioElement(), {
      onError: (error) => errors.push(error),
    });
    transport.loadWav(new Uint8Array([1]));
    audio.playError = new Error("play blocked");

    await expect(transport.play()).rejects.toThrow("play blocked");
    expect(errors.map((error) => error.message)).toEqual(["play blocked"]);
    expect(transport.snapshot.state).toBe("ready");
  });

  test("leaves the playing state when the media element reports an error", async () => {
    const audio = new FakeAudioElement();
    const errors: Error[] = [];
    const transport = new AudioTransport(audio.asAudioElement(), {
      onError: (error) => errors.push(error),
    });
    transport.loadWav(new Uint8Array([1]));
    await transport.play();

    audio.dispatchEvent(new Event("error"));

    expect(transport.snapshot.state).toBe("ready");
    expect(errors.map((error) => error.message)).toEqual([
      "The rendered WAV file could not be played.",
    ]);
  });
});
