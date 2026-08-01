import type { AudioTransportSnapshot } from "./audio-transport";
import {
  locatePlaybackFrame,
  mediaSecondsToScoreFrame,
  qbeatKey,
  type PlaybackKeyframe,
  type PlaybackTimeline,
} from "./playback-timeline";

export type AnimationFrameScheduler = {
  request(callback: FrameRequestCallback): number;
  cancel(handle: number): void;
};

const browserFrameScheduler: AnimationFrameScheduler = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
};

export class PlaybackFrameLoop<T> {
  #read: () => T;
  #write: (value: T) => void;
  #scheduler: AnimationFrameScheduler;
  #running = false;
  #handle: number | null = null;

  constructor(
    read: () => T,
    write: (value: T) => void,
    scheduler: AnimationFrameScheduler = browserFrameScheduler,
  ) {
    this.#read = read;
    this.#write = write;
    this.#scheduler = scheduler;
  }

  start() {
    if (this.#running) {
      return;
    }
    this.#running = true;
    this.sample();
    this.#schedule();
  }

  stop() {
    this.#running = false;
    if (this.#handle !== null) {
      this.#scheduler.cancel(this.#handle);
      this.#handle = null;
    }
  }

  sample() {
    this.#write(this.#read());
  }

  #schedule() {
    if (!this.#running || this.#handle !== null) {
      return;
    }
    this.#handle = this.#scheduler.request(this.#tick);
  }

  #tick = () => {
    this.#handle = null;
    if (!this.#running) {
      return;
    }
    this.sample();
    this.#schedule();
  };
}

export type ScorePreviewSurface = {
  container: HTMLElement;
  frame: HTMLIFrameElement;
};

type IndexedTarget = {
  surface: ScorePreviewSurface;
  element: Element;
};

type ResolvedPoint = {
  targets: IndexedTarget[];
};

type PlayheadGeometry = {
  surface: ScorePreviewSurface;
  x: number;
  top: number;
  bottom: number;
};

type PlaybackSample = {
  currentTime: number;
  duration: number;
};

type Rectangle = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

