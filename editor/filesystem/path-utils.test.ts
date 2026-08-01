import { describe, expect, test } from "bun:test";
import { WorkspaceError } from "./errors";
import {
  appendPath,
  parseWorkspacePath,
  pathFromId,
  pathToDisplay,
  pathToId,
} from "./path-utils";

describe("workspace paths", () => {
  test("round-trips Unicode path segments without collisions", () => {
    const path = ["Scores", "Þema", "fiðla/part.ly"];
    expect(() => pathToId(path)).toThrow(WorkspaceError);

    const validPath = ["Scores", "Þema", "fiðla.ly"];
    expect(pathFromId(pathToId(validPath))).toEqual(validPath);
    expect(pathToDisplay(validPath)).toBe("Scores/Þema/fiðla.ly");
  });

  test("rejects traversal and separator segments", () => {
    expect(() => appendPath([], "..")).toThrow(WorkspaceError);
    expect(() => appendPath([], "parts/violin.ly")).toThrow(WorkspaceError);
    expect(() => pathFromId('["ok",42]')).toThrow(WorkspaceError);
  });

  test("gives the root its own stable id and display value", () => {
    expect(pathToId([])).toBe("[]");
    expect(pathFromId("[]")).toEqual([]);
    expect(pathToDisplay([])).toBe("/");
  });

  test("parses root-relative file paths", () => {
    expect(parseWorkspacePath(" main.ly ")).toEqual(["main.ly"]);
    expect(parseWorkspacePath("parts/violin.ily")).toEqual([
      "parts",
      "violin.ily",
    ]);
  });

  test("rejects absolute, empty, and malformed file paths", () => {
    for (const path of [
      "",
      "/main.ly",
      "parts/",
      "parts//violin.ly",
      "parts\\violin.ly",
      "../main.ly",
      "parts/./violin.ly",
    ]) {
      expect(() => parseWorkspacePath(path)).toThrow(
        "Use a relative file path",
      );
    }
  });
});
