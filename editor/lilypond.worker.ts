/// <reference lib="webworker" />

import {
  guileVersion,
  lilypondVersion,
  runtimeEnvironment,
  runtimeMountOrder,
  runtimeRequirements,
} from "@hlolli/lilypond-wasm";
import { Volume, createFsFromVolume } from "@napi-rs/wasm-runtime/fs";
import { WASI } from "@tybys/wasm-util";

type RuntimeFile = {
  guestPath: string;
  offset: number;
  length: number;
};

type RuntimeFilesManifest = {
  schemaVersion: 1;
  compression: "gzip";
  uncompressedBytes: number;
  files: RuntimeFile[];
};

type RenderRequest = {
  type: "render";
  requestId: number;
  source: string;
  inputPath?: string[];
  workspaceRoot?: FileSystemDirectoryHandle;
  openBuffers?: Array<{
    path: string[];
    content: string;
  }>;
};

const worker = self as unknown as DedicatedWorkerGlobalScope;
const lilypondWasmUrl = new URL("./dist/lilypond.wasm", worker.location.href);
const textEncoder = new TextEncoder();
const workspaceFileLimit = 2_500;
const workspaceByteLimit = 128 * 1024 * 1024;
const workspaceDirectoryLimit = 5_000;
const workspaceDepthLimit = 64;
const ignoredWorkspaceDirectories = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
]);

type WorkspaceCopyTotals = {
  files: number;
  bytes: number;
  directories: number;
  fileSizes: Map<string, number>;
};

function postProgress(requestId: number, message: string) {
  worker.postMessage({
    type: "progress",
    requestId,
    message,
  });
}

function postDiagnostic(
  requestId: number,
  level: "info" | "warning" | "error",
  channel: "stdout" | "stderr" | "host",
  message: string,
) {
  if (!message.trim()) {
    return;
  }
  worker.postMessage({
    type: "diagnostic",
    requestId,
    level,
    channel,
    message,
  });
}

