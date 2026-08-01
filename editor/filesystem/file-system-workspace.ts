import {
  classifyWorkspaceFile,
  type WorkspaceFileType,
} from "./file-types";
import {
  mapWorkspaceError,
  WorkspaceError,
} from "./errors";
import type {
  WorkspaceHandlePersistence,
  WorkspaceHandleRecord,
} from "./handle-store";
import {
  assertValidWorkspacePath,
  pathToDisplay,
  pathToId,
  type WorkspacePath,
} from "./path-utils";

export type WorkspacePermissionState = PermissionState | "unavailable";

export type WorkspaceDescriptor = {
  workspaceId: string;
  name: string;
  handle: FileSystemDirectoryHandle;
};

export type WorkspaceSupport =
  | { supported: true }
  | { supported: false; message: string };

export type WorkspaceEntry =
  | {
      id: string;
      path: string[];
      name: string;
      kind: "directory";
    }
  | {
      id: string;
      path: string[];
      name: string;
      kind: "file";
      fileType: WorkspaceFileType;
    };

export type FileVersion = {
  lastModified: number;
  size: number;
  content: string;
};

export type ReadFileResult = {
  id: string;
  path: string[];
  name: string;
  handle: FileSystemFileHandle;
  content: string;
  version: FileVersion;
};

export type SavedFileResult = ReadFileResult & {
  status: "saved";
};

export type FileConflictResult = {
  status: "conflict";
  id: string;
  path: string[];
  name: string;
  handle: FileSystemFileHandle;
  expected: FileVersion;
  actual: {
    content: string;
    version: FileVersion;
  };
};

export type WriteFileResult = SavedFileResult | FileConflictResult;

export type CreateTextFileResult =
  | { status: "created"; file: ReadFileResult }
  | { status: "exists"; file: ReadFileResult };

export type CreateTextFileOptions = {
  requestPermission?: boolean;
};

export type WriteFileOptions = {
  force?: boolean;
  requestPermission?: boolean;
};

export type RestoreWorkspaceResult =
  | { status: "none" }
  | { status: "connected"; workspace: WorkspaceDescriptor }
  | {
      status: "permission-required";
      workspace: WorkspaceDescriptor;
    }
  | {
      status: "permission-denied";
      workspace: WorkspaceDescriptor;
    }
  | {
      status: "unavailable";
      workspace: WorkspaceDescriptor;
    }
  | {
      status: "invalid";
      error: WorkspaceError;
    };

type FileSystemHandleWithPermission = FileSystemHandle & {
  queryPermission?: (
    descriptor: { mode: "readwrite" },
  ) => Promise<PermissionState>;
  requestPermission?: (
    descriptor: { mode: "readwrite" },
  ) => Promise<PermissionState>;
};

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

type ComparableDirectoryHandle = FileSystemDirectoryHandle & {
  isSameEntry?: (other: FileSystemHandle) => Promise<boolean>;
};

export type FileSystemAccessScope = {
  isSecureContext?: boolean;
  showDirectoryPicker?: (
    options: { mode: "readwrite" },
  ) => Promise<FileSystemDirectoryHandle>;
};

export type FileSystemWorkspaceOptions = {
  scope?: FileSystemAccessScope;
  handleStore: WorkspaceHandlePersistence;
  createWorkspaceId?: () => string;
  now?: () => number;
};

const READ_WRITE_PERMISSION = { mode: "readwrite" } as const;

function defaultWorkspaceId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function workspaceDescriptor(
  record: WorkspaceHandleRecord,
): WorkspaceDescriptor {
  return {
    workspaceId: record.workspaceId,
    name: record.name,
    handle: record.handle,
  };
}

function compareEntries(left: WorkspaceEntry, right: WorkspaceEntry): number {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }
  const folded = left.name.localeCompare(right.name, "en", {
    sensitivity: "base",
    numeric: true,
  });
  return folded || left.name.localeCompare(right.name, "en");
}

export function getFileSystemAccessSupport(
  scope: FileSystemAccessScope = globalThis as FileSystemAccessScope,
): WorkspaceSupport {
  if (scope.isSecureContext !== true) {
    return {
      supported: false,
      message: "Folder access needs a secure browser page.",
    };
  }
  if (typeof scope.showDirectoryPicker !== "function") {
    return {
      supported: false,
      message: "This browser does not support local folder access.",
    };
  }
  return { supported: true };
}

export class FileSystemWorkspace {
  private readonly scope: FileSystemAccessScope;
  private readonly handleStore: WorkspaceHandlePersistence;
  private readonly createWorkspaceId: () => string;
  private readonly now: () => number;
  private record: WorkspaceHandleRecord | null = null;
  private recordPersisted = false;
  private persistenceWarning: WorkspaceError | null = null;

