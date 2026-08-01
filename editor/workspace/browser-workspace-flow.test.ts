import { expect, test } from "bun:test";
import {
  FileSystemWorkspace,
  type WorkspaceHandlePersistence,
  type WorkspaceHandleRecord,
} from "../filesystem";
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

class MemoryHandleStore implements WorkspaceHandlePersistence {
  record: WorkspaceHandleRecord | null = null;

  async load() {
    return this.record;
  }

  async save(record: WorkspaceHandleRecord) {
    this.record = record;
  }

  async clear() {
    this.record = null;
  }
}

class MemoryDatabase implements WorkspaceDatabase {
  readonly records = new Map<string, unknown>();

  async get<T>(store: string, key: string) {
    return this.records.get(`${store}:${key}`) as T | undefined;
  }

  async set<T>(store: string, key: string, value: T) {
    this.records.set(`${store}:${key}`, value);
  }

  async delete(store: string, key: string) {
    this.records.delete(`${store}:${key}`);
  }
}

class MockFileHandle {
  readonly kind = "file";
  content: string;
  lastModified = 10;
  writeCount = 0;

  constructor(readonly name: string, content: string) {
    this.content = content;
  }

  async getFile() {
    return new File([this.content], this.name, {
      lastModified: this.lastModified,
    });
  }

  async createWritable() {
    let pending = this.content;
    return {
      write: async (content: string) => {
        this.writeCount += 1;
        pending = content;
      },
      close: async () => {
        this.content = pending;
        this.lastModified += 1;
      },
      abort: async () => undefined,
    } as unknown as FileSystemWritableFileStream;
  }
}

type MockEntry = MockDirectoryHandle | MockFileHandle;

class MockDirectoryHandle {
  readonly kind = "directory";
  readonly children = new Map<string, MockEntry>();

  constructor(readonly name: string) {}

  add(entry: MockEntry) {
    this.children.set(entry.name, entry);
    return this;
  }

  async queryPermission() {
    return "granted" as PermissionState;
  }

  async requestPermission() {
    return "granted" as PermissionState;
  }

  async isSameEntry(other: FileSystemHandle) {
    return other === (this as unknown as FileSystemHandle);
  }

  async getDirectoryHandle(name: string) {
    const entry = this.children.get(name);
    if (!entry || entry.kind !== "directory") {
      throw new DOMException("Missing folder", "NotFoundError");
    }
    return entry as unknown as FileSystemDirectoryHandle;
  }

  async getFileHandle(
    name: string,
    options: { create?: boolean } = {},
  ) {
    let entry = this.children.get(name);
    if (!entry && options.create) {
      entry = new MockFileHandle(name, "");
      this.children.set(name, entry);
    }
    if (!entry) {
      throw new DOMException("Missing file", "NotFoundError");
    }
    if (entry.kind !== "file") {
      throw new DOMException("Wrong type", "TypeMismatchError");
    }
    return entry as unknown as FileSystemFileHandle;
  }

  async *entries() {
    for (const entry of this.children.values()) {
      yield [
        entry.name,
        entry as unknown as FileSystemHandle,
      ] as [string, FileSystemHandle];
    }
  }
}

function toOpenFile(
  result: Awaited<ReturnType<FileSystemWorkspace["readTextFile"]>>,
): OpenFile {
  return {
    id: result.id,
    path: result.path.join("/"),
    name: result.name,
    handle: result.handle,
    savedContent: result.content,
    content: result.content,
    dirty: false,
    lastModified: result.version.lastModified,
    size: result.version.size,
    pathSegments: [...result.path],
  };
}

