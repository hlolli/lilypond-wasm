import type { WorkspaceDatabase } from "./persistence";
import type { WorkspaceSessionMetadata } from "./workspace-state";

export const WORKSPACE_SESSION_STORE = "workspace-session";

export type WorkspaceSessionRecord = {
  workspaceId: string;
  metadata: WorkspaceSessionMetadata;
  updatedAt: number;
};

export type TabSessionStore = {
  load(workspaceId: string): Promise<WorkspaceSessionMetadata | null>;
  save(metadata: WorkspaceSessionMetadata): Promise<void>;
  clear(workspaceId: string): Promise<void>;
};

export function createTabSessionStore(
  database: WorkspaceDatabase,
  now: () => number = Date.now,
): TabSessionStore {
  return {
    async load(workspaceId) {
      const record = await database.get<WorkspaceSessionRecord>(
        WORKSPACE_SESSION_STORE,
        workspaceId,
      );
      if (
        !record ||
        record.workspaceId !== workspaceId ||
        record.metadata.version !== 1 ||
        record.metadata.workspaceId !== workspaceId
      ) {
        return null;
      }

      return record.metadata;
    },

    async save(metadata) {
      const record: WorkspaceSessionRecord = {
        workspaceId: metadata.workspaceId,
        metadata,
        updatedAt: now(),
      };
      await database.set(
        WORKSPACE_SESSION_STORE,
        metadata.workspaceId,
        record,
      );
    },

    clear(workspaceId) {
      return database.delete(WORKSPACE_SESSION_STORE, workspaceId);
    },
  };
}
