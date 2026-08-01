import { describe, expect, test } from "bun:test";
import {
  createDraftStore,
  draftDiffersFromDisk,
} from "./draft-store";
import type { WorkspaceDatabase } from "./persistence";
import { createTabSessionStore } from "./tab-session-store";
import {
  createWorkspaceState,
  editFile,
  openOrFocusFile,
  serializeSessionMetadata,
  type OpenFile,
} from "./workspace-state";

class MemoryDatabase implements WorkspaceDatabase {
  readonly records = new Map<string, unknown>();

  private key(storeName: string, key: string) {
    return `${storeName}\0${key}`;
  }

  async get<T>(storeName: string, key: string) {
    return this.records.get(this.key(storeName, key)) as T | undefined;
  }

  async set<T>(storeName: string, key: string, value: T) {
    this.records.set(this.key(storeName, key), value);
  }

  async delete(storeName: string, key: string) {
    this.records.delete(this.key(storeName, key));
  }
}

function file(path: string, content = "saved"): OpenFile {
  const pathSegments = path.split("/");
  return {
    id: path,
    path,
    name: pathSegments.at(-1) ?? path,
    handle: { kind: "file", name: pathSegments.at(-1) } as FileSystemFileHandle,
    savedContent: content,
    content,
    dirty: false,
    lastModified: 10,
    size: content.length,
    pathSegments,
  };
}

describe("workspace persistence adapters", () => {
  test("stores tab sessions under their workspace id", async () => {
    const database = new MemoryDatabase();
    const store = createTabSessionStore(database, () => 50);
    const state = openOrFocusFile(
      createWorkspaceState("scores"),
      file("score.ly"),
    );
    const metadata = serializeSessionMetadata(state)!;

    await store.save(metadata);

    expect(await store.load("scores")).toEqual(metadata);
    expect(await store.load("other")).toBeNull();
    await store.clear("scores");
    expect(await store.load("scores")).toBeNull();
  });

  test("stores dirty drafts with their saved base and disk version", async () => {
    const database = new MemoryDatabase();
    const store = createDraftStore(database, () => 50);
    const opened = openOrFocusFile(
      createWorkspaceState("scores"),
      file("parts/cello.ly"),
    );
    const edited = editFile(opened, "parts/cello.ly", "local changes");

    await store.save("scores", edited.files[0]);
    const draft = await store.load("scores", "parts/cello.ly");

    expect(draft).toMatchObject({
      workspaceId: "scores",
      fileId: "parts/cello.ly",
      path: "parts/cello.ly",
      pathSegments: ["parts", "cello.ly"],
      baseSavedContent: "saved",
      content: "local changes",
      lastModified: 10,
      updatedAt: 50,
    });
    expect(await store.load("other", "parts/cello.ly")).toBeNull();
    expect(draftDiffersFromDisk(draft!, "saved")).toBe(true);
    expect(draftDiffersFromDisk(draft!, "local changes")).toBe(false);
  });

  test("removes a draft when the file is no longer dirty", async () => {
    const database = new MemoryDatabase();
    const store = createDraftStore(database);
    const dirty = {
      ...file("score.ly"),
      content: "draft",
      dirty: true,
    };

    await store.save("scores", dirty);
    await store.save("scores", file("score.ly"));

    expect(await store.load("scores", "score.ly")).toBeNull();
  });
});