test("connects, expands, edits, saves, and restores a browser workspace", async () => {
  const score = new MockFileHandle("main.ly", "c4");
  const parts = new MockDirectoryHandle("parts").add(
    new MockFileHandle("cello.ily", "c2"),
  );
  const root = new MockDirectoryHandle("scores").add(parts).add(score);
  const handles = new MemoryHandleStore();
  const database = new MemoryDatabase();
  const sessions = createTabSessionStore(database);
  const makeRepository = () =>
    new FileSystemWorkspace({
      handleStore: handles,
      scope: {
        isSecureContext: true,
        showDirectoryPicker: async () =>
          root as unknown as FileSystemDirectoryHandle,
      },
      createWorkspaceId: () => "workspace-1",
    });

  const repository = makeRepository();
  const connected = await repository.connect();
  const rootEntries = await repository.listDirectory([]);
  const partEntries = await repository.listDirectory(["parts"]);

  expect(rootEntries.map((entry) => entry.name)).toEqual([
    "parts",
    "main.ly",
  ]);
  expect(partEntries.map((entry) => entry.name)).toEqual(["cello.ily"]);

  let state = createWorkspaceState(connected.workspaceId);
  state = openOrFocusFile(
    state,
    toOpenFile(await repository.readTextFile(["main.ly"])),
  );
  state = editFile(state, state.activeFileId!, "d4");
  expect(state.files[0].dirty).toBe(true);

  const file = state.files[0];
  const saved = await repository.writeFileHandle(
    file.pathSegments,
    file.handle,
    file.content,
    {
      content: file.savedContent,
      lastModified: file.lastModified,
      size: file.size,
    },
  );
  expect(saved.status).toBe("saved");
  if (saved.status !== "saved") {
    throw new Error("Expected the mock save to succeed.");
  }
  state = applySaveResult(state, file.id, {
    ok: true,
    content: saved.content,
    lastModified: saved.version.lastModified,
    size: saved.version.size,
  });
  expect(score.content).toBe("d4");
  expect(score.writeCount).toBe(1);
  expect(state.files[0].dirty).toBe(false);

  await sessions.save(serializeSessionMetadata(state)!);

  const recreatedRepository = makeRepository();
  expect((await recreatedRepository.restoreRemembered()).status)
    .toBe("connected");
  const metadata = await sessions.load("workspace-1");
  const restoredFiles = await Promise.all(
    metadata!.openFiles.map(async (item) =>
      toOpenFile(await recreatedRepository.readTextFile(item.pathSegments))
    ),
  );
  const restored = restoreSessionMetadata(metadata!, restoredFiles);

  expect(restored.activeFileId).toBe(file.id);
  expect(restored.files[0].content).toBe("d4");
  expect(restored.files[0].dirty).toBe(false);
});

test("creates an empty main file before adding and saving starter source", async () => {
  const root = new MockDirectoryHandle("scores");
  const repository = new FileSystemWorkspace({
    handleStore: new MemoryHandleStore(),
    scope: {
      isSecureContext: true,
      showDirectoryPicker: async () =>
        root as unknown as FileSystemDirectoryHandle,
    },
    createWorkspaceId: () => "workspace-create",
  });
  await repository.connect();

  const created = await repository.createTextFile(["main.ly"]);
  expect(created.status).toBe("created");
  expect(created.file.content).toBe("");
  const diskFile = root.children.get("main.ly") as MockFileHandle;
  expect(diskFile.content).toBe("");
  expect(diskFile.writeCount).toBe(0);

  const existing = await repository.createTextFile(["main.ly"]);
  expect(existing.status).toBe("exists");
  expect(existing.file.content).toBe("");

  let state = createWorkspaceState("workspace-create");
  state = openOrFocusFile(state, toOpenFile(created.file));
  state = editFile(state, created.file.id, "c4");
  expect(state.files[0].dirty).toBe(true);
  expect(diskFile.content).toBe("");

  const file = state.files[0];
  const saved = await repository.writeFileHandle(
    file.pathSegments,
    file.handle,
    file.content,
    {
      content: file.savedContent,
      lastModified: file.lastModified,
      size: file.size,
    },
  );
  expect(saved.status).toBe("saved");
  expect(diskFile.content).toBe("c4");
  expect(diskFile.writeCount).toBe(1);
});
