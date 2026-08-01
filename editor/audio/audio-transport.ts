export type AudioTransportState =
  | "empty"
  | "ready"
  | "playing"
  | "paused"
  | "ended";

export type AudioTransportSnapshot = {
  state: AudioTransportState;
  currentTime: number;
  duration: number;
};

export type AudioTransportOptions = {
  onChange?: (snapshot: AudioTransportSnapshot) => void;
  onError?: (error: Error) => void;
};

export class AudioTransport {
  readonly audio: HTMLAudioElement;

  #state: AudioTransportState = "empty";
  #objectUrl: string | null = null;
  #options: AudioTransportOptions;
  #stopping = false;

  constructor(audio: HTMLAudioElement, options: AudioTransportOptions = {}) {
    this.audio = audio;
    this.#options = options;
    this.audio.preload = "metadata";
    this.audio.addEventListener("loadedmetadata", this.#handleTimeChange);
    this.audio.addEventListener("durationchange", this.#handleTimeChange);
    this.audio.addEventListener("timeupdate", this.#handleTimeChange);
    this.audio.addEventListener("play", this.#handlePlay);
    this.audio.addEventListener("pause", this.#handlePause);
    this.audio.addEventListener("ended", this.#handleEnded);
    this.audio.addEventListener("error", this.#handleError);
  }

  get snapshot(): AudioTransportSnapshot {
    return {
      state: this.#state,
      currentTime: Number.isFinite(this.audio.currentTime)
        ? this.audio.currentTime
        : 0,
      duration: Number.isFinite(this.audio.duration) ? this.audio.duration : 0,
    };
  }

  loadWav(bytes: Uint8Array) {
    this.clear();
    const waveBytes = bytes.slice().buffer as ArrayBuffer;
    this.#objectUrl = URL.createObjectURL(
      new Blob([waveBytes], { type: "audio/wav" }),
    );
    this.audio.src = this.#objectUrl;
    this.audio.load();
    this.#setState("ready");
  }

  async play() {
    if (this.#state === "empty") {
      throw new Error("Render audio before playing the score.");
    }
    if (this.#state === "ended") {
      this.audio.currentTime = 0;
    }
    try {
      await this.audio.play();
    } catch (error) {
      const playError = error instanceof Error ? error : new Error(String(error));
      this.#setState(this.#objectUrl ? "ready" : "empty");
      this.#options.onError?.(playError);
      throw playError;
    }
  }

  pause() {
    if (this.#state === "playing") {
      this.audio.pause();
    }
  }

  stop() {
    if (this.#state === "empty") {
      return;
    }
    this.#stopping = true;
    this.audio.pause();
    this.audio.currentTime = 0;
    this.#stopping = false;
    this.#setState("ready");
  }

  seek(seconds: number) {
    if (this.#state === "empty" || !Number.isFinite(seconds)) {
      return;
    }
    const duration = Number.isFinite(this.audio.duration)
      ? this.audio.duration
      : 0;
    this.audio.currentTime = Math.min(Math.max(seconds, 0), duration);
    this.#emitChange();
  }

  clear() {
    this.#stopping = true;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.#stopping = false;
    if (this.#objectUrl) {
      URL.revokeObjectURL(this.#objectUrl);
      this.#objectUrl = null;
    }
    this.#setState("empty");
  }

  dispose() {
    this.clear();
    this.audio.removeEventListener("loadedmetadata", this.#handleTimeChange);
    this.audio.removeEventListener("durationchange", this.#handleTimeChange);
    this.audio.removeEventListener("timeupdate", this.#handleTimeChange);
    this.audio.removeEventListener("play", this.#handlePlay);
    this.audio.removeEventListener("pause", this.#handlePause);
    this.audio.removeEventListener("ended", this.#handleEnded);
    this.audio.removeEventListener("error", this.#handleError);
  }

  #handleTimeChange = () => {
    this.#emitChange();
  };

  #handlePlay = () => {
    this.#setState("playing");
  };

  #handlePause = () => {
    if (!this.#stopping && this.#state === "playing") {
      this.#setState("paused");
    }
  };

  #handleEnded = () => {
    this.#setState("ended");
  };

  #handleError = () => {
    const error = this.audio.error;
    this.audio.pause();
    this.#setState(this.#objectUrl ? "ready" : "empty");
    this.#options.onError?.(
      new Error(error?.message || "The rendered WAV file could not be played."),
    );
  };

  #setState(state: AudioTransportState) {
    this.#state = state;
    this.#emitChange();
  }

  #emitChange() {
    this.#options.onChange?.(this.snapshot);
  }
}
