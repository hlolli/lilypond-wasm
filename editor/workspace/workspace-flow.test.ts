import { expect, test } from "bun:test";
import type { WorkspaceDatabase } from "./persistence";
import { createTabSessionStore } from "./tab-session-store";
import {
  applySaveResult,
  createWorkspaceState,
  editFile,
  openOrFocusFile,
  restoreSessionMetadata,
  serializeSessionMetadata,
  type OpenFile,
} from "./workspace-state";

class MemoryDatabase implements WorkspaceDatabase {
  private readonly records = new Map<string, unknown>();

  async get<T>(storeName: string, key: string) {
    return this.records.get(`${storeName}:${key}`) as T | undefined;
  }

  async set<T>(storeName: string, key: string, value: T) {
    this.records.set(`${storeName}:${key}`, value);
  }

  async delete(storeName: string, key: string) {
    this.records.delete(`${storeName}:${key}`);
  }
}

type FakeDiskFile = {
  content: string;
  lastModified: number;
};

class FakeWorkspaceRepository {
  private connected = false;
  private readonly files = new Map<string, FakeDiskFile>([
    ["score.ly", { content: "c4", lastModified: 10 }],
    ["parts/cello.ly", { content: "c2", lastModified: 20 }],
  ]);

  async connect() {
    this.connected = true;
  }

  async list() {
    this.assertConnected();
    return [...this.files.keys()];
  }

  async open(path: string): Promise<OpenFile> {
    this.assertConnected();
    const diskFile = this.files.get(path);
    if (!diskFile) {
      throw new Error(`Missing file: ${path}`);
    }
    const pathSegments = path.split("/");
    return {
      id: path,
      path,
      name: pathSegments.at(-1) ?? path,
      handle: { kind: "file", name: pathSegments.at(-1) } as
        FileSystemFileHandle,
      savedContent: diskFile.content,
      content: diskFile.content,
      dirty: false,
      lastModified: diskFile.lastModified,
      size: diskFile.content.length,
      pathSegments,
    };
  }

  async save(path: string, content: string) {
    this.assertConnected();
    const lastModified = 100;
    this.files.set(path, { content, lastModified });
    return {
      ok: true as const,
      content,
      lastModified,
      size: content.length,
    };
  }

  private assertConnected() {
    if (!this.connected) {
      throw new Error("Not connected");
    }
  }
}

test("connect, list, open, edit, save, and restore a tab session", async () => {
  const repository = new FakeWorkspaceRepository();
  const sessions = createTabSessionStore(new MemoryDatabase(), () => 200);

  await repository.connect();
  expect(await repository.list()).toEqual(["score.ly", "parts/cello.ly"]);

  let state = createWorkspaceState("fake-workspace");
  state = openOrFocusFile(state, await repository.open("score.ly"));
  state = openOrFocusFile(state, await repository.open("parts/cello.ly"));
  state = editFile(state, "parts/cello.ly", "c1");

  const saveResult = await repository.save("parts/cello.ly", "c1");
  state = applySaveResult(state, "parts/cello.ly", saveResult);
  expect(state.files[1].dirty).toBe(false);

  await sessions.save(serializeSessionMetadata(state)!);

  const metadata = await sessions.load("fake-workspace");
  const recreatedFiles = await Promise.all(
    metadata!.openFiles.map((item) => repository.open(item.path)),
  );
  const recreatedState = restoreSessionMetadata(metadata!, recreatedFiles);

  expect(recreatedState.files.map((item) => item.path)).toEqual([
    "score.ly",
    "parts/cello.ly",
  ]);
  expect(recreatedState.activeFileId).toBe("parts/cello.ly");
  expect(recreatedState.files[1].content).toBe("c1");
  expect(recreatedState.files[1].dirty).toBe(false);
});
