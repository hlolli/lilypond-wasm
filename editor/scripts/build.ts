import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

type PackageRuntimeManifest = {
  lilypondVersion: string;
  mountOrder: string[];
  mounts: Record<string, string>;
};

type RuntimeFile = {
  guestPath: string;
  offset: number;
  length: number;
};

const projectRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(projectRoot, "..");
const outputRoot = resolve(projectRoot, "dist");
const repositoryUrl = "https://github.com/hlolli/lilypond-wasm";

function packageRoot(packageName: string) {
  return dirname(
    fileURLToPath(import.meta.resolve(`${packageName}/package.json`)),
  );
}

const lilypondPackageRoot = packageRoot("@hlolli/lilypond-wasm");
const csoundBrowserPackageRoot = packageRoot("@csound/browser");
const lilypondLanguagePackageRoot = packageRoot("codemirror-lang-lilypond");
const bundledNoticeFallbacks = new Map<string, string[]>([
  [
    "@napi-rs/wasm-runtime",
    ["LICENSE", "PREBUNDLED_THIRD_PARTY_NOTICES.md"],
  ],
  ["@tybys/wasm-util", ["LICENSE"]],
]);

async function treeFiles(
  sourceRoot: string,
  include: (relativePath: string) => boolean = () => true,
) {
  const files = new Bun.Glob("**/*");
  const relativePaths: string[] = [];

  for await (const relativePath of files.scan({
    cwd: sourceRoot,
    dot: true,
    onlyFiles: true,
  })) {
    if (include(relativePath)) {
      relativePaths.push(relativePath);
    }
  }

  return relativePaths.sort();
}

async function copyTree(
  sourceRoot: string,
  destinationRoot: string,
  include?: (relativePath: string) => boolean,
) {
  for (const relativePath of await treeFiles(sourceRoot, include)) {
    await copyFile(
      resolve(sourceRoot, relativePath),
      resolve(destinationRoot, relativePath),
    );
  }
}

async function copyFile(source: string, destination: string) {
  await mkdir(dirname(destination), { recursive: true });
  await Bun.write(destination, Bun.file(source));
}

