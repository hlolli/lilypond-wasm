import { describe, expect, test } from "bun:test";
import { createPlaybackCsd, PLAYBACK_WAV_FILE } from "./playback-csd";

const score = `C 0
t 0 60
i 17.0001 0 1 1000 1 1 1 60 60 -1 0.7 0.7 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 "id=1"
f 0 1
e`;

describe("createPlaybackCsd", () => {
  test("wraps an instrument 17 score in the local playback orchestra", () => {
    const csd = createPlaybackCsd(score);

    expect(csd).toContain(`-o${PLAYBACK_WAV_FILE}`);
    expect(csd).toContain("instr 17");
    expect(csd).toContain("cpsmidinn(kPitch)");
    expect(csd).toContain("if p10 > 0 then");
    expect(csd).toContain("iTie tival");
    expect(csd).toContain("iPhase = -1");
    expect(csd).toContain("aEnvelope linsegr iEnvelopeStart");
    expect(csd).toContain("kSegmentTime init 0");
    expect(csd).not.toContain("timeinsts()");
    expect(csd).toContain(`<CsScore>\n${score}\n</CsScore>`);
  });

  test("rejects an empty score", () => {
    expect(() => createPlaybackCsd(" \n ")).toThrow("score is empty");
  });

  test("rejects a full CSD document", () => {
    expect(() =>
      createPlaybackCsd(
        "<CsoundSynthesizer><CsScore>i 17 0 1</CsScore></CsoundSynthesizer>",
      )
    ).toThrow("not a CSD file");
  });

  test("requires the fixed instrument 17 adapter", () => {
    expect(() => createPlaybackCsd("i 18 0 1\ne")).toThrow(
      "adapter-instrument to 17",
    );
    expect(() => createPlaybackCsd("i 170 0 1\ne")).toThrow(
      "adapter-instrument to 17",
    );
  });
});
