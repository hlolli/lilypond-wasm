export interface WorkspaceDatabase {
  get<T>(storeName: string, key: string): Promise<T | undefined>;
  set<T>(storeName: string, key: string, value: T): Promise<void>;
  delete(storeName: string, key: string): Promise<void>;
}
