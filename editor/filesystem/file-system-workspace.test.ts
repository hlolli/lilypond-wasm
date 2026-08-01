import { describe, expect, test } from "bun:test";
import { WorkspaceError } from "./errors";
import {
  FileSystemWorkspace,
  getFileSystemAccessSupport,
} from "./file-system-workspace";
import type {
  WorkspaceHandlePersistence,
  WorkspaceHandleRecord,
} from "./handle-store";

class MemoryHandleStore implements WorkspaceHandlePersistence {
  record: WorkspaceHandleRecord | null = null;

  async load() {
    return this.record;
  }

  async save(record: WorkspaceHandleRecord) {
    this.record = record;
  }

  async clear(workspaceId?: string) {
    if (
      workspaceId === undefined ||
      this.record?.workspaceId === workspaceId
    ) {
      this.record = null;
    }
  }
}

class FailingHandleStore extends MemoryHandleStore {
  override async save(_record: WorkspaceHandleRecord) {
    throw new Error("IndexedDB unavailable");
  }
}

class MockFileHandle {
  readonly kind = "file";
  failWrite = false;
  abortCount = 0;
  writeCount = 0;
  content: string;
  lastModified: number;

  constructor(
    readonly name: string,
    content: string,
    lastModified = 10,
  ) {
    this.content = content;
    this.lastModified = lastModified;
  }

  async getFile() {
    return new File([this.content], this.name, {
      type: "text/plain",
      lastModified: this.lastModified,
    });
  }

  async createWritable() {
    let pending = this.content;
    return {
      write: async (value: string) => {
        this.writeCount += 1;
        if (this.failWrite) {
          throw new DOMException("write denied", "NotAllowedError");
        }
        pending = value;
      },
      close: async () => {
        this.content = pending;
        this.lastModified += 1;
      },
      abort: async () => {
        this.abortCount += 1;
      },
    } as unknown as FileSystemWritableFileStream;
  }

  changeExternally(content: string) {
    this.content = content;
    this.lastModified += 10;
  }
}

type MockEntry = MockDirectoryHandle | MockFileHandle;

class MockDirectoryHandle {
  readonly kind = "directory";
  readonly children = new Map<string, MockEntry>();
  queryCount = 0;
  requestCount = 0;
  createCount = 0;
  caseInsensitive = false;
  permission: PermissionState = "granted";
  requestedPermission: PermissionState = "granted";
  beforeCreate: ((name: string) => void) | null = null;
  createFailure: DOMException | null = null;

  constructor(readonly name: string) {}

  add(entry: MockEntry) {
    this.children.set(entry.name, entry);
    return this;
  }

  async getDirectoryHandle(name: string) {
    const entry = this.findEntry(name);
    if (!entry) {
      throw new DOMException("missing", "NotFoundError");
    }
    if (entry.kind !== "directory") {
      throw new DOMException("wrong type", "TypeMismatchError");
    }
    return entry as unknown as FileSystemDirectoryHandle;
  }

