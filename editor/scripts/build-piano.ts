import { commands, type Tree } from "@yowasp/clang";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const globalBase = 128 * 1024 * 1024;
const tableBase = 4096;
const hostTableEntries = 3837;

function leb(value: number): number[] {
  const bytes: number[] = [];
  do {
    const byte = value % 128;
    value = Math.floor(value / 128);
    bytes.push(byte | (value ? 128 : 0));
  } while (value);
  return bytes;
}

export async function buildPiano(outputRoot: string) {
  const root = resolve(import.meta.dir, "..");
  const sourceRoot = resolve(root, "plugins/hlolli_wg_piano");
  const manifest = await Bun.file(resolve(sourceRoot, "manifest.json")).json();
  const source = await Bun.file(resolve(sourceRoot, "hlolli_wg_piano.c")).text();
  if (createHash("sha256").update(source).digest("hex") !== manifest.source_sha256) {
    throw new Error("Piano source does not match its pinned manifest");
  }
  const sdkRoot = resolve(root, "node_modules/@csound/wasm-bin/lib");
  const host = await WebAssembly.compile(await Bun.file(resolve(sdkRoot, "csound.wasm")).arrayBuffer());
  type SizedImport = WebAssembly.ModuleImportDescriptor & { type?: { minimum: number } };
  type SizedExport = WebAssembly.ModuleExportDescriptor & { type?: { minimum: number } };
  const table = (WebAssembly.Module.exports(host) as SizedExport[]).find(item => item.kind === "table");
  if (table?.type?.minimum !== hostTableEntries) throw new Error("Csound host table changed; update the piano build layout");

  const archive = Bun.gunzipSync(new Uint8Array(await Bun.file(resolve(sdkRoot, "csound-plugin-sdk.tar.gz")).arrayBuffer()));
  const headers: Tree = {};
  const decoder = new TextDecoder();
  const field = (start: number, length: number) => decoder.decode(archive.subarray(start, start + length)).split("\0")[0]!;
  for (let offset = 0; offset + 512 <= archive.length;) {
    const name = field(offset, 100);
    if (!name) break;
    const size = parseInt(field(offset + 124, 12).trim(), 8) || 0;
    const prefix = "csound-plugin-sdk/include/csound/";
    if (name.startsWith(prefix) && !name.slice(prefix.length).includes("/") && size) {
      headers[name.slice(prefix.length)] = archive.slice(offset + 512, offset + 512 + size);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!headers["csdl.h"]) throw new Error("Csound plugin headers are missing");
  const files = await commands.clang([
    "-O2", "-fPIC", "-fno-exceptions", "-mllvm", "-wasm-enable-sjlj",
    "-D__wasi__=1", "-D__wasm32__=1", "-DUSE_DOUBLE=1",
    "-D_WASI_EMULATED_SIGNAL=1", "-D_WASI_EMULATED_MMAN=1", "-Iinclude",
    "-nostartfiles", "-Wl,-z,stack-size=131072",
    `-Wl,--global-base=${globalBase}`, `-Wl,--table-base=${tableBase}`,
    "-Wl,--no-stack-first", "-Wl,--import-table", "-Wl,--import-memory",
    "-Wl,--no-entry", "-Wl,--export=__wasm_call_ctors", "-Wl,--export=csound_opcode_init",
    "-lwasi-emulated-signal", "-lwasi-emulated-mman", "piano.c", "-o", "piano.wasm",
  ], { "piano.c": source, include: headers }, { decodeASCII: false, fetchProgress: () => {} }) as Tree;
  const wasm = files["piano.wasm"];
  if (!(wasm instanceof Uint8Array)) throw new Error("Piano compiler produced no WASM");
  const module = await WebAssembly.compile(wasm);
  const imports = WebAssembly.Module.imports(module) as SizedImport[];
  const memory = imports.find(item => item.kind === "memory")?.type?.minimum;
  const functions = imports.find(item => item.kind === "table")?.type?.minimum;
  if (!memory || !functions || imports.some(item => item.module !== "env")) {
    throw new Error("Piano plugin has an unsupported memory, table, or host import");
  }
  // The pinned Csound loader reads this dylink section to grow shared memory/table.
  const payload = [6, ...new TextEncoder().encode("dylink"),
    ...leb(memory * 65536 - globalBase), 0, ...leb(functions - hostTableEntries), 0, 0];
  const section = new Uint8Array([0, ...leb(payload.length), ...payload]);
  const output = new Uint8Array(wasm.length + section.length);
  output.set(wasm.subarray(0, 8));
  output.set(section, 8);
  output.set(wasm.subarray(8), 8 + section.length);
  await Bun.write(resolve(outputRoot, "plugins/hlolli_wg_piano.wasm"), output);
  console.log(`Built hlolli_wg_piano ${manifest.revision.slice(0, 7)} (${output.length} bytes)`);
}