async function fetchChecked(url: URL) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url.pathname}: HTTP ${response.status}`);
  }
  return response;
}

async function loadRuntimeFiles(requestId: number) {
  const runtimeRoot = new URL("./runtime/", worker.location.href);
  const manifestUrl = new URL("runtime-files.json", runtimeRoot);
  const packUrl = new URL("runtime-files.pack.gz", runtimeRoot);

  postProgress(requestId, "Loading the local run-time pack");
  const [manifestResponse, packResponse] = await Promise.all([
    fetchChecked(manifestUrl),
    fetchChecked(packUrl),
  ]);
  const manifest =
    await manifestResponse.json() as RuntimeFilesManifest;

  if (
    manifest.schemaVersion !== 1 ||
    manifest.compression !== "gzip" ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("The run-time file manifest has an unknown format.");
  }

  if (!packResponse.body || typeof DecompressionStream === "undefined") {
    throw new Error(
      "This browser cannot unpack the LilyPond run-time data.",
    );
  }

  postProgress(requestId, "Unpacking LilyPond and Guile data");
  const decompressedStream = packResponse.body.pipeThrough(
    new DecompressionStream("gzip"),
  );
  const bytes = new Uint8Array(
    await new Response(decompressedStream).arrayBuffer(),
  );

  if (bytes.byteLength !== manifest.uncompressedBytes) {
    throw new Error(
      `The run-time pack is ${bytes.byteLength} bytes; expected ` +
        `${manifest.uncompressedBytes}.`,
    );
  }

  return { bytes, files: manifest.files };
}

function makeFileSystem(
  requestId: number,
  runtimeBytes: Uint8Array,
  runtimeFiles: RuntimeFile[],
) {
  const volume = new Volume();
  const fs = createFsFromVolume(volume);

  for (const directory of [
    "/work/cache/fontconfig",
    "/work/home",
    "/work/tmp",
    "/workspace",
    "/render-output",
    ...runtimeMountOrder,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  postProgress(
    requestId,
    `Mounting ${runtimeFiles.length} run-time files`,
  );

  for (const file of runtimeFiles) {
    const end = file.offset + file.length;
    if (
      file.offset < 0 ||
      file.length < 0 ||
      end > runtimeBytes.byteLength
    ) {
      throw new Error(`The run-time entry ${file.guestPath} is out of range.`);
    }

    const separator = file.guestPath.lastIndexOf("/");
    const parent = file.guestPath.slice(0, separator) || "/";
    fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(
      file.guestPath,
      runtimeBytes.subarray(file.offset, end),
    );
  }

  return fs;
}

function safeWorkspacePath(path: string[]) {
  if (
    path.length === 0 ||
    path.some((part) =>
      !part ||
      part === "." ||
      part === ".." ||
      part.includes("/")
    )
  ) {
    throw new Error("The selected file has an invalid workspace path.");
  }
  return `/workspace/${path.join("/")}`;
}

function accountWorkspaceFile(
  totals: WorkspaceCopyTotals,
  guestPath: string,
  size: number,
) {
  const oldSize = totals.fileSizes.get(guestPath);
  if (oldSize === undefined) {
    totals.files += 1;
    totals.bytes += size;
  } else {
    totals.bytes += size - oldSize;
  }
  totals.fileSizes.set(guestPath, size);

  if (
    totals.files > workspaceFileLimit ||
    totals.bytes > workspaceByteLimit
  ) {
    throw new Error(
      `The workspace render copy exceeds ${workspaceFileLimit} files or ` +
        `${workspaceByteLimit / 1024 / 1024} MiB. Choose a smaller project folder.`,
    );
  }
}

async function mirrorDirectory(
  fs: ReturnType<typeof makeFileSystem>,
  directory: FileSystemDirectoryHandle,
  guestRoot: string,
  totals: WorkspaceCopyTotals,
  depth: number,
) {
  if (depth > workspaceDepthLimit) {
    throw new Error(
      `The workspace render copy exceeds ${workspaceDepthLimit} folder levels.`,
    );
  }

  for await (const [name, handle] of directory.entries()) {
    if (
      !name ||
      name === "." ||
      name === ".." ||
      name.includes("/")
    ) {
      throw new Error("The workspace contains an invalid file name.");
    }

    const guestPath = `${guestRoot}/${name}`;
    if (handle.kind === "directory") {
      if (ignoredWorkspaceDirectories.has(name)) {
        continue;
      }
      totals.directories += 1;
      if (totals.directories > workspaceDirectoryLimit) {
        throw new Error(
          `The workspace render copy exceeds ${workspaceDirectoryLimit} folders.`,
        );
      }
      fs.mkdirSync(guestPath, { recursive: true });
      await mirrorDirectory(fs, handle, guestPath, totals, depth + 1);
      continue;
    }

    const file = await handle.getFile();
    accountWorkspaceFile(totals, guestPath, file.size);

    fs.mkdirSync(guestRoot, { recursive: true });
    fs.writeFileSync(
      guestPath,
      new Uint8Array(await file.arrayBuffer()),
    );
  }
}

async function mountRenderInput(
  request: RenderRequest,
  fs: ReturnType<typeof makeFileSystem>,
) {
  if (!request.workspaceRoot || !request.inputPath) {
    const inputPath = "/work/main.ly";
    const source = textEncoder.encode(request.source);
    if (source.byteLength > workspaceByteLimit) {
      throw new Error(
        `The scratchpad source exceeds ${workspaceByteLimit / 1024 / 1024} MiB.`,
      );
    }
    fs.writeFileSync(inputPath, source);
    return inputPath;
  }

  postProgress(request.requestId, "Copying the local workspace for rendering");
  const totals: WorkspaceCopyTotals = {
    files: 0,
    bytes: 0,
    directories: 1,
    fileSizes: new Map(),
  };
  await mirrorDirectory(
    fs,
    request.workspaceRoot,
    "/workspace",
    totals,
    0,
  );

  for (const buffer of request.openBuffers ?? []) {
    const guestPath = safeWorkspacePath(buffer.path);
    const separator = guestPath.lastIndexOf("/");
    const content = textEncoder.encode(buffer.content);
    accountWorkspaceFile(totals, guestPath, content.byteLength);
    fs.mkdirSync(guestPath.slice(0, separator), { recursive: true });
    fs.writeFileSync(guestPath, content);
  }

  return safeWorkspacePath(request.inputPath);
}

function outputOrder(left: string, right: string) {
  const pageNumber = (name: string) => {
    const match = name.match(/^score(?:-(\d+))?\.svg$/);
    return match?.[1] ? Number(match[1]) : 1;
  };
  return pageNumber(left) - pageNumber(right);
}

async function render(request: RenderRequest) {
  const startedAt = performance.now();
  const { requestId } = request;

  try {
    let { bytes, files } = await loadRuntimeFiles(requestId);
    const fs = makeFileSystem(requestId, bytes, files);
    bytes = new Uint8Array();
    files = [];
    const inputPath = await mountRenderInput(request, fs);
    const inputDirectory =
      inputPath.slice(0, inputPath.lastIndexOf("/")) || "/work";

    const wasi = new WASI({
      version: "preview1",
      args: [
        runtimeRequirements.argv0,
        "-dbackend=svg",
        "-djob-count=1",
        "-dpoint-and-click=#f",
        "-drandom-seed=1",
        "--formats=svg",
        "-I",
        inputDirectory,
        "-o",
        "/render-output/score",
        inputPath,
      ],
      env: { ...runtimeEnvironment },
      preopens: {
        "/work": "/work",
        "/workspace": "/workspace",
        "/render-output": "/render-output",
        "/lilypond": "/lilypond",
        "/guile-ccache": "/guile-ccache",
        "/lilypond-lib": "/lilypond-lib",
      },
      fs,
      returnOnExit: true,
      print: (message) => {
        postDiagnostic(requestId, "info", "stdout", message);
      },
      printErr: (message) => {
        const level = /\b(?:error|fatal)\b/i.test(message)
          ? "error"
          : /\bwarning\b/i.test(message)
            ? "warning"
            : "info";
        postDiagnostic(requestId, level, "stderr", message);
      },
    });

    postProgress(requestId, "Compiling the WebAssembly module");
    const wasmResponse = await fetchChecked(lilypondWasmUrl);
    const { instance } = await WebAssembly.instantiateStreaming(
      wasmResponse,
      wasi.getImportObject(),
    );

    postProgress(requestId, "Engraving the score");
    const exitCode = await wasi.start(instance);
    const outputEntries = fs.readdirSync("/render-output") as string[];
    const outputFiles = outputEntries
      .filter((name) => /^score(?:-\d+)?\.svg$/.test(name))
      .sort(outputOrder);

    if (outputFiles.length === 0) {
      throw new Error(
        `LilyPond exited with code ${exitCode ?? "unknown"} and wrote no SVG.`,
      );
    }

    const svgs = outputFiles.map((name) =>
      String(fs.readFileSync(`/render-output/${name}`, "utf8"))
    );
    const scores = outputEntries
      .filter((name) => name.endsWith(".sco"))
      .sort((left, right) => left.localeCompare(right))
      .map((name) => {
        const timelineName =
          `${name.slice(0, -".sco".length)}.lpcs.timeline.json`;
        return {
          name,
          source: String(
            fs.readFileSync(`/render-output/${name}`, "utf8"),
          ),
          timelineSource: outputEntries.includes(timelineName)
            ? String(
                fs.readFileSync(
                  `/render-output/${timelineName}`,
                  "utf8",
                ),
              )
            : null,
        };
      });

    worker.postMessage({
      type: "result",
      requestId,
      exitCode,
      durationMs: performance.now() - startedAt,
      files: outputFiles,
      svgs,
      scores,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    worker.postMessage({
      type: "error",
      requestId,
      message,
    });
  }
}

worker.addEventListener("message", (event: MessageEvent<RenderRequest>) => {
  if (event.data?.type === "render") {
    void render(event.data);
  }
});

worker.postMessage({
  type: "ready",
  lilypondVersion,
  guileVersion,
  wasi: `WASI ${runtimeRequirements.wasi}`,
});