  constructor(options: FileSystemWorkspaceOptions) {
    this.scope = options.scope ??
      (globalThis as FileSystemAccessScope);
    this.handleStore = options.handleStore;
    this.createWorkspaceId = options.createWorkspaceId ?? defaultWorkspaceId;
    this.now = options.now ?? Date.now;
  }

  get support(): WorkspaceSupport {
    return getFileSystemAccessSupport(this.scope);
  }

  getWorkspace(): WorkspaceDescriptor | null {
    return this.record ? workspaceDescriptor(this.record) : null;
  }

  getWorkspaceId(): string | null {
    return this.record?.workspaceId ?? null;
  }

  takePersistenceWarning(): WorkspaceError | null {
    const warning = this.persistenceWarning;
    this.persistenceWarning = null;
    return warning;
  }

  async connect(): Promise<WorkspaceDescriptor> {
    const support = this.support;
    if (!support.supported) {
      throw new WorkspaceError("unsupported-browser", support.message);
    }

    try {
      const handle = await this.scope.showDirectoryPicker!.call(
        this.scope,
        { mode: "readwrite" },
      );
      let workspaceId: string | undefined;
      const previous = this.record;
      const comparable = handle as ComparableDirectoryHandle;
      if (previous && typeof comparable.isSameEntry === "function") {
        try {
          if (await comparable.isSameEntry(previous.handle)) {
            workspaceId = previous.workspaceId;
          }
        } catch {
          // A new workspace id is safe when handle comparison is unavailable.
        }
      }
      return await this.setRootHandle(handle, workspaceId);
    } catch (error) {
      throw mapWorkspaceError(error, "connect");
    }
  }

  async setRootHandle(
    handle: FileSystemDirectoryHandle,
    workspaceId = this.createWorkspaceId(),
  ): Promise<WorkspaceDescriptor> {
    if (handle.kind !== "directory") {
      throw new WorkspaceError(
        "invalid-handle",
        "The chosen handle is not a folder.",
      );
    }

    const record: WorkspaceHandleRecord = {
      workspaceId,
      name: handle.name,
      handle,
      savedAt: this.now(),
    };
    this.record = record;
    try {
      await this.handleStore.save(record);
      this.recordPersisted = true;
    } catch (error) {
      this.recordPersisted = false;
      this.persistenceWarning = mapWorkspaceError(error, "database");
      try {
        await this.handleStore.clear();
      } catch {
        // The persistence warning already tells the user this handle was not saved.
      }
    }
    return workspaceDescriptor(record);
  }

  async restoreRemembered(): Promise<RestoreWorkspaceResult> {
    let record: WorkspaceHandleRecord | null;
    try {
      record = await this.handleStore.load();
    } catch (error) {
      return {
        status: "invalid",
        error: mapWorkspaceError(error, "database"),
      };
    }

    if (!record) {
      return { status: "none" };
    }
    if (
      record.handle?.kind !== "directory" ||
      typeof record.workspaceId !== "string"
    ) {
      await this.handleStore.clear();
      return {
        status: "invalid",
        error: new WorkspaceError(
          "invalid-handle",
          "The saved folder handle is no longer valid.",
        ),
      };
    }

    this.record = record;
    this.recordPersisted = true;
    try {
      const permission = await this.getPermissionState();
      if (permission === "granted") {
        return {
          status: "connected",
          workspace: workspaceDescriptor(record),
        };
      }
      if (permission === "prompt") {
        return {
          status: "permission-required",
          workspace: workspaceDescriptor(record),
        };
      }
      if (permission === "denied") {
        return {
          status: "permission-denied",
          workspace: workspaceDescriptor(record),
        };
      }
      return {
        status: "unavailable",
        workspace: workspaceDescriptor(record),
      };
    } catch (error) {
      const mapped = mapWorkspaceError(error, "permission");
      if (
        mapped.code === "invalid-handle" ||
        mapped.code === "entry-not-found"
      ) {
        await this.handleStore.clear(record.workspaceId);
        this.record = null;
      }
      return { status: "invalid", error: mapped };
    }
  }

  async reconnect(): Promise<WorkspaceDescriptor> {
    if (!this.record) {
      this.record = await this.handleStore.load();
    }
    const record = this.requireRecord();
    const permissionHandle =
      record.handle as FileSystemHandleWithPermission;
    if (typeof permissionHandle.requestPermission !== "function") {
      throw new WorkspaceError(
        "unsupported-browser",
        "This browser cannot renew folder access.",
      );
    }

    try {
      const permission = await permissionHandle.requestPermission(
        READ_WRITE_PERMISSION,
      );
      if (permission === "granted") {
        record.savedAt = this.now();
        try {
          await this.handleStore.save(record);
          this.recordPersisted = true;
        } catch (error) {
          this.recordPersisted = false;
          this.persistenceWarning = mapWorkspaceError(error, "database");
        }
        return workspaceDescriptor(record);
      }
      throw new WorkspaceError(
        permission === "prompt"
          ? "permission-required"
          : "permission-denied",
        permission === "prompt"
          ? "The browser still needs folder access."
          : "The browser denied folder access.",
      );
    } catch (error) {
      throw mapWorkspaceError(error, "permission");
    }
  }

