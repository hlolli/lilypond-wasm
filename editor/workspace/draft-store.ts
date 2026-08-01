import type { WorkspaceDatabase } from "./persistence";
import type { OpenFile } from "./workspace-state";
import { isFileDirty } from "./workspace-state";

export const EDITOR_DRAFT_STORE = "editor-drafts";

export type EditorDraftRecord = {
  workspaceId: string;
  fileId: string;
  path: string;
  pathSegments: string[];
  baseSavedContent: string;
  content: string;
  lastModified: number;
  updatedAt: number;
};

export type DraftStore = {
  load(workspaceId: string, path: string): Promise<EditorDraftRecord | null>;
  save(workspaceId: string, file: OpenFile): Promise<void>;
  discard(workspaceId: string, path: string): Promise<void>;
};

function draftKey(workspaceId: string, path: string) {
  return JSON.stringify([workspaceId, path]);
}

export function createDraftStore(
  database: WorkspaceDatabase,
  now: () => number = Date.now,
): DraftStore {
  return {
    async load(workspaceId, path) {
      const record = await database.get<EditorDraftRecord>(
        EDITOR_DRAFT_STORE,
        draftKey(workspaceId, path),
      );
      if (
        !record ||
        record.workspaceId !== workspaceId ||
        record.path !== path
      ) {
        return null;
      }
      return record;
    },

    async save(workspaceId, file) {
      const key = draftKey(workspaceId, file.path);
      if (!isFileDirty(file)) {
        await database.delete(EDITOR_DRAFT_STORE, key);
        return;
      }

      const record: EditorDraftRecord = {
        workspaceId,
        fileId: file.id,
        path: file.path,
        pathSegments: [...file.pathSegments],
        baseSavedContent: file.savedContent,
        content: file.content,
        lastModified: file.lastModified,
        updatedAt: now(),
      };
      await database.set(EDITOR_DRAFT_STORE, key, record);
    },

    discard(workspaceId, path) {
      return database.delete(
        EDITOR_DRAFT_STORE,
        draftKey(workspaceId, path),
      );
    },
  };
}

export function draftDiffersFromDisk(
  draft: EditorDraftRecord,
  diskContent: string,
) {
  return draft.content !== diskContent;
}
