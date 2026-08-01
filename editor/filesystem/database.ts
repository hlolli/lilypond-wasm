import { mapWorkspaceError, WorkspaceError } from "./errors";

export const WORKSPACE_DATABASE_NAME = "hlolli-lilypond-workspace";
export const WORKSPACE_DATABASE_VERSION = 1;

export const WORKSPACE_STORE_NAMES = [
  "workspace-handles",
  "workspace-session",
  "editor-drafts",
] as const;

export type WorkspaceStoreName = (typeof WORKSPACE_STORE_NAMES)[number];

export type WorkspaceScopedRecord = {
  workspaceId: string;
};

export interface WorkspaceDatabaseApi {
  get<T>(storeName: string, key: string): Promise<T | undefined>;
  set<T>(
    storeName: string,
    key: string,
    value: T,
  ): Promise<void>;
  delete(storeName: string, key: string): Promise<void>;
}

type WorkspaceDatabaseOptions = {
  name?: string;
  indexedDB?: IDBFactory;
};

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed.")),
      { once: true },
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () =>
        reject(
          transaction.error ?? new Error("IndexedDB transaction aborted."),
        ),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () =>
        reject(
          transaction.error ?? new Error("IndexedDB transaction failed."),
        ),
      { once: true },
    );
  });
}

function assertStoreName(
  storeName: string,
): asserts storeName is WorkspaceStoreName {
  if (!WORKSPACE_STORE_NAMES.includes(storeName as WorkspaceStoreName)) {
    throw new WorkspaceError(
      "database-failed",
      `Unknown workspace store: ${storeName}`,
    );
  }
}

export class WorkspaceDatabase implements WorkspaceDatabaseApi {
  readonly name: string;
  readonly version = WORKSPACE_DATABASE_VERSION;

  private readonly factory: IDBFactory | undefined;
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(options: WorkspaceDatabaseOptions = {}) {
    this.name = options.name ?? WORKSPACE_DATABASE_NAME;
    this.factory = options.indexedDB ?? globalThis.indexedDB;
  }

  async get<T>(
    storeName: string,
    key: string,
  ): Promise<T | undefined> {
    assertStoreName(storeName);
    try {
      const database = await this.open();
      const transaction = database.transaction(storeName, "readonly");
      const done = transactionDone(transaction);
      const result = await requestResult(
        transaction.objectStore(storeName).get(key),
      );
      await done;
      return result as T | undefined;
    } catch (error) {
      throw mapWorkspaceError(error, "database");
    }
  }

  async set<T>(
    storeName: string,
    key: string,
    value: T,
  ): Promise<void> {
    assertStoreName(storeName);
    try {
      const database = await this.open();
      const transaction = database.transaction(storeName, "readwrite");
      const done = transactionDone(transaction);
      await requestResult(transaction.objectStore(storeName).put(value, key));
      await done;
    } catch (error) {
      throw mapWorkspaceError(error, "database");
    }
  }

  async delete(
    storeName: string,
    key: string,
  ): Promise<void> {
    assertStoreName(storeName);
    try {
      const database = await this.open();
      const transaction = database.transaction(storeName, "readwrite");
      const done = transactionDone(transaction);
      await requestResult(transaction.objectStore(storeName).delete(key));
      await done;
    } catch (error) {
      throw mapWorkspaceError(error, "database");
    }
  }

  async getAll<T>(storeName: string): Promise<T[]> {
    assertStoreName(storeName);
    try {
      const database = await this.open();
      const transaction = database.transaction(storeName, "readonly");
      const done = transactionDone(transaction);
      const records = await requestResult(
        transaction.objectStore(storeName).getAll(),
      );
      await done;
      return records as T[];
    } catch (error) {
      throw mapWorkspaceError(error, "database");
    }
  }

  async getAllByWorkspaceId<T extends WorkspaceScopedRecord>(
    storeName: WorkspaceStoreName,
    workspaceId: string,
  ): Promise<T[]> {
    assertStoreName(storeName);
    try {
      const database = await this.open();
      const transaction = database.transaction(storeName, "readonly");
      const done = transactionDone(transaction);
      const records = await requestResult(
        transaction
          .objectStore(storeName)
          .index("workspaceId")
          .getAll(workspaceId),
      );
      await done;
      return records as T[];
    } catch (error) {
      throw mapWorkspaceError(error, "database");
    }
  }

  async deleteByWorkspaceId(
    storeName: WorkspaceStoreName,
    workspaceId: string,
  ): Promise<void> {
    assertStoreName(storeName);
    try {
      const database = await this.open();
      const transaction = database.transaction(storeName, "readwrite");
      const done = transactionDone(transaction);
      const index = transaction.objectStore(storeName).index("workspaceId");
      const cursorRequest = index.openKeyCursor(workspaceId);

      await new Promise<void>((resolve, reject) => {
        cursorRequest.addEventListener("error", () => {
          reject(
            cursorRequest.error ??
              new Error("Could not scan workspace records."),
          );
        });
        cursorRequest.addEventListener("success", () => {
          const cursor = cursorRequest.result;
          if (!cursor) {
            resolve();
            return;
          }
          transaction.objectStore(storeName).delete(cursor.primaryKey);
          cursor.continue();
        });
      });
      await done;
    } catch (error) {
      throw mapWorkspaceError(error, "database");
    }
  }

  close(): void {
    if (!this.databasePromise) {
      return;
    }
    void this.databasePromise.then((database) => database.close());
    this.databasePromise = null;
  }

  private open(): Promise<IDBDatabase> {
    if (!this.factory) {
      return Promise.reject(
        new WorkspaceError(
          "unsupported-browser",
          "This browser cannot save folder access.",
        ),
      );
    }
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = this.factory!.open(this.name, this.version);

        request.addEventListener("upgradeneeded", () => {
          const database = request.result;
          for (const storeName of WORKSPACE_STORE_NAMES) {
            const store = database.objectStoreNames.contains(storeName)
              ? request.transaction!.objectStore(storeName)
              : database.createObjectStore(storeName);
            if (!store.indexNames.contains("workspaceId")) {
              store.createIndex("workspaceId", "workspaceId", {
                unique: false,
              });
            }
          }
        });
        request.addEventListener(
          "success",
          () => {
            const database = request.result;
            database.addEventListener("versionchange", () => {
              database.close();
              this.databasePromise = null;
            });
            resolve(database);
          },
          { once: true },
        );
        request.addEventListener(
          "error",
          () =>
            reject(
              request.error ?? new Error("Could not open workspace storage."),
            ),
          { once: true },
        );
        request.addEventListener(
          "blocked",
          () =>
            reject(
              new Error(
                "Close other tabs before updating workspace storage.",
              ),
            ),
          { once: true },
        );
      });
    }
    return this.databasePromise;
  }
}