  async disconnect(): Promise<void> {
    const workspaceId = this.record?.workspaceId;
    try {
      if (this.recordPersisted) {
        await this.handleStore.clear(workspaceId);
      } else {
        try {
          await this.handleStore.clear();
        } catch (error) {
          this.persistenceWarning = mapWorkspaceError(error, "database");
        }
      }
    } catch (error) {
      this.persistenceWarning = mapWorkspaceError(error, "database");
    } finally {
      this.record = null;
      this.recordPersisted = false;
    }
  }

  async getRootHandle(): Promise<FileSystemDirectoryHandle | null> {
    return this.record?.handle ?? null;
  }

  async getPermissionState(): Promise<WorkspacePermissionState> {
    const handle =
      this.record?.handle as FileSystemHandleWithPermission | undefined;
    if (!handle || typeof handle.queryPermission !== "function") {
      return "unavailable";
    }
    try {
      return await handle.queryPermission(READ_WRITE_PERMISSION);
    } catch (error) {
      throw mapWorkspaceError(error, "permission");
    }
  }

  async listDirectory(path: WorkspacePath): Promise<WorkspaceEntry[]> {
    assertValidWorkspacePath(path, { allowRoot: true });
    const displayPath = pathToDisplay(path);
    try {
      const directory = await this.resolveDirectory(path);
      const entries: WorkspaceEntry[] = [];

      for await (
        const [name, handle] of (
          directory as IterableDirectoryHandle
        ).entries()
      ) {
        const entryPath = [...path, name];
        if (handle.kind === "directory") {
          entries.push({
            id: pathToId(entryPath),
            path: entryPath,
            name,
            kind: "directory",
          });
        } else if (handle.kind === "file") {
          entries.push({
            id: pathToId(entryPath),
            path: entryPath,
            name,
            kind: "file",
            fileType: classifyWorkspaceFile(name),
          });
        }
      }
      return entries.sort(compareEntries);
    } catch (error) {
      throw mapWorkspaceError(error, "list-directory", displayPath);
    }
  }

  async resolveFile(path: WorkspacePath): Promise<FileSystemFileHandle> {
    assertValidWorkspacePath(path);
    const displayPath = pathToDisplay(path);
    try {
      const parent = await this.resolveDirectory(path.slice(0, -1));
      return await parent.getFileHandle(path.at(-1)!);
    } catch (error) {
      throw mapWorkspaceError(error, "resolve-file", displayPath);
    }
  }

  async readTextFile(path: WorkspacePath): Promise<ReadFileResult> {
    assertValidWorkspacePath(path);
    const displayPath = pathToDisplay(path);
    const name = path.at(-1)!;
    if (!classifyWorkspaceFile(name).editable) {
      throw new WorkspaceError(
        "invalid-entry",
        `This file type cannot be opened as text: ${displayPath}`,
        { path: displayPath },
      );
    }

    try {
      const handle = await this.resolveFile(path);
      return await this.readFileHandle(path, handle);
    } catch (error) {
      throw mapWorkspaceError(error, "read-file", displayPath);
    }
  }

  async createTextFile(
    path: WorkspacePath,
    options: CreateTextFileOptions = {},
  ): Promise<CreateTextFileResult> {
    assertValidWorkspacePath(path);
    const displayPath = pathToDisplay(path);
    const name = path.at(-1)!;
    if (!classifyWorkspaceFile(name).editable) {
      throw new WorkspaceError(
        "invalid-entry",
        `Choose a supported text file extension for ${displayPath}.`,
        { path: displayPath },
      );
    }

    try {
      const resolvedParent = await this.resolveDirectoryWithPath(
        path.slice(0, -1),
      );
      const parent = resolvedParent.directory;
      try {
        const existingHandle = await parent.getFileHandle(name);
        const canonicalPath = [
          ...resolvedParent.path,
          existingHandle.name,
        ];
        return {
          status: "exists",
          file: await this.readFileHandle(
            canonicalPath,
            existingHandle,
          ),
        };
      } catch (error) {
        const mapped = mapWorkspaceError(
          error,
          "create-file",
          displayPath,
        );
        if (mapped.code !== "entry-not-found") {
          throw mapped;
        }
      }

      await this.ensureWritePermission(
        options.requestPermission ?? true,
      );
      const handle = await parent.getFileHandle(name, { create: true });
      const canonicalPath = [...resolvedParent.path, handle.name];
      const file = await this.readFileHandle(canonicalPath, handle);

      return {
        status: file.version.size > 0 ? "exists" : "created",
        file,
      };
    } catch (error) {
      throw mapWorkspaceError(error, "create-file", displayPath);
    }
  }