  async getFileHandle(
    name: string,
    options: { create?: boolean } = {},
  ) {
    let entry = this.findEntry(name);
    if (!entry && options.create) {
      this.createCount += 1;
      if (this.createFailure) {
        throw this.createFailure;
      }
      this.beforeCreate?.(name);
      entry = this.children.get(name);
      if (!entry) {
        entry = new MockFileHandle(name, "");
        this.children.set(name, entry);
      }
    }
    if (!entry) {
      throw new DOMException("missing", "NotFoundError");
    }
    if (entry.kind !== "file") {
      throw new DOMException("wrong type", "TypeMismatchError");
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

  async queryPermission(options: { mode: string }) {
    expect(options).toEqual({ mode: "readwrite" });
    this.queryCount += 1;
    return this.permission;
  }

  async requestPermission(options: { mode: string }) {
    expect(options).toEqual({ mode: "readwrite" });
    this.requestCount += 1;
    this.permission = this.requestedPermission;
    return this.requestedPermission;
  }

  async isSameEntry(other: FileSystemHandle) {
    return other === (this as unknown as FileSystemHandle);
  }

  private findEntry(name: string) {
    const direct = this.children.get(name);
    if (direct || !this.caseInsensitive) {
      return direct;
    }
    const foldedName = name.toLocaleLowerCase("en-US");
    return [...this.children.values()].find(
      (entry) =>
        entry.name.toLocaleLowerCase("en-US") === foldedName,
    );
  }
}

function makeWorkspace(
  root: MockDirectoryHandle,
  store = new MemoryHandleStore(),
) {
  let pickerOptions: { mode: "readwrite" } | undefined;
  const workspace = new FileSystemWorkspace({
    handleStore: store,
    scope: {
      isSecureContext: true,
      showDirectoryPicker: async (options) => {
        pickerOptions = options;
        return root as unknown as FileSystemDirectoryHandle;
      },
    },
    createWorkspaceId: () => "workspace-1",
    now: () => 123,
  });
  return {
    workspace,
    store,
    getPickerOptions: () => pickerOptions,
  };
}

describe("FileSystemWorkspace", () => {
  test("detects insecure and unsupported browsers", () => {
    expect(
      getFileSystemAccessSupport({
        isSecureContext: false,
        showDirectoryPicker: async () => {
          throw new Error("unused");
        },
      }).supported,
    ).toBe(false);
    expect(
      getFileSystemAccessSupport({ isSecureContext: true }).supported,
    ).toBe(false);
  });

  test("connects with read-write access and remembers the handle", async () => {
    const root = new MockDirectoryHandle("Scores");
    const { workspace, store, getPickerOptions } = makeWorkspace(root);

    const connected = await workspace.connect();

    expect(getPickerOptions()).toEqual({ mode: "readwrite" });
    expect(connected.workspaceId).toBe("workspace-1");
    expect(connected.name).toBe("Scores");
    expect(store.record?.handle).toBe(root);
    expect(store.record?.savedAt).toBe(123);
  });

  test("restores a remembered handle without prompting", async () => {
    const root = new MockDirectoryHandle("Scores");
    root.permission = "prompt";
    const setup = makeWorkspace(root);
    await setup.workspace.setRootHandle(
      root as unknown as FileSystemDirectoryHandle,
      "remembered",
    );
    const restored = makeWorkspace(root, setup.store).workspace;

    expect(await restored.restoreRemembered()).toMatchObject({
      status: "permission-required",
      workspace: { workspaceId: "remembered" },
    });
    expect(root.queryCount).toBe(1);
    expect(root.requestCount).toBe(0);

    expect((await restored.reconnect()).workspaceId).toBe("remembered");
    expect(root.requestCount).toBe(1);
  });

  test("reports denied, rejected, and unavailable remembered access", async () => {
    const deniedRoot = new MockDirectoryHandle("Denied");
    deniedRoot.permission = "denied";
    const deniedSetup = makeWorkspace(deniedRoot);
    await deniedSetup.workspace.setRootHandle(
      deniedRoot as unknown as FileSystemDirectoryHandle,
      "denied-workspace",
    );
    const deniedWorkspace = makeWorkspace(
      deniedRoot,
      deniedSetup.store,
    ).workspace;
    expect(await deniedWorkspace.restoreRemembered()).toMatchObject({
      status: "permission-denied",
    });

    deniedRoot.permission = "prompt";
    deniedRoot.requestedPermission = "denied";
    expect(await deniedWorkspace.restoreRemembered()).toMatchObject({
      status: "permission-required",
    });
    await expect(deniedWorkspace.reconnect()).rejects.toMatchObject({
      code: "permission-denied",
    });

    const unavailableHandle = {
      kind: "directory",
      name: "Unavailable",
    } as FileSystemDirectoryHandle;
    const unavailableStore = new MemoryHandleStore();
    unavailableStore.record = {
      workspaceId: "unavailable-workspace",
      name: unavailableHandle.name,
      handle: unavailableHandle,
      savedAt: 1,
    };
    const unavailableWorkspace = new FileSystemWorkspace({
      handleStore: unavailableStore,
      scope: {
        isSecureContext: true,
        showDirectoryPicker: async () => unavailableHandle,
      },
    });
    expect(await unavailableWorkspace.restoreRemembered()).toMatchObject({
      status: "unavailable",
    });
  });

  test("keeps the workspace id when the same folder is picked again", async () => {
    const root = new MockDirectoryHandle("Scores");
    const setup = makeWorkspace(root);
    await setup.workspace.setRootHandle(
      root as unknown as FileSystemDirectoryHandle,
      "remembered",
    );
    const restored = makeWorkspace(root, setup.store).workspace;
    expect((await restored.restoreRemembered()).status).toBe("connected");

    const connected = await restored.connect();

    expect(connected.workspaceId).toBe("remembered");
  });

  test("keeps a chosen folder usable when handle storage fails", async () => {
    const root = new MockDirectoryHandle("Scores");
    const { workspace } = makeWorkspace(root, new FailingHandleStore());

    const connected = await workspace.connect();

    expect(connected.name).toBe("Scores");
    expect(workspace.getWorkspace()?.handle).toBe(root);
    expect(workspace.takePersistenceWarning()?.code).toBe("database-failed");
    await expect(workspace.disconnect()).resolves.toBeUndefined();
    expect(workspace.getWorkspace()).toBeNull();
  });

  test("a failed new handle save does not leave an older handle remembered", async () => {
    const oldRoot = new MockDirectoryHandle("Old");
    const newRoot = new MockDirectoryHandle("New");
    const store = new FailingHandleStore();
    store.record = {
      workspaceId: "old-workspace",
      name: oldRoot.name,
      handle: oldRoot as unknown as FileSystemDirectoryHandle,
      savedAt: 1,
    };
    const { workspace } = makeWorkspace(newRoot, store);

    expect((await workspace.restoreRemembered()).status).toBe("connected");
    expect((await workspace.connect()).name).toBe("New");
    expect(store.record).toBeNull();

    await workspace.disconnect();

    expect(store.record).toBeNull();
  });

  test("lists directories first, then files by name", async () => {
    const root = new MockDirectoryHandle("Scores")
      .add(new MockFileHandle("zeta.ly", "z"))
      .add(new MockFileHandle("Alpha.md", "a"))
      .add(new MockDirectoryHandle("parts"))
      .add(new MockFileHandle("audio.wav", "binary"));
    const { workspace } = makeWorkspace(root);
    await workspace.connect();

    const entries = await workspace.listDirectory([]);

    expect(entries.map((entry) => entry.name)).toEqual([
      "parts",
      "Alpha.md",
      "audio.wav",
      "zeta.ly",
    ]);
    expect(entries[2]).toMatchObject({
      kind: "file",
      fileType: { kind: "unsupported", editable: false },
    });
  });

  test("reads a file and blocks an external overwrite", async () => {
    const score = new MockFileHandle("score.ly", "c4");
    const root = new MockDirectoryHandle("Scores").add(score);
    const { workspace } = makeWorkspace(root);
    await workspace.connect();
    const opened = await workspace.readTextFile(["score.ly"]);

    score.changeExternally("d4");
    const conflict = await workspace.writeFileHandle(
      ["score.ly"],
      opened.handle,
      "e4",
      opened.version,
    );

    expect(conflict).toMatchObject({
      status: "conflict",
      actual: { content: "d4" },
    });
    expect(score.writeCount).toBe(0);

    const saved = await workspace.writeFileHandle(
      ["score.ly"],
      opened.handle,
      "e4",
      opened.version,
      { force: true },
    );
    expect(saved.status).toBe("saved");
    expect(score.content).toBe("e4");
  });

  test("creates an empty root text file without opening a writable stream", async () => {
    const root = new MockDirectoryHandle("Scores");
    const { workspace } = makeWorkspace(root);
    await workspace.connect();

    const result = await workspace.createTextFile(["main.ly"]);

    expect(result.status).toBe("created");
    expect(result.file).toMatchObject({
      path: ["main.ly"],
      name: "main.ly",
      content: "",
    });
    expect(root.createCount).toBe(1);
    expect(
      (root.children.get("main.ly") as MockFileHandle).writeCount,
    ).toBe(0);
  });

  test("creates a text file inside an existing folder", async () => {
    const parts = new MockDirectoryHandle("parts");
    const root = new MockDirectoryHandle("Scores").add(parts);
    const { workspace } = makeWorkspace(root);
    await workspace.connect();

    const result = await workspace.createTextFile([
      "parts",
      "violin.ily",
    ]);

    expect(result.status).toBe("created");
    expect(result.file.path).toEqual(["parts", "violin.ily"]);
    expect(parts.children.has("violin.ily")).toBe(true);
  });

  test("opens an existing file without changing it", async () => {
    const score = new MockFileHandle("main.ly", "c4");
    const root = new MockDirectoryHandle("Scores").add(score);
    const { workspace } = makeWorkspace(root);
    await workspace.connect();

    const result = await workspace.createTextFile(["main.ly"]);

    expect(result.status).toBe("exists");
    expect(result.file.content).toBe("c4");
    expect(score.writeCount).toBe(0);
    expect(root.createCount).toBe(0);
  });

  test("returns the canonical path for a case-variant existing file", async () => {
    const score = new MockFileHandle("violin.ily", "c4");
    const parts = new MockDirectoryHandle("parts").add(score);
    parts.caseInsensitive = true;
    const root = new MockDirectoryHandle("Scores").add(parts);
    root.caseInsensitive = true;
    const { workspace } = makeWorkspace(root);
    await workspace.connect();

    const result = await workspace.createTextFile([
      "PARTS",
      "VIOLIN.ILY",
    ]);

    expect(result.status).toBe("exists");
    expect(result.file.path).toEqual(["parts", "violin.ily"]);
    expect(result.file.id).toBe('["parts","violin.ily"]');
    expect(result.file.name).toBe("violin.ily");
    expect(score.writeCount).toBe(0);
  });

  test("rejects unsupported files and missing parent folders", async () => {
    const root = new MockDirectoryHandle("Scores");
    const { workspace } = makeWorkspace(root);
    await workspace.connect();

    await expect(
      workspace.createTextFile(["score.pdf"]),
    ).rejects.toMatchObject({ code: "invalid-entry" });
    await expect(
      workspace.createTextFile(["parts", "violin.ly"]),
    ).rejects.toMatchObject({ code: "entry-not-found" });
    expect(root.createCount).toBe(0);
  });

  test("rejects a folder with the requested file name", async () => {
    const root = new MockDirectoryHandle("Scores")
      .add(new MockDirectoryHandle("main.ly"));
    const { workspace } = makeWorkspace(root);
    await workspace.connect();

    await expect(
      workspace.createTextFile(["main.ly"]),
    ).rejects.toMatchObject({ code: "invalid-entry" });
    expect(root.createCount).toBe(0);
  });

  test("maps a failed create to a file write error", async () => {
    const root = new MockDirectoryHandle("Scores");
    root.createFailure = new DOMException("disk failure", "UnknownError");
    const { workspace } = makeWorkspace(root);
    await workspace.connect();

    await expect(
      workspace.createTextFile(["main.ly"]),
    ).rejects.toMatchObject({ code: "file-write-failed" });
    expect(root.createCount).toBe(1);
  });

  test("requires write permission before creating a file", async () => {
    const root = new MockDirectoryHandle("Scores");
    root.permission = "prompt";
    root.requestedPermission = "denied";
    const { workspace } = makeWorkspace(root);
    await workspace.setRootHandle(
      root as unknown as FileSystemDirectoryHandle,
    );

    await expect(
      workspace.createTextFile(["main.ly"]),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(root.requestCount).toBe(1);
    expect(root.createCount).toBe(0);
  });

  test("does not truncate a file created during a create race", async () => {
    const root = new MockDirectoryHandle("Scores");
    const racedFile = new MockFileHandle("main.ly", "external");
    root.beforeCreate = (name) => {
      root.add(racedFile);
      expect(name).toBe("main.ly");
    };
    const { workspace } = makeWorkspace(root);
    await workspace.connect();

    const result = await workspace.createTextFile(["main.ly"]);

    expect(result.status).toBe("exists");
    expect(result.file.content).toBe("external");
    expect(racedFile.writeCount).toBe(0);
  });

  test("aborts a failed direct write and keeps a clear error code", async () => {
    const score = new MockFileHandle("score.ly", "c4");
    score.failWrite = true;
    const root = new MockDirectoryHandle("Scores").add(score);
    const { workspace } = makeWorkspace(root);
    await workspace.connect();
    const opened = await workspace.readTextFile(["score.ly"]);

    let caught: unknown;
    try {
      await workspace.writeFileHandle(
        ["score.ly"],
        opened.handle,
        "d4",
        opened.version,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WorkspaceError);
    expect((caught as WorkspaceError).code).toBe("permission-denied");
    expect(score.abortCount).toBe(1);
    expect(score.content).toBe("c4");
  });
});
