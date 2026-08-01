export type OpenFile = {
  id: string;
  path: string;
  name: string;
  handle: FileSystemFileHandle;
  savedContent: string;
  content: string;
  dirty: boolean;
  lastModified: number;
  size: number;
  pathSegments: string[];
};

export type WorkspaceState = {
  workspaceId: string | null;
  files: OpenFile[];
  activeFileId: string | null;
};

export type CloseFileResult =
  | {
      state: WorkspaceState;
      closed: true;
      file: OpenFile;
    }
  | {
      state: WorkspaceState;
      closed: false;
      reason: "dirty" | "not-found";
      file?: OpenFile;
    };

export type FileSaveResult =
  | {
      ok: true;
      content: string;
      lastModified: number;
      size: number;
    }
  | {
      ok: false;
      error: unknown;
    };

export type DiskFileSnapshot = {
  content: string;
  lastModified: number;
  size: number;
};

export type SessionFileMetadata = {
  id: string;
  path: string;
  name: string;
  pathSegments: string[];
};

export type WorkspaceSessionMetadata = {
  version: 1;
  workspaceId: string;
  openFiles: SessionFileMetadata[];
  activeFilePath: string | null;
};

function normalizeFile(file: OpenFile): OpenFile {
  return {
    ...file,
    pathSegments: [...file.pathSegments],
    dirty: file.content !== file.savedContent,
  };
}

function updateFile(
  state: WorkspaceState,
  fileId: string,
  update: (file: OpenFile) => OpenFile,
): WorkspaceState {
  const index = state.files.findIndex((file) => file.id === fileId);
  if (index === -1) {
    return state;
  }

  const files = [...state.files];
  files[index] = update(files[index]);
  return { ...state, files };
}

export function createWorkspaceState(
  workspaceId: string | null = null,
): WorkspaceState {
  return {
    workspaceId,
    files: [],
    activeFileId: null,
  };
}

export function isFileDirty(file: Pick<OpenFile, "content" | "savedContent">) {
  return file.content !== file.savedContent;
}

export function getDirtyFiles(state: WorkspaceState) {
  return state.files.filter(isFileDirty);
}

export function hasDirtyFiles(state: WorkspaceState) {
  return state.files.some(isFileDirty);
}

export function getActiveFile(state: WorkspaceState) {
  return state.files.find((file) => file.id === state.activeFileId) ?? null;
}

export function openOrFocusFile(
  state: WorkspaceState,
  file: OpenFile,
): WorkspaceState {
  const openFile = state.files.find(
    (candidate) => candidate.id === file.id || candidate.path === file.path,
  );
  if (openFile) {
    return focusFile(state, openFile.id);
  }

  const nextFile = normalizeFile(file);
  return {
    ...state,
    files: [...state.files, nextFile],
    activeFileId: nextFile.id,
  };
}

export function focusFile(
  state: WorkspaceState,
  fileId: string,
): WorkspaceState {
  if (
    state.activeFileId === fileId ||
    !state.files.some((file) => file.id === fileId)
  ) {
    return state;
  }
  return { ...state, activeFileId: fileId };
}

export function editFile(
  state: WorkspaceState,
  fileId: string,
  content: string,
): WorkspaceState {
  return updateFile(state, fileId, (file) => ({
    ...file,
    content,
    dirty: content !== file.savedContent,
  }));
}

export function closeFile(
  state: WorkspaceState,
  fileId: string,
  options: { discardChanges?: boolean } = {},
): CloseFileResult {
  const index = state.files.findIndex((file) => file.id === fileId);
  if (index === -1) {
    return { state, closed: false, reason: "not-found" };
  }

  const file = state.files[index];
  if (isFileDirty(file) && !options.discardChanges) {
    return { state, closed: false, reason: "dirty", file };
  }

  const files = state.files.filter((candidate) => candidate.id !== fileId);
  let activeFileId = state.activeFileId;
  if (activeFileId === fileId) {
    activeFileId = files[Math.min(index, files.length - 1)]?.id ?? null;
  }

  return {
    state: { ...state, files, activeFileId },
    closed: true,
    file,
  };
}

export function applySaveResult(
  state: WorkspaceState,
  fileId: string,
  result: FileSaveResult,
): WorkspaceState {
  if (!result.ok) {
    return applySaveFailure(state);
  }

  return applySaveSuccess(state, fileId, result);
}

export function applySaveSuccess(
  state: WorkspaceState,
  fileId: string,
  snapshot: DiskFileSnapshot,
): WorkspaceState {
  return updateFile(state, fileId, (file) => ({
    ...file,
    savedContent: snapshot.content,
    dirty: file.content !== snapshot.content,
    lastModified: snapshot.lastModified,
    size: snapshot.size,
  }));
}

export function applySaveFailure(state: WorkspaceState): WorkspaceState {
  return state;
}

export function reloadFile(
  state: WorkspaceState,
  fileId: string,
  snapshot: DiskFileSnapshot,
): WorkspaceState {
  return updateFile(state, fileId, (file) => ({
    ...file,
    savedContent: snapshot.content,
    content: snapshot.content,
    dirty: false,
    lastModified: snapshot.lastModified,
    size: snapshot.size,
  }));
}

export function restoreFileDraft(
  state: WorkspaceState,
  fileId: string,
  draft: { path: string; content: string },
): WorkspaceState {
  return updateFile(state, fileId, (file) => {
    if (file.path !== draft.path) {
      return file;
    }

    return {
      ...file,
      content: draft.content,
      dirty: draft.content !== file.savedContent,
    };
  });
}

export function serializeSessionMetadata(
  state: WorkspaceState,
): WorkspaceSessionMetadata | null {
  if (!state.workspaceId) {
    return null;
  }

  return {
    version: 1,
    workspaceId: state.workspaceId,
    openFiles: state.files.map(({ id, path, name, pathSegments }) => ({
      id,
      path,
      name,
      pathSegments: [...pathSegments],
    })),
    activeFilePath:
      state.files.find((file) => file.id === state.activeFileId)?.path ?? null,
  };
}

export function restoreSessionMetadata(
  metadata: WorkspaceSessionMetadata,
  resolvedFiles: Iterable<OpenFile>,
): WorkspaceState {
  const filesByPath = new Map<string, OpenFile>();
  for (const file of resolvedFiles) {
    filesByPath.set(file.path, normalizeFile(file));
  }

  const seenPaths = new Set<string>();
  const files: OpenFile[] = [];
  for (const item of metadata.openFiles) {
    if (seenPaths.has(item.path)) {
      continue;
    }

    const file = filesByPath.get(item.path);
    if (!file) {
      continue;
    }

    seenPaths.add(item.path);
    files.push(file);
  }

  const activeFile =
    files.find((file) => file.path === metadata.activeFilePath) ?? files[0];
  return {
    workspaceId: metadata.workspaceId,
    files,
    activeFileId: activeFile?.id ?? null,
  };
}
