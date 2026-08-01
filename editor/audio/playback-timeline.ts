export type CursorTailPolicy = "freeze" | "fade" | "hide";

export type PlaybackCursorPoint = {
  id: number;
  qbeat: readonly [number, number];
  frame: number;
  playbackOccurrenceIds: number[];
  notationAnchorIds: string[];
};

export type PlaybackTimeline = {
  render: {
    sampleRate: number;
    scoreZeroFrame: number;
    scoreEndFrame: number;
    mediaEndFrame: number | null;
    presentationOffsetFrames: number;
  };
  scoreEnd: {
    frame: number;
  };
  cursorTailPolicy: CursorTailPolicy;
  cursorPoints: PlaybackCursorPoint[];
};

export type PlaybackKeyframe<T> = {
  frame: number;
  value: T;
};

export type PlaybackFrameLocation<T> = {
  from: PlaybackKeyframe<T>;
  to: PlaybackKeyframe<T> | null;
  progress: number;
  opacity: number;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as JsonRecord;
}

function nonNegativeInteger(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${field} must be a non-negative integer.`);
  }
  return Number(value);
}

function positiveInteger(value: unknown, field: string) {
  const result = nonNegativeInteger(value, field);
  if (result === 0) {
    throw new Error(`${field} must be positive.`);
  }
  return result;
}

function rational(value: unknown, field: string): readonly [number, number] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${field} must be a rational pair.`);
  }
  const numerator = nonNegativeInteger(value[0], `${field}[0]`);
  const denominator = positiveInteger(value[1], `${field}[1]`);
  return [numerator, denominator];
}

function positiveIntegerList(value: unknown, field: string) {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array.`);
  }
  return value.map((item, index) =>
    positiveInteger(item, `${field}[${index}]`)
  );
}

function stringList(value: unknown, field: string) {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array.`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || !item) {
      throw new Error(`${field}[${index}] must be a non-empty string.`);
    }
    return item;
  });
}

export function parsePlaybackTimeline(source: string): PlaybackTimeline {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("The LPCS timeline is not valid JSON.");
  }

  const root = record(parsed, "timeline");
  if (root.format !== "lpcs-timeline" || root.version !== 1) {
    throw new Error("The LPCS timeline format is not supported.");
  }

  const render = record(root.render, "timeline.render");
  const scoreEnd = record(root.scoreEnd, "timeline.scoreEnd");
  const sampleRate = positiveInteger(
    render.sampleRate,
    "timeline.render.sampleRate",
  );
  const scoreZeroFrame = nonNegativeInteger(
    render.scoreZeroFrame,
    "timeline.render.scoreZeroFrame",
  );
  const scoreEndFrame = nonNegativeInteger(
    render.scoreEndFrame,
    "timeline.render.scoreEndFrame",
  );
  const scoreEndRecordFrame = nonNegativeInteger(
    scoreEnd.frame,
    "timeline.scoreEnd.frame",
  );
  if (scoreEndFrame !== scoreEndRecordFrame) {
    throw new Error("The LPCS timeline has two different score end frames.");
  }

  const mediaEndFrame = render.mediaEndFrame === null
    ? null
    : nonNegativeInteger(
        render.mediaEndFrame,
        "timeline.render.mediaEndFrame",
      );
  const presentationOffsetFrames = nonNegativeInteger(
    render.presentationOffsetFrames,
    "timeline.render.presentationOffsetFrames",
  );
  const cursorTailPolicy = root.cursorTailPolicy;
  if (
    cursorTailPolicy !== "freeze" &&
    cursorTailPolicy !== "fade" &&
    cursorTailPolicy !== "hide"
  ) {
    throw new Error("The LPCS cursor tail policy is not supported.");
  }
  if (!Array.isArray(root.cursorPoints)) {
    throw new Error("timeline.cursorPoints must be an array.");
  }

  let previousFrame = -1;
  const cursorPoints = root.cursorPoints.map((value, index) => {
    const point = record(value, `timeline.cursorPoints[${index}]`);
    const frame = nonNegativeInteger(
      point.frame,
      `timeline.cursorPoints[${index}].frame`,
    );
    if (frame < previousFrame || frame > scoreEndFrame) {
      throw new Error("The LPCS cursor points are outside timeline order.");
    }
    previousFrame = frame;
    return {
      id: positiveInteger(point.id, `timeline.cursorPoints[${index}].id`),
      qbeat: rational(
        point.qbeat,
        `timeline.cursorPoints[${index}].qbeat`,
      ),
      frame,
      playbackOccurrenceIds: positiveIntegerList(
        point.playbackOccurrenceIds,
        `timeline.cursorPoints[${index}].playbackOccurrenceIds`,
      ),
      notationAnchorIds: stringList(
        point.notationAnchorIds,
        `timeline.cursorPoints[${index}].notationAnchorIds`,
      ),
    };
  });

  return {
    render: {
      sampleRate,
      scoreZeroFrame,
      scoreEndFrame,
      mediaEndFrame,
      presentationOffsetFrames,
    },
    scoreEnd: { frame: scoreEndRecordFrame },
    cursorTailPolicy,
    cursorPoints,
  };
}

export function mediaSecondsToScoreFrame(
  seconds: number,
  timeline: PlaybackTimeline,
) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return timeline.render.scoreZeroFrame +
    Math.floor(safeSeconds * timeline.render.sampleRate + 0.5) -
    timeline.render.presentationOffsetFrames;
}

export function qbeatKey(qbeat: readonly [number, number]) {
  return `${qbeat[0]}/${qbeat[1]}`;
}

export function locatePlaybackFrame<T>(
  keyframes: readonly PlaybackKeyframe<T>[],
  scoreFrame: number,
  scoreEndFrame: number,
  tailPolicy: CursorTailPolicy,
  mediaEndScoreFrame: number,
): PlaybackFrameLocation<T> | null {
  if (keyframes.length === 0 || scoreFrame < keyframes[0].frame) {
    return null;
  }

  let low = 0;
  let high = keyframes.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (keyframes[middle].frame <= scoreFrame) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const from = keyframes[Math.max(0, low - 1)];
  const to = low < keyframes.length ? keyframes[low] : null;
  if (scoreFrame > scoreEndFrame) {
    if (tailPolicy === "hide") {
      return null;
    }
    if (tailPolicy === "fade") {
      const tailLength = mediaEndScoreFrame - scoreEndFrame;
      if (tailLength <= 0 || scoreFrame >= mediaEndScoreFrame) {
        return null;
      }
      return {
        from,
        to: null,
        progress: 0,
        opacity: Math.max(
          0,
          Math.min(1, 1 - (scoreFrame - scoreEndFrame) / tailLength),
        ),
      };
    }
    return { from, to: null, progress: 0, opacity: 1 };
  }

  const progress = to && to.frame > from.frame
    ? Math.max(
        0,
        Math.min(1, (scoreFrame - from.frame) / (to.frame - from.frame)),
      )
    : 0;
  return { from, to, progress, opacity: 1 };
}
