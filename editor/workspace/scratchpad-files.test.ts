import { describe, expect, test } from "bun:test";
import {
  activeScratchpadState,
  createScratchpadFiles,
  switchScratchpadFile,
  updateActiveScratchpadState,
} from "./scratchpad-files";

describe("scratchpad files", () => {
  test("starts on main.ly and keeps both file states", () => {
    const mainState = { doc: "main" };
    const orchestraState = { doc: "orchestra" };
    const files = createScratchpadFiles(mainState, orchestraState);

    expect(files.activeFileName).toBe("main.ly");
    expect(activeScratchpadState(files)).toBe(mainState);
    expect(files.states["lpcs.orc"]).toBe(orchestraState);
  });

  test("updates only the active file without changing the old model", () => {
    const mainState = { doc: "main" };
    const orchestraState = { doc: "orchestra" };
    const nextMainState = { doc: "changed main" };
    const files = createScratchpadFiles(mainState, orchestraState);

    const updated = updateActiveScratchpadState(files, nextMainState);

    expect(updated).not.toBe(files);
    expect(activeScratchpadState(updated)).toBe(nextMainState);
    expect(updated.states["lpcs.orc"]).toBe(orchestraState);
    expect(files.states["main.ly"]).toBe(mainState);
  });

  test("preserves each state while switching and editing both files", () => {
    const mainState = { doc: "main" };
    const orchestraState = { doc: "orchestra" };
    const nextOrchestraState = { doc: "changed orchestra" };
    const files = createScratchpadFiles(mainState, orchestraState);

    const orchestraFiles = switchScratchpadFile(files, "lpcs.orc");
    const editedOrchestra = updateActiveScratchpadState(
      orchestraFiles,
      nextOrchestraState,
    );
    const mainFiles = switchScratchpadFile(editedOrchestra, "main.ly");

    expect(activeScratchpadState(orchestraFiles)).toBe(orchestraState);
    expect(activeScratchpadState(mainFiles)).toBe(mainState);
    expect(mainFiles.states["lpcs.orc"]).toBe(nextOrchestraState);
    expect(files.activeFileName).toBe("main.ly");
    expect(files.states["lpcs.orc"]).toBe(orchestraState);
  });

  test("returns the same model when the requested file is active", () => {
    const files = createScratchpadFiles("main", "orchestra");

    expect(switchScratchpadFile(files, "main.ly")).toBe(files);
  });
});
