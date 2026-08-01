import { describe, expect, test } from "bun:test";
import {
  locatePlaybackFrame,
  mediaSecondsToScoreFrame,
  parsePlaybackTimeline,
  qbeatKey,
  type PlaybackKeyframe,
} from "./playback-timeline";

function timelineSource(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    format: "lpcs-timeline",
    version: 1,
    timeUnit: "quarter-note",
    render: {
      sampleRate: 48_000,
      scoreZeroFrame: 0,
      scoreEndFrame: 96_000,
      mediaEndFrame: null,
      presentationOffsetFrames: 2_400,
      frameRounding: "nearest-half-up",
      timingMode: "sample-accurate-reference",
    },
    scoreEnd: { qbeat: [4, 1], frame: 96_000 },
    cursorTailPolicy: "freeze",
    cursorPoints: [
      {
        id: 1,
        qbeat: [0, 1],
        frame: 0,
        seconds: 0,
        eventIds: [11],
        playbackOccurrenceIds: [11],
        notationAnchorIds: ["na-000001"],
      },
      {
        id: 2,
        qbeat: [2, 1],
        frame: 48_000,
        seconds: 1,
        eventIds: [],
        playbackOccurrenceIds: [],
        notationAnchorIds: ["na-000002"],
      },
      {
        id: 3,
        qbeat: [4, 1],
        frame: 96_000,
        seconds: 2,
        eventIds: [],
        playbackOccurrenceIds: [],
        notationAnchorIds: [],
      },
    ],
    ...overrides,
  });
}

describe("LPCS playback timeline", () => {
  test("parses the frame clock and exact SVG lookup fields", () => {
    const timeline = parsePlaybackTimeline(timelineSource());

    expect(timeline.render).toEqual({
      sampleRate: 48_000,
      scoreZeroFrame: 0,
      scoreEndFrame: 96_000,
      mediaEndFrame: null,
      presentationOffsetFrames: 2_400,
    });
    expect(timeline.cursorPoints[0]).toEqual({
      id: 1,
      qbeat: [0, 1],
      frame: 0,
      playbackOccurrenceIds: [11],
      notationAnchorIds: ["na-000001"],
    });
    expect(qbeatKey(timeline.cursorPoints[1].qbeat)).toBe("2/1");
  });

  test("maps media time to the reference clock with its offset", () => {
    const timeline = parsePlaybackTimeline(timelineSource());

    expect(mediaSecondsToScoreFrame(0, timeline)).toBe(-2_400);
    expect(mediaSecondsToScoreFrame(0.05, timeline)).toBe(0);
    expect(mediaSecondsToScoreFrame(1.05, timeline)).toBe(48_000);

    const shifted = parsePlaybackTimeline(timelineSource({
      render: {
        sampleRate: 48_000,
        scoreZeroFrame: 1_200,
        scoreEndFrame: 96_000,
        mediaEndFrame: null,
        presentationOffsetFrames: 2_400,
        frameRounding: "nearest-half-up",
        timingMode: "sample-accurate-reference",
      },
    }));
    expect(mediaSecondsToScoreFrame(0.025, shifted)).toBe(0);
  });

  test("rejects malformed and out-of-order timelines", () => {
    expect(() => parsePlaybackTimeline("{"))
      .toThrow("not valid JSON");
    expect(() =>
      parsePlaybackTimeline(timelineSource({ version: 2 }))
    ).toThrow("not supported");
    expect(() =>
      parsePlaybackTimeline(timelineSource({
        cursorPoints: [
          {
            id: 1,
            qbeat: [0, 1],
            frame: 97_000,
            playbackOccurrenceIds: [],
            notationAnchorIds: [],
          },
        ],
      }))
    ).toThrow("outside timeline order");
  });
});

describe("playback frame lookup", () => {
  const keyframes: PlaybackKeyframe<string>[] = [
    { frame: 0, value: "first" },
    { frame: 48_000, value: "second" },
  ];

  test("interpolates between visible cursor points", () => {
    expect(locatePlaybackFrame(
      keyframes,
      24_000,
      96_000,
      "freeze",
      100_000,
    )).toEqual({
      from: keyframes[0],
      to: keyframes[1],
      progress: 0.5,
      opacity: 1,
    });
  });

  test("applies freeze, hide, and fade after the score ends", () => {
    expect(locatePlaybackFrame(
      keyframes,
      96_000,
      96_000,
      "hide",
      104_000,
    )?.from.value).toBe("second");
    expect(locatePlaybackFrame(
      keyframes,
      100_000,
      96_000,
      "freeze",
      104_000,
    )?.from.value).toBe("second");
    expect(locatePlaybackFrame(
      keyframes,
      100_000,
      96_000,
      "hide",
      104_000,
    )).toBeNull();
    expect(locatePlaybackFrame(
      keyframes,
      100_000,
      96_000,
      "fade",
      104_000,
    )?.opacity).toBe(0.5);
    expect(locatePlaybackFrame(
      keyframes,
      104_000,
      96_000,
      "fade",
      104_000,
    )).toBeNull();
  });
});