  async writeTextFile(
    path: WorkspacePath,
    content: string,
    expectedVersion?: FileVersion,
    options: WriteFileOptions = {},
  ): Promise<WriteFileResult> {
    const handle = await this.resolveFile(path);
    return this.writeFileHandle(
      path,
      handle,
      content,
      expectedVersion,
      options,
    );
  }

  async writeFileHandle(
    path: WorkspacePath,
    handle: FileSystemFileHandle,
    content: string,
    expectedVersion?: FileVersion,
    options: WriteFileOptions = {},
  ): Promise<WriteFileResult> {
    assertValidWorkspacePath(path);
    const displayPath = pathToDisplay(path);
    const name = path.at(-1)!;
    if (!classifyWorkspaceFile(name).editable) {
      throw new WorkspaceError(
        "invalid-entry",
        `This file type cannot be saved as text: ${displayPath}`,
        { path: displayPath },
      );
    }

    try {
      await this.ensureWritePermission(
        options.requestPermission ?? true,
      );
      const current = await this.readFileHandle(path, handle);
      if (
        expectedVersion &&
        !options.force &&
        this.hasExternalChange(expectedVersion, current.version)
      ) {
        return {
          status: "conflict",
          id: current.id,
          path: current.path,
          name: current.name,
          handle,
          expected: expectedVersion,
          actual: {
            content: current.content,
            version: current.version,
          },
        };
      }

      let writable: FileSystemWritableFileStream | undefined;
      try {
        writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
      } catch (error) {
        if (writable) {
          await writable.abort().catch(() => undefined);
        }
        throw error;
      }

      const saved = await this.readFileHandle(path, handle);
      return {
        status: "saved",
        ...saved,
      };
    } catch (error) {
      throw mapWorkspaceError(error, "write-file", displayPath);
    }
  }

  private requireRecord(): WorkspaceHandleRecord {
    if (!this.record) {
      throw new WorkspaceError(
        "permission-required",
        "Connect a folder first.",
      );
    }
    return this.record;
  }

  private async resolveDirectory(
    path: WorkspacePath,
  ): Promise<FileSystemDirectoryHandle> {
    return (await this.resolveDirectoryWithPath(path)).directory;
  }

  private async resolveDirectoryWithPath(
    path: WorkspacePath,
  ): Promise<{
    directory: FileSystemDirectoryHandle;
    path: string[];
  }> {
    assertValidWorkspacePath(path, { allowRoot: true });
    let directory = this.requireRecord().handle;
    const canonicalPath: string[] = [];
    for (const segment of path) {
      directory = await directory.getDirectoryHandle(segment);
      canonicalPath.push(directory.name);
    }
    return { directory, path: canonicalPath };
  }

  private async readFileHandle(
    path: WorkspacePath,
    handle: FileSystemFileHandle,
  ): Promise<ReadFileResult> {
    const file = await handle.getFile();
    const content = await file.text();
    return {
      id: pathToId(path),
      path: [...path],
      name: path.at(-1)!,
      handle,
      content,
      version: {
        lastModified: file.lastModified,
        size: file.size,
        content,
      },
    };
  }

  private hasExternalChange(
    expected: FileVersion,
    actual: FileVersion,
  ): boolean {
    if (expected.content !== actual.content) {
      return true;
    }
    if (expected.content.length > 0 || actual.content.length > 0) {
      return false;
    }
    return (
      expected.lastModified !== actual.lastModified ||
      expected.size !== actual.size
    );
  }

  private async ensureWritePermission(
    requestIfNeeded: boolean,
  ): Promise<void> {
    const record = this.requireRecord();
    const handle = record.handle as FileSystemHandleWithPermission;
    if (typeof handle.queryPermission !== "function") {
      return;
    }

    const current = await handle.queryPermission(READ_WRITE_PERMISSION);
    if (current === "granted") {
      return;
    }
    if (current === "denied") {
      throw new WorkspaceError(
        "permission-denied",
        "The browser denied folder access.",
      );
    }
    if (
      !requestIfNeeded ||
      typeof handle.requestPermission !== "function"
    ) {
      throw new WorkspaceError(
        "permission-required",
        "Reconnect the folder before saving.",
      );
    }

    const requested = await handle.requestPermission(READ_WRITE_PERMISSION);
    if (requested !== "granted") {
      throw new WorkspaceError(
        requested === "prompt"
          ? "permission-required"
          : "permission-denied",
        requested === "prompt"
          ? "Reconnect the folder before saving."
          : "The browser denied folder access.",
      );
    }
  }
}
