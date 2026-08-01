declare module "@napi-rs/wasm-runtime/fs" {
  export class Volume {}

  export type InMemoryFileSystem = import("@tybys/wasm-util").IFs & {
    mkdirSync(
      path: string,
      options?: { recursive?: boolean },
    ): string | undefined;
    readFileSync(path: string, encoding: "utf8"): string;
    readdirSync(path: string): string[];
    writeFileSync(
      path: string,
      data: string | ArrayBufferView,
    ): void;
  };

  export function createFsFromVolume(
    volume: Volume,
  ): InMemoryFileSystem;
}
