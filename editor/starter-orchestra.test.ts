import { describe, expect, test } from "bun:test";
import { STARTER_ORCHESTRA } from "./starter-orchestra";

describe("starter Csound orchestra", () => {
  test("plays LPCS instrument 17 events", () => {
    expect(STARTER_ORCHESTRA).toContain("instr 17");
    expect(STARTER_ORCHESTRA).toContain("cpsmidinn(kPitch)");
    expect(STARTER_ORCHESTRA).toContain("if p10 > 0 then");
    expect(STARTER_ORCHESTRA).toContain("iTie tival");
  });

  test("teaches the fixed LilyPond score mapping", () => {
    expect(STARTER_ORCHESTRA).toContain("28-field event for instr 17");
    expect(STARTER_ORCHESTRA).toContain("MIDI pitch in p8/p9");
    expect(STARTER_ORCHESTRA).toContain("mapped drum id in p10");
    expect(STARTER_ORCHESTRA).toContain("p11/p12 are levels from 0 to 1");
    expect(STARTER_ORCHESTRA).toContain("p13 is the gate ratio");
    expect(STARTER_ORCHESTRA).toContain("p17 is attack");
    expect(STARTER_ORCHESTRA).toContain("p18 is release");
    expect(STARTER_ORCHESTRA).toContain("p2/p3 in quarter-note beats");
    expect(STARTER_ORCHESTRA).toContain("A negative p3 continues a tie");
    expect(STARTER_ORCHESTRA).toContain("same fractional p1");
    expect(STARTER_ORCHESTRA).toContain("p28 holds percent-encoded note metadata");
  });
});
