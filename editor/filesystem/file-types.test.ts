import { describe, expect, test } from "bun:test";
import {
  classifyWorkspaceFile,
  fileExtension,
  isEditableTextFile,
  isLilyPondFile,
} from "./file-types";

describe("file type checks", () => {
  test("accepts the text allowlist without case sensitivity", () => {
    expect(isEditableTextFile("score.LY")).toBe(true);
    expect(isEditableTextFile("notes.Markdown")).toBe(false);
    expect(isEditableTextFile("archive.tar.gz")).toBe(false);
    expect(isEditableTextFile("part.ily")).toBe(true);
  });

  test("marks LilyPond source apart from other text", () => {
    expect(classifyWorkspaceFile("score.ly")).toEqual({
      kind: "lilypond",
      editable: true,
      extension: ".ly",
    });
    expect(classifyWorkspaceFile("notes.md").kind).toBe("text");
    expect(classifyWorkspaceFile("sample.wav")).toEqual({
      kind: "unsupported",
      editable: false,
      extension: ".wav",
    });
    expect(isLilyPondFile("include.ILY")).toBe(true);
  });

  test("handles names without a useful extension", () => {
    expect(fileExtension("README")).toBeNull();
    expect(fileExtension("trailing.")).toBeNull();
  });
});
