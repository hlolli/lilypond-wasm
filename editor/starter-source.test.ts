import { describe, expect, test } from "bun:test";
import { defaultSource } from "./starter-source";

describe("default LilyPond source", () => {
  test("loads the Csound score plugin and requests a playable score", () => {
    expect(defaultSource).toContain('\\include "lpcs.ily"');
    expect(defaultSource).toContain("\\csoundExportOptions");
    expect(defaultSource).toContain("(strict . #t)");
    expect(defaultSource).toContain("(adapter-instrument . 17)");
    expect(defaultSource).toContain('(target . "trace")');
    expect(defaultSource).toContain("(emit-timeline . #t)");
    expect(defaultSource).toContain("\\csoundUnfoldForExport {");
    expect(defaultSource).toContain("\\score {");
    expect(defaultSource).toContain("\\layout { }");
  });
});
