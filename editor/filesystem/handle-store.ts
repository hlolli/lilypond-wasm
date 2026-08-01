import type { WorkspaceDatabaseApi } from "./database";

export const ACTIVE_WORKSPACE_KEY = "active";

export type WorkspaceHandleRecord = {
  workspaceId: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  savedAt: number;
};

export interface WorkspaceHandlePersistence {
  load(): Promise<WorkspaceHandleRecord | null>;
  save(record: WorkspaceHandleRecord): Promise<void>;
  clear(workspaceId?: string): Promise<void>;
}

export class WorkspaceHandleStore implements WorkspaceHandlePersistence {
  constructor(private readonly database: WorkspaceDatabaseApi) {}

  async load(): Promise<WorkspaceHandleRecord | null> {
    return (
      (await this.database.get<WorkspaceHandleRecord>(
        "workspace-handles",
        ACTIVE_WORKSPACE_KEY,
      )) ?? null
    );
  }

  async save(record: WorkspaceHandleRecord): Promise<void> {
    await this.database.set(
      "workspace-handles",
      ACTIVE_WORKSPACE_KEY,
      record,
    );
  }

  async clear(workspaceId?: string): Promise<void> {
    if (workspaceId !== undefined) {
      const record = await this.load();
      if (record?.workspaceId !== workspaceId) {
        return;
      }
    }
    await this.database.delete("workspace-handles", ACTIVE_WORKSPACE_KEY);
  }
}