async function requireFile(path: string) {
  if (!(await Bun.file(path).exists())) {
    throw new Error(`The editor build is missing ${path}`);
  }
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function gitOutput(args: string[]) {
  const result = Bun.spawnSync({
    cmd: ["git", "-C", repositoryRoot, ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout.toString().trim();
}

async function buildLilypondRuntimePack() {
  const packageManifestPath = resolve(
    lilypondPackageRoot,
    "runtime-manifest.json",
  );
  const packageManifest =
    await Bun.file(packageManifestPath).json() as PackageRuntimeManifest;

  if (
    !packageManifest.lilypondVersion ||
    !Array.isArray(packageManifest.mountOrder) ||
    packageManifest.mountOrder.length === 0
  ) {
    throw new Error("The LilyPond run-time manifest has an unknown format.");
  }

  const runtimeFiles: RuntimeFile[] = [];
  const packParts: Uint8Array[] = [];
  let offset = 0;

  for (const guestRoot of packageManifest.mountOrder) {
    const packagePath = packageManifest.mounts[guestRoot];
    if (!packagePath) {
      throw new Error(`No package path found for run-time mount ${guestRoot}`);
    }

    const sourceRoot = resolve(lilypondPackageRoot, packagePath);
    const files = new Bun.Glob("**/*");
    const relativePaths: string[] = [];

    for await (const relativePath of files.scan({
      cwd: sourceRoot,
      dot: true,
      onlyFiles: true,
    })) {
      relativePaths.push(relativePath);
    }

    relativePaths.sort();

    for (const relativePath of relativePaths) {
      const source = resolve(sourceRoot, relativePath);
      const fileBytes = new Uint8Array(await Bun.file(source).arrayBuffer());
      const guestPath = `${guestRoot}/${relativePath.split(sep).join("/")}`;

      runtimeFiles.push({
        guestPath,
        offset,
        length: fileBytes.byteLength,
      });
      packParts.push(fileBytes);
      offset += fileBytes.byteLength;
    }
  }

  const pack = new Uint8Array(offset);
  let packOffset = 0;
  for (const part of packParts) {
    pack.set(part, packOffset);
    packOffset += part.byteLength;
  }
  const compressedPack = gzipSync(pack, { level: 9 });
  const runtimeOutputRoot = resolve(outputRoot, "runtime");

  await mkdir(runtimeOutputRoot, { recursive: true });
  await Bun.write(
    resolve(runtimeOutputRoot, "runtime-files.pack.gz"),
    compressedPack,
  );
  await Bun.write(
    resolve(runtimeOutputRoot, "runtime-files.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        compression: "gzip",
        uncompressedBytes: offset,
        files: runtimeFiles,
      },
      null,
      2,
    ),
  );

  const lilypondFontRoot = resolve(
    lilypondPackageRoot,
    `runtime/lilypond/${packageManifest.lilypondVersion}/fonts/text`,
  );

  await Promise.all([
    copyFile(
      resolve(lilypondPackageRoot, "dist/lilypond.wasm"),
      resolve(outputRoot, "dist/lilypond.wasm"),
    ),
    copyFile(
      packageManifestPath,
      resolve(outputRoot, "runtime-manifest.json"),
    ),
    copyFile(
      resolve(lilypondFontRoot, "NimbusSans-Regular.otf"),
      resolve(outputRoot, "fonts/NimbusSans-Regular.otf"),
    ),
    copyFile(
      resolve(lilypondFontRoot, "NimbusSans-Bold.otf"),
      resolve(outputRoot, "fonts/NimbusSans-Bold.otf"),
    ),
    copyFile(
      resolve(lilypondPackageRoot, "COPYING"),
      resolve(outputRoot, "COPYING"),
    ),
    copyFile(
      resolve(lilypondPackageRoot, "LICENSE"),
      resolve(outputRoot, "LICENSE"),
    ),
    copyFile(
      resolve(lilypondPackageRoot, "SOURCE.md"),
      resolve(outputRoot, "SOURCE.md"),
    ),
    copyTree(
      resolve(lilypondPackageRoot, "licenses"),
      resolve(outputRoot, "licenses"),
    ),
  ]);

  console.log(
    `Packed ${runtimeFiles.length} LilyPond run-time files: ` +
      `${(offset / 1024 / 1024).toFixed(1)} MiB -> ` +
      `${(compressedPack.byteLength / 1024 / 1024).toFixed(1)} MiB`,
  );
}

async function copyCsoundNotices() {
  const destinationRoot = resolve(outputRoot, "licenses/csound-browser");

  await Promise.all([
    copyFile(
      resolve(csoundBrowserPackageRoot, "LICENSE"),
      resolve(destinationRoot, "LICENSE"),
    ),
    copyFile(
      resolve(csoundBrowserPackageRoot, "THIRD_PARTY.md"),
      resolve(destinationRoot, "THIRD_PARTY.md"),
    ),
  ]);
}

function includeRepositorySource(relativePath: string) {
  const normalizedPath = relativePath.split(sep).join("/");
  return normalizedPath !== ".DS_Store" &&
    !normalizedPath.endsWith("/.DS_Store");
}

function includeEditorSource(relativePath: string) {
  const normalizedPath = relativePath.split(sep).join("/");
  return includeRepositorySource(normalizedPath) &&
    normalizedPath !== "dist" &&
    !normalizedPath.startsWith("dist/") &&
    normalizedPath !== "node_modules" &&
    !normalizedPath.startsWith("node_modules/");
}

async function copyRuntimeNoticeSource() {
  const destinationRoot = resolve(outputRoot, "licenses/lilypond-wasm");

  await Promise.all([
    copyFile(
      resolve(repositoryRoot, "flake.lock"),
      resolve(destinationRoot, "flake.lock"),
    ),
    copyFile(
      resolve(repositoryRoot, "flake.nix"),
      resolve(destinationRoot, "flake.nix"),
    ),
    copyTree(
      resolve(repositoryRoot, "nix"),
      resolve(destinationRoot, "nix"),
      includeRepositorySource,
    ),
    copyTree(
      resolve(repositoryRoot, "third-party/licenses"),
      resolve(destinationRoot, "third-party/licenses"),
      includeRepositorySource,
    ),
  ]);
}

function sourceLink(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function copyEditorSource() {
  const sourceRoot = resolve(outputRoot, "source");
  const editorSourceRoot = resolve(sourceRoot, "editor");
  const editorFiles = await treeFiles(projectRoot, includeEditorSource);
  const revision = gitOutput(["rev-parse", "HEAD"]) ?? "unknown";
  const status = gitOutput([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    "COPYING",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "editor",
    "flake.lock",
    "flake.nix",
    "nix",
  ]);
  const treeState = status === null
    ? "unknown"
    : status.length === 0
    ? "clean"
    : "dirty";

  await Promise.all([
    ...editorFiles.map((relativePath) =>
      copyFile(
        resolve(projectRoot, relativePath),
        resolve(editorSourceRoot, relativePath),
      )
    ),
    ...["COPYING", "LICENSE", "THIRD_PARTY_NOTICES.md", "flake.lock", "flake.nix"]
      .map((relativePath) =>
        copyFile(
          resolve(repositoryRoot, relativePath),
          resolve(sourceRoot, relativePath),
        )
      ),
    copyTree(
      resolve(repositoryRoot, "nix"),
      resolve(sourceRoot, "nix"),
      includeRepositorySource,
    ),
    copyTree(
      resolve(repositoryRoot, "third-party/licenses"),
      resolve(sourceRoot, "third-party/licenses"),
      includeRepositorySource,
    ),
    copyTree(
      lilypondLanguagePackageRoot,
      resolve(sourceRoot, "npm/codemirror-lang-lilypond"),
      includeRepositorySource,
    ),
  ]);

  const sourceFiles = [
    "# Editor source files",
    "",
    "This is the exact editor source snapshot used for this build. Root licence",
    "and build support files are in the [parent source folder](../README.md).",
    "",
    ...editorFiles.map((relativePath) => {
      const path = relativePath.split(sep).join("/");
      return `- [\`${path}\`](${sourceLink(path)})`;
    }),
    "",
  ].join("\n");
  const revisionRecord = [
    `repository: ${repositoryUrl}`,
    `commit: ${revision}`,
    `tree-state: ${treeState}`,
    "",
    "Scoped worktree status:",
    status === null
      ? "git status was unavailable"
      : status.length === 0
      ? "clean"
      : status,
    "",
  ].join("\n");
  const sourceReadme = [
    "# Browser editor source snapshot",
    "",
    "- [Editor source files](editor/SOURCE_FILES.md)",
    "- [Revision and tree state](REVISION.txt)",
    "- [GPL terms](LICENSE) and [full GPL text](COPYING)",
    "- [Third-party notices](THIRD_PARTY_NOTICES.md)",
    "- [Copied third-party terms](third-party/licenses)",
    "- [LilyPond CodeMirror mode source](npm/codemirror-lang-lilypond/src/index.ts)",
    "- [Pinned inputs](flake.lock) and [build rules](nix)",
    "",
  ].join("\n");
  const revisionLink = revision === "unknown"
    ? repositoryUrl
    : `${repositoryUrl}/tree/${revision}/editor`;
  const publicSourceEntry = [
    "# Browser editor corresponding source",
    "",
    "The [bundled source snapshot](source/README.md) is the exact input used to",
    "build this minified editor. Its [revision record](source/REVISION.txt) says",
    `whether commit [\`${revision}\`](${revisionLink}) was clean or dirty. When it`,
    "was dirty, the bundled snapshot controls.",
    "",
    "The LilyPond WebAssembly run time has its own matching source record in",
    "[SOURCE.md](SOURCE.md).",
    "",
  ].join("\n");

  await Promise.all([
    Bun.write(resolve(editorSourceRoot, "SOURCE_FILES.md"), sourceFiles),
    copyFile(
      resolve(repositoryRoot, "COPYING"),
      resolve(editorSourceRoot, "COPYING"),
    ),
    copyFile(
      resolve(repositoryRoot, "LICENSE"),
      resolve(editorSourceRoot, "LICENSE"),
    ),
    Bun.write(
      resolve(editorSourceRoot, "EDITOR_SOURCE.md"),
      "# Source record\n\nSee the [parent source index](../README.md).\n",
    ),
    Bun.write(
      resolve(
        editorSourceRoot,
        "licenses/lilypond-wasm/THIRD_PARTY_NOTICES.md",
      ),
      "# LilyPond WASM notices\n\nSee the [canonical notice](../../../../licenses/lilypond-wasm/THIRD_PARTY_NOTICES.md).\n",
    ),
    Bun.write(
      resolve(editorSourceRoot, "licenses/npm/README.md"),
      "# Bundled npm notices\n\nSee the [built notice index](../../../../licenses/npm/README.md).\n",
    ),
    copyFile(
      resolve(csoundBrowserPackageRoot, "LICENSE"),
      resolve(editorSourceRoot, "licenses/csound-browser/LICENSE"),
    ),
    copyFile(
      resolve(csoundBrowserPackageRoot, "THIRD_PARTY.md"),
      resolve(editorSourceRoot, "licenses/csound-browser/THIRD_PARTY.md"),
    ),
    copyFile(
      resolve(projectRoot, "assets/fonts/lekton.regular.ttf"),
      resolve(editorSourceRoot, "licenses/lekton/Lekton-Regular.ttf"),
    ),
    Bun.write(resolve(sourceRoot, "REVISION.txt"), revisionRecord),
    Bun.write(resolve(sourceRoot, "README.md"), sourceReadme),
    Bun.write(resolve(outputRoot, "EDITOR_SOURCE.md"), publicSourceEntry),
  ]);
}

type PackageManifest = {
  name?: string;
  version?: string;
  license?: string;
  repository?: string | { url?: string };
};

function bundledPackageRoot(inputPath: string) {
  const normalizedPath = inputPath.split(sep).join("/");
  const marker = "node_modules/";
  const markerOffset = normalizedPath.lastIndexOf(marker);
  if (markerOffset < 0) {
    return null;
  }

  const dependencyPath = normalizedPath.slice(markerOffset + marker.length);
  const parts = dependencyPath.split("/");
  const packageName = parts[0]?.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : parts[0];
  if (!packageName) {
    return null;
  }

  return resolve(
    projectRoot,
    normalizedPath.slice(0, markerOffset + marker.length),
    packageName,
  );
}

function packageRepository(manifest: PackageManifest) {
  const repository = typeof manifest.repository === "string"
    ? manifest.repository
    : manifest.repository?.url ?? "";
  return repository
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "");
}

async function copyBundledPackageNotices(
  metafile: Bun.BuildMetafile | undefined,
) {
  if (!metafile) {
    throw new Error("The editor build did not return bundle metadata.");
  }

  const packageRoots = new Set<string>();
  for (const inputPath of Object.keys(metafile.inputs)) {
    const root = bundledPackageRoot(inputPath);
    if (root) {
      packageRoots.add(root);
    }
  }

  const packages: Array<{
    name: string;
    version: string;
    license: string;
    repository: string;
    files: string[];
  }> = [];

  for (const packageRoot of [...packageRoots].sort()) {
    const manifestPath = resolve(packageRoot, "package.json");
    const manifest = await Bun.file(manifestPath).json() as PackageManifest;
    const name = manifest.name ?? packageRoot.split(sep).at(-1) ?? "unknown";
    const destinationRoot = resolve(outputRoot, "licenses/npm", name);
    const entries = await readdir(packageRoot, { withFileTypes: true });
    const noticeFiles = entries
      .filter((entry) =>
        entry.isFile() &&
        /^(?:licen[cs]e|copying|notice|third[_-]?party)(?:[._-].*)?$/i
          .test(entry.name)
      )
      .map((entry) => entry.name)
      .sort();
    const fallbackNoticeFiles = (
      bundledNoticeFallbacks.get(name) ?? []
    ).filter((fileName) => !noticeFiles.includes(fileName));
    const canonicalLilypondNotice = name === "@hlolli/lilypond-wasm" &&
      noticeFiles.includes("THIRD_PARTY_NOTICES.md");
    const napiPrebundle = name === "@napi-rs/wasm-runtime";
    const packageNoticeFiles = canonicalLilypondNotice
      ? noticeFiles.filter((fileName) => fileName !== "THIRD_PARTY_NOTICES.md")
      : noticeFiles;
    const copiedNoticeFiles = [
      ...packageNoticeFiles,
      ...fallbackNoticeFiles,
      ...(canonicalLilypondNotice ? ["THIRD_PARTY_NOTICES.md"] : []),
      ...(napiPrebundle ? ["PREBUNDLED_SOURCE.js"] : []),
    ].sort();
    const lilypondNoticeRedirect = [
      "# LilyPond WASM notices",
      "",
      "The editor keeps the complete LilyPond WASM notice and its licence tree",
      "in the [canonical run-time notice](../../../lilypond-wasm/THIRD_PARTY_NOTICES.md).",
      "",
    ].join("\n");

    await Promise.all([
      copyFile(manifestPath, resolve(destinationRoot, "package.json")),
      ...packageNoticeFiles.map((fileName) =>
        copyFile(
          resolve(packageRoot, fileName),
          resolve(destinationRoot, fileName),
        )
      ),
      ...fallbackNoticeFiles.map((fileName) =>
        copyFile(
          resolve(projectRoot, "licenses/npm", name, fileName),
          resolve(destinationRoot, fileName),
        )
      ),
      ...(canonicalLilypondNotice
        ? [
          Bun.write(
            resolve(destinationRoot, "THIRD_PARTY_NOTICES.md"),
            lilypondNoticeRedirect,
          ),
        ]
        : []),
      ...(napiPrebundle
        ? [
          copyTree(
            resolve(projectRoot, "licenses/npm", name, "prebundled"),
            resolve(destinationRoot, "prebundled"),
          ),
          copyFile(
            resolve(packageRoot, "dist/fs.js"),
            resolve(destinationRoot, "PREBUNDLED_SOURCE.js"),
          ),
        ]
        : []),
    ]);

    packages.push({
      name,
      version: manifest.version ?? "unknown",
      license: manifest.license ?? "See package files",
      repository: packageRepository(manifest),
      files: copiedNoticeFiles,
    });
  }

  const rows = packages.map((entry) => {
    const path = entry.name
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const files = entry.files.length > 0
      ? entry.files.map((file) => `[${file}](${path}/${file})`).join(", ")
      : `[package metadata](${path}/package.json)`;
    const name = entry.repository
      ? `[\`${entry.name}\`](${entry.repository})`
      : `\`${entry.name}\``;
    return `| ${name} | ${entry.version} | ${entry.license} | ${files} |`;
  });
  const index = [
    "# Bundled npm package notices",
    "",
    "Bun reported these packages as inputs to the browser bundle. Each copy",
    "keeps its package metadata and every top-level licence or notice file.",
    "The LilyPond package entry points to the complete canonical run-time notice.",
    "",
    "| Package | Version | Declared licence | Copied files |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");

  await Bun.write(resolve(outputRoot, "licenses/npm/README.md"), index);
}

function normalizedMetafilePath(path: string) {
  return path.replace(/^(?:\.\/)+/, "").split(sep).join("/");
}

async function assertLazyCsoundChunk(metafile: Bun.BuildMetafile | undefined) {
  if (!metafile) {
    throw new Error("The editor build did not return bundle metadata.");
  }

  const outputs = Object.entries(metafile.outputs);
  const initialEntry = outputs.find(([path, output]) =>
    path.endsWith(".js") && output.entryPoint?.endsWith("index.html")
  );
  if (!initialEntry) {
    throw new Error("The editor build has no JavaScript entry for index.html.");
  }

  const [initialPath, initialOutput] = initialEntry;
  const initialContainsCsound = Object.keys(initialOutput.inputs).some((path) =>
    normalizedMetafilePath(path).includes("node_modules/@csound/browser/")
  );
  if (initialContainsCsound) {
    throw new Error("@csound/browser leaked into the initial editor bundle.");
  }

  const csoundOutput = outputs.find(([, output]) =>
    Object.keys(output.inputs).some((path) =>
      normalizedMetafilePath(path).includes("node_modules/@csound/browser/")
    )
  );
  if (!csoundOutput) {
    throw new Error("The editor build has no separate @csound/browser chunk.");
  }

  const [csoundPath, csoundChunk] = csoundOutput;
  const importsCsoundLazily = initialOutput.imports.some((entry) =>
    entry.kind === "dynamic-import" &&
    normalizedMetafilePath(entry.path) === normalizedMetafilePath(csoundPath)
  );
  if (!importsCsoundLazily) {
    throw new Error("The initial editor bundle does not load Csound lazily.");
  }

  await requireFile(
    resolve(outputRoot, normalizedMetafilePath(csoundPath)),
  );
  console.log(
    `Lazy Csound chunk: ${normalizedMetafilePath(initialPath)} -> ` +
      `${normalizedMetafilePath(csoundPath)} ` +
      `(${(csoundChunk.bytes / 1024 / 1024).toFixed(1)} MiB)`,
  );
}

async function assertMarkdownLinks(relativePaths: string[]) {
  const failures: string[] = [];

  for (const relativePath of relativePaths) {
    const markdownPath = resolve(outputRoot, relativePath);
    const markdown = await Bun.file(markdownPath).text();
    for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1]?.trim();
      if (!link || link.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(link)) {
        continue;
      }

      const localPath = decodeURIComponent(link.split("#", 1)[0] ?? "");
      const destination = resolve(dirname(markdownPath), localPath);
      if (!(await pathExists(destination))) {
        failures.push(`${relativePath}: ${link}`);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `The editor build has broken local notice links:\n${failures.join("\n")}`,
    );
  }
}

async function assertBuildOutput() {
  const expectedFiles = [
    "index.html",
    "lilypond.worker.js",
    "dist/lilypond.wasm",
    "runtime/runtime-files.json",
    "runtime/runtime-files.pack.gz",
    "runtime-manifest.json",
    "fonts/NimbusSans-Regular.otf",
    "fonts/NimbusSans-Bold.otf",
    "COPYING",
    "LICENSE",
    "SOURCE.md",
    "EDITOR_SOURCE.md",
    "THIRD_PARTY_NOTICES.md",
    "licenses/csound-browser/LICENSE",
    "licenses/csound-browser/THIRD_PARTY.md",
    "licenses/lekton/Lekton-Regular.ttf",
    "licenses/lilypond-wasm/THIRD_PARTY_NOTICES.md",
    "licenses/lilypond-wasm/flake.lock",
    "licenses/lilypond-wasm/nix/patches/gmp-wasi.patch",
    "licenses/npm/README.md",
    "licenses/npm/@csound/browser/LICENSE",
    "licenses/npm/@napi-rs/wasm-runtime/LICENSE",
    "licenses/npm/@napi-rs/wasm-runtime/PREBUNDLED_THIRD_PARTY_NOTICES.md",
    "licenses/npm/@napi-rs/wasm-runtime/PREBUNDLED_SOURCE.js",
    "licenses/npm/@napi-rs/wasm-runtime/prebundled/tslib/2.8.1/LICENSE.txt",
    "licenses/npm/@napi-rs/wasm-runtime/prebundled/ieee754/1.2.1/LICENSE",
    "licenses/npm/@napi-rs/wasm-runtime/prebundled/buffer/6.0.3/LICENSE",
    "licenses/npm/@napi-rs/wasm-runtime/prebundled/punycode/1.4.1/LICENSE-MIT.txt",
    "licenses/npm/@napi-rs/wasm-runtime/prebundled/url/0.11.4/LICENSE",
    "licenses/npm/@napi-rs/wasm-runtime/prebundled/safe-buffer/5.2.1/LICENSE",
    "licenses/npm/@napi-rs/wasm-runtime/prebundled/borrowed/cbor-x-MIT.txt",
    "licenses/npm/@tybys/wasm-util/LICENSE",
    "licenses/npm/codemirror/LICENSE",
    "licenses/npm/codemirror-lang-lilypond/LICENSE",
    "source/README.md",
    "source/REVISION.txt",
    "source/COPYING",
    "source/LICENSE",
    "source/THIRD_PARTY_NOTICES.md",
    "source/flake.lock",
    "source/nix/patches/gmp-wasi.patch",
    "source/third-party/licenses/lilypond/COPYING",
    "source/npm/codemirror-lang-lilypond/LICENSE",
    "source/npm/codemirror-lang-lilypond/package.json",
    "source/npm/codemirror-lang-lilypond/src/index.ts",
    "source/editor/SOURCE_FILES.md",
    "source/editor/COPYING",
    "source/editor/LICENSE",
    "source/editor/EDITOR_SOURCE.md",
    "source/editor/licenses/lilypond-wasm/THIRD_PARTY_NOTICES.md",
    "source/editor/licenses/csound-browser/LICENSE",
    "source/editor/licenses/csound-browser/THIRD_PARTY.md",
    "source/editor/licenses/npm/README.md",
    "source/editor/licenses/lekton/Lekton-Regular.ttf",
    "source/editor/bun.lock",
    "source/editor/main.ts",
    "source/editor/package.json",
    "source/editor/scripts/build.ts",
  ];

  await Promise.all(
    expectedFiles.map((relativePath) =>
      requireFile(resolve(outputRoot, relativePath))
    ),
  );

  await assertMarkdownLinks([
    "EDITOR_SOURCE.md",
    "THIRD_PARTY_NOTICES.md",
    "licenses/lilypond-wasm/THIRD_PARTY_NOTICES.md",
    "licenses/npm/README.md",
    "licenses/npm/@hlolli/lilypond-wasm/THIRD_PARTY_NOTICES.md",
    "licenses/npm/@napi-rs/wasm-runtime/PREBUNDLED_THIRD_PARTY_NOTICES.md",
    "source/README.md",
    "source/THIRD_PARTY_NOTICES.md",
    "source/editor/EDITOR_SOURCE.md",
    "source/editor/SOURCE_FILES.md",
    "source/editor/THIRD_PARTY_NOTICES.md",
    "source/editor/licenses/lilypond-wasm/THIRD_PARTY_NOTICES.md",
    "source/editor/licenses/npm/README.md",
  ]);
}

await rm(outputRoot, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [
    resolve(projectRoot, "index.html"),
    resolve(projectRoot, "lilypond.worker.ts"),
  ],
  outdir: outputRoot,
  root: projectRoot,
  minify: true,
  splitting: true,
  naming: {
    entry: "[dir]/[name].[ext]",
    chunk: "assets/[name]-[hash].[ext]",
    asset: "assets/[name]-[hash].[ext]",
  },
  target: "browser",
  metafile: true,
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

await assertLazyCsoundChunk(result.metafile);

await buildLilypondRuntimePack();

await Promise.all([
  copyCsoundNotices(),
  copyBundledPackageNotices(result.metafile),
  copyRuntimeNoticeSource(),
  copyEditorSource(),
  copyFile(
    resolve(projectRoot, "THIRD_PARTY_NOTICES.md"),
    resolve(outputRoot, "THIRD_PARTY_NOTICES.md"),
  ),
  copyFile(
    resolve(projectRoot, "assets/fonts/lekton.regular.ttf"),
    resolve(outputRoot, "licenses/lekton/Lekton-Regular.ttf"),
  ),
]);

await assertBuildOutput();

console.log(`Built ${outputRoot}`);