function finiteMediaTime(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function anchorMomentKey(anchorId: string, qbeat: string) {
  return `${anchorId}\u0000${qbeat}`;
}

function addIndexEntry(
  index: Map<string, IndexedTarget[]>,
  key: string,
  target: IndexedTarget,
) {
  const entries = index.get(key);
  if (entries) {
    entries.push(target);
  } else {
    index.set(key, [target]);
  }
}

export function translateFrameRectangle(
  rectangle: Rectangle,
  frameRectangle: Rectangle,
): Rectangle {
  return {
    top: frameRectangle.top + rectangle.top,
    right: frameRectangle.left + rectangle.right,
    bottom: frameRectangle.top + rectangle.bottom,
    left: frameRectangle.left + rectangle.left,
    width: rectangle.width,
    height: rectangle.height,
  };
}

function rectangleDistanceFromY(rect: Rectangle, y: number) {
  if (y < rect.top) {
    return rect.top - y;
  }
  if (y > rect.bottom) {
    return y - rect.bottom;
  }
  return 0;
}

function frameSvgRoot(surface: ScorePreviewSurface) {
  const root = surface.frame.contentDocument?.querySelector("svg");
  return root?.namespaceURI === "http://www.w3.org/2000/svg"
    ? root as SVGSVGElement
    : null;
}

export class ScorePlayhead {
  #audio: HTMLAudioElement;
  #timeline: PlaybackTimeline | null = null;
  #pages: ScorePreviewSurface[] = [];
  #markers = new Map<ScorePreviewSurface, HTMLElement>();
  #staffs = new Map<ScorePreviewSurface, Element[]>();
  #keyframes: PlaybackKeyframe<ResolvedPoint>[] = [];
  #loadHandlers = new Map<HTMLIFrameElement, () => void>();
  #active = false;
  #shownKeyframe: PlaybackKeyframe<ResolvedPoint> | null = null;
  #loop: PlaybackFrameLoop<PlaybackSample>;

  constructor(
    audio: HTMLAudioElement,
    scheduler: AnimationFrameScheduler = browserFrameScheduler,
  ) {
    this.#audio = audio;
    this.#loop = new PlaybackFrameLoop(
      () => ({
        currentTime: finiteMediaTime(this.#audio.currentTime),
        duration: finiteMediaTime(this.#audio.duration),
      }),
      (sample) => this.#render(sample),
      scheduler,
    );
  }

  setTimeline(timeline: PlaybackTimeline | null) {
    this.#timeline = timeline;
    this.reset();
    this.#refreshTargets();
  }

  setPages(pages: ScorePreviewSurface[]) {
    for (const [frame, handler] of this.#loadHandlers) {
      frame.removeEventListener("load", handler);
    }
    this.#loadHandlers.clear();
    this.#markers.clear();
    this.#staffs.clear();
    this.#pages = pages;
    this.reset();

    for (const surface of pages) {
      const marker = surface.container.ownerDocument.createElement("span");
      marker.className = "score-page__playhead";
      marker.setAttribute("aria-hidden", "true");
      marker.hidden = true;
      surface.container.append(marker);
      this.#markers.set(surface, marker);

      const handleLoad = () => {
        this.#prepareFrame(surface);
        this.#refreshTargets();
        if (this.#active) {
          this.#loop.sample();
        }
      };
      surface.frame.addEventListener("load", handleLoad);
      this.#loadHandlers.set(surface.frame, handleLoad);
      if (surface.frame.contentDocument?.readyState === "complete") {
        handleLoad();
      }
    }
    this.#refreshTargets();
  }

  sync(snapshot: AudioTransportSnapshot) {
    if (snapshot.state === "empty") {
      this.reset();
      return;
    }
    if (snapshot.state === "playing") {
      this.#active = true;
      this.#loop.start();
      return;
    }

    this.#loop.stop();
    if (this.#active && (snapshot.state === "paused" || snapshot.state === "ended")) {
      this.#loop.sample();
    }
  }

  seek() {
    if (!this.#timeline) {
      return;
    }
    this.#active = true;
    this.#loop.sample();
  }

  reset() {
    this.#active = false;
    this.#shownKeyframe = null;
    this.#loop.stop();
    this.#hideMarkers();
  }

  dispose() {
    this.reset();
    for (const [frame, handler] of this.#loadHandlers) {
      frame.removeEventListener("load", handler);
    }
    this.#loadHandlers.clear();
    this.#pages = [];
    this.#markers.clear();
    this.#staffs.clear();
    this.#keyframes = [];
    this.#timeline = null;
  }

  #prepareFrame(surface: ScorePreviewSurface) {
    const svg = frameSvgRoot(surface);
    if (!svg) {
      return;
    }
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.display = "block";
  }

  #refreshTargets() {
    const timeline = this.#timeline;
    if (!timeline) {
      this.#keyframes = [];
      this.#hideMarkers();
      return;
    }

    const byOccurrence = new Map<string, IndexedTarget[]>();
    const byAnchorMoment = new Map<string, IndexedTarget[]>();
    this.#staffs.clear();
    for (const surface of this.#pages) {
      const documentNode = surface.frame.contentDocument;
      const svg = frameSvgRoot(surface);
      if (!documentNode || !svg) {
        continue;
      }
      const elements = svg.querySelectorAll(
        "[data-lpcs-anchor-id], [data-lpcs-playback-occurrence-id]",
      );
      for (const element of elements) {
        const target = { surface, element };
        const occurrenceId = element.getAttribute(
          "data-lpcs-playback-occurrence-id",
        );
        if (occurrenceId) {
          addIndexEntry(byOccurrence, occurrenceId, target);
        }
        const anchorId = element.getAttribute("data-lpcs-anchor-id");
        const qbeat = element.getAttribute("data-lpcs-qbeat");
        if (anchorId && qbeat) {
          addIndexEntry(
            byAnchorMoment,
            anchorMomentKey(anchorId, qbeat),
            target,
          );
        }
      }
      this.#staffs.set(
        surface,
        Array.from(svg.querySelectorAll(".lpcs-staff")),
      );
    }

    const nextKeyframes: PlaybackKeyframe<ResolvedPoint>[] = [];
    for (const point of timeline.cursorPoints) {
      const targets: IndexedTarget[] = [];
      const seen = new Set<Element>();
      const include = (items: IndexedTarget[] | undefined) => {
        for (const item of items ?? []) {
          if (!seen.has(item.element)) {
            seen.add(item.element);
            targets.push(item);
          }
        }
      };
      for (const occurrenceId of point.playbackOccurrenceIds) {
        include(byOccurrence.get(String(occurrenceId)));
      }
      const moment = qbeatKey(point.qbeat);
      for (const anchorId of point.notationAnchorIds) {
        include(byAnchorMoment.get(anchorMomentKey(anchorId, moment)));
      }
      if (targets.length === 0) {
        continue;
      }

      const previous = nextKeyframes.at(-1);
      if (previous?.frame === point.frame) {
        const merged = [...previous.value.targets];
        const mergedElements = new Set(
          previous.value.targets.map((target) => target.element),
        );
        for (const target of targets) {
          if (!mergedElements.has(target.element)) {
            mergedElements.add(target.element);
            merged.push(target);
          }
        }
        previous.value = { targets: merged };
      } else {
        nextKeyframes.push({ frame: point.frame, value: { targets } });
      }
    }
    this.#keyframes = nextKeyframes;
  }

  #render(sample: PlaybackSample) {
    const timeline = this.#timeline;
    if (!this.#active || !timeline || this.#keyframes.length === 0) {
      this.#hideMarkers();
      return;
    }

    const scoreFrame = mediaSecondsToScoreFrame(sample.currentTime, timeline);
    const measuredMediaEnd = timeline.render.mediaEndFrame ??
      Math.floor(sample.duration * timeline.render.sampleRate + 0.5);
    const mediaEndScoreFrame = timeline.render.scoreZeroFrame +
      measuredMediaEnd -
      timeline.render.presentationOffsetFrames;
    const location = locatePlaybackFrame(
      this.#keyframes,
      scoreFrame,
      timeline.render.scoreEndFrame,
      timeline.cursorTailPolicy,
      mediaEndScoreFrame,
    );
    if (!location) {
      this.#shownKeyframe = null;
      this.#hideMarkers();
      return;
    }

    const from = this.#geometry(location.from.value);
    if (!from) {
      this.#hideMarkers();
      return;
    }
    let geometry = from;
    if (location.to) {
      const to = this.#geometry(location.to.value);
      if (to && this.#sameSystem(from, to)) {
        const progress = location.progress;
        geometry = {
          surface: from.surface,
          x: from.x + (to.x - from.x) * progress,
          top: from.top + (to.top - from.top) * progress,
          bottom: from.bottom + (to.bottom - from.bottom) * progress,
        };
      }
    }

    const changedPoint = this.#shownKeyframe !== location.from;
    this.#shownKeyframe = location.from;
    this.#showGeometry(geometry, location.opacity);
    if (changedPoint) {
      this.#markers.get(geometry.surface)?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }
  }

  #geometry(point: ResolvedPoint): PlayheadGeometry | null {
    const grouped = new Map<ScorePreviewSurface, Element[]>();
    for (const target of point.targets) {
      const elements = grouped.get(target.surface);
      if (elements) {
        elements.push(target.element);
      } else {
        grouped.set(target.surface, [target.element]);
      }
    }

    for (const surface of this.#pages) {
      const elements = grouped.get(surface);
      if (!elements?.length) {
        continue;
      }
      const pageRect = surface.container.getBoundingClientRect();
      const frameRect = surface.frame.getBoundingClientRect();
      const targetRects = elements
        .map((element) =>
          translateFrameRectangle(element.getBoundingClientRect(), frameRect)
        )
        .filter((rect) => rect.width > 0 || rect.height > 0);
      if (targetRects.length === 0) {
        continue;
      }

      const x = targetRects.reduce(
        (total, rect) => total + rect.left + rect.width / 2,
        0,
      ) / targetRects.length;
      const verticalRects = [...targetRects];
      const staffRects = (this.#staffs.get(surface) ?? [])
        .map((staff) =>
          translateFrameRectangle(staff.getBoundingClientRect(), frameRect)
        )
        .filter((rect) => rect.width > 0 || rect.height > 0);
      for (const targetRect of targetRects) {
        const targetX = targetRect.left + targetRect.width / 2;
        const targetY = targetRect.top + targetRect.height / 2;
        const nearest = staffRects
          .filter((rect) => targetX >= rect.left - 2 && targetX <= rect.right + 2)
          .sort(
            (left, right) =>
              rectangleDistanceFromY(left, targetY) -
              rectangleDistanceFromY(right, targetY),
          )[0];
        if (nearest) {
          verticalRects.push(nearest);
        }
      }

      let top = Math.min(...verticalRects.map((rect) => rect.top)) - 4;
      let bottom = Math.max(...verticalRects.map((rect) => rect.bottom)) + 4;
      if (bottom - top < 28) {
        const middle = (top + bottom) / 2;
        top = middle - 14;
        bottom = middle + 14;
      }
      top = Math.max(frameRect.top, top);
      bottom = Math.min(frameRect.bottom, bottom);
      return {
        surface,
        x: x - pageRect.left,
        top: top - pageRect.top,
        bottom: bottom - pageRect.top,
      };
    }
    return null;
  }

  #sameSystem(from: PlayheadGeometry, to: PlayheadGeometry) {
    if (from.surface !== to.surface) {
      return false;
    }
    const verticalGap = Math.max(
      0,
      Math.max(from.top, to.top) - Math.min(from.bottom, to.bottom),
    );
    return verticalGap <= 8;
  }

  #showGeometry(geometry: PlayheadGeometry, opacity: number) {
    for (const [surface, marker] of this.#markers) {
      if (surface !== geometry.surface) {
        marker.hidden = true;
        continue;
      }
      marker.hidden = false;
      marker.style.left = `${geometry.x}px`;
      marker.style.top = `${geometry.top}px`;
      marker.style.height = `${Math.max(1, geometry.bottom - geometry.top)}px`;
      marker.style.opacity = String(opacity);
    }
  }

  #hideMarkers() {
    for (const marker of this.#markers.values()) {
      marker.hidden = true;
    }
  }
}
