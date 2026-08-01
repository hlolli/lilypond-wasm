import { describe, expect, test } from "bun:test";
import {
  applySaveFailure,
  applySaveResult,
  applySaveSuccess,
  closeFile,
  createWorkspaceState,
  editFile,
  hasDirtyFiles,
  openOrFocusFile,
  reloadFile,
  restoreFileDraft,
  restoreSessionMetadata,
  serializeSessionMetadata,
  type OpenFile,
} from "./workspace-state";

function file(
  path: string,
  content = "saved",
  handle = { kind: "file", name: path.split("/").at(-1) },
): OpenFile {
  const pathSegments = path.split("/");
  return {
    id: path,
    path,
    name: pathSegments.at(-1) ?? path,
    handle: handle as FileSystemFileHandle,
    savedContent: content,
    content,
    dirty: false,
    lastModified: 10,
    size: content.length,
    pathSegments,
  };
}

describe("workspace state", () => {
  test("opens files once and focuses an existing path", () => {
    const first = openOrFocusFile(createWorkspaceState("scores"), file("a.ly"));
    const second = openOrFocusFile(first, file("parts/b.ly"));
    const duplicate = openOrFocusFile(
      second,
      { ...file("a.ly"), id: "another-id" },
    );

    expect(duplicate.files).toHaveLength(2);
    expect(duplicate.activeFileId).toBe("a.ly");
    expect(duplicate.files[0].handle).toBe(first.files[0].handle);
  });

  test("derives dirty state from content", () => {
    const opened = openOrFocusFile(
      createWorkspaceState("scores"),
      file("score.ly"),
    );
    const edited = editFile(opened, "score.ly", "changed");
    const reverted = editFile(edited, "score.ly", "saved");

    expect(edited.files[0].dirty).toBe(true);
    expect(hasDirtyFiles(edited)).toBe(true);
    expect(reverted.files[0].dirty).toBe(false);
    expect(hasDirtyFiles(reverted)).toBe(false);
  });

  test("blocks a dirty close unless the caller confirms discard", () => {
    const opened = openOrFocusFile(
      createWorkspaceState("scores"),
      file("score.ly"),
    );
    const edited = editFile(opened, "score.ly", "changed");
    const blocked = closeFile(edited, "score.ly");
    const closed = closeFile(edited, "score.ly", { discardChanges: true });

    expect(blocked.closed).toBe(false);
    expect(blocked.state).toBe(edited);
    expect(closed.closed).toBe(true);
    expect(closed.state.files).toEqual([]);
    expect(closed.state.activeFileId).toBeNull();
  });

  test("focuses the next nearby tab when the active tab closes", () => {
    let state = createWorkspaceState("scores");
    state = openOrFocusFile(state, file("a.ly"));
    state = openOrFocusFile(state, file("b.ly"));
    state = openOrFocusFile(state, file("c.ly"));

    const result = closeFile(state, "c.ly");

    expect(result.closed).toBe(true);
    expect(result.state.activeFileId).toBe("b.ly");
  });

  test("applies save success and leaves state untouched on failure", () => {
    const opened = openOrFocusFile(
      createWorkspaceState("scores"),
      file("score.ly"),
    );
    const edited = editFile(opened, "score.ly", "changed");
    const failure = applySaveFailure(edited);
    const saved = applySaveSuccess(edited, "score.ly", {
      content: "changed",
      lastModified: 20,
      size: 7,
    });

    expect(failure).toBe(edited);
    expect(failure.files[0].content).toBe("changed");
    expect(failure.files[0].dirty).toBe(true);
    expect(saved.files[0]).toMatchObject({
      savedContent: "changed",
      content: "changed",
      dirty: false,
      lastModified: 20,
      size: 7,
    });
  });

  test("keeps a newer editor edit dirty when an older save finishes", () => {
    const opened = openOrFocusFile(
      createWorkspaceState("scores"),
      file("score.ly", "one"),
    );
    const editedAgain = editFile(
      editFile(opened, "score.ly", "two"),
      "score.ly",
      "three",
    );
    const saved = applySaveResult(editedAgain, "score.ly", {
      ok: true,
      content: "two",
      lastModified: 20,
      size: 3,
    });

    expect(saved.files[0].savedContent).toBe("two");
    expect(saved.files[0].content).toBe("three");
    expect(saved.files[0].dirty).toBe(true);
  });

  test("reloads disk content and restores a draft as unsaved", () => {
    const opened = openOrFocusFile(
      createWorkspaceState("scores"),
      file("score.ly", "one"),
    );
    const reloaded = reloadFile(opened, "score.ly", {
      content: "two",
      lastModified: 20,
      size: 3,
    });
    const restored = restoreFileDraft(reloaded, "score.ly", {
      path: "score.ly",
      content: "draft",
    });

    expect(reloaded.files[0]).toMatchObject({
      savedContent: "two",
      content: "two",
      dirty: false,
    });
    expect(restored.files[0]).toMatchObject({
      savedContent: "two",
      content: "draft",
      dirty: true,
    });
  });

  test("serializes tab order and restores resolved files only", () => {
    let state = createWorkspaceState("scores");
    state = openOrFocusFile(state, file("a.ly"));
    state = openOrFocusFile(state, file("parts/b.ly"));
    const metadata = serializeSessionMetadata(state);

    expect(metadata).not.toBeNull();
    expect(metadata?.openFiles.map((item) => item.path)).toEqual([
      "a.ly",
      "parts/b.ly",
    ]);
    expect(metadata?.activeFilePath).toBe("parts/b.ly");

    const restored = restoreSessionMetadata(metadata!, [
      file("parts/b.ly", "new b"),
      file("a.ly", "new a"),
    ]);
    expect(restored.files.map((item) => item.path)).toEqual([
      "a.ly",
      "parts/b.ly",
    ]);
    expect(restored.activeFileId).toBe("parts/b.ly");
  });
});
