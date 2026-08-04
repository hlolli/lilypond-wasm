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
const csoundLanguagePackageRoot = packageRoot(
  "@hlolli/codemirror-lang-csound",
);
const lilypondLanguagePackageRoot = packageRoot("codemirror-lang-lilypond");
const pdfkitPackageRoot = packageRoot("pdfkit");
const pdfkitStandalonePackages = [
  "@noble/ciphers",
  "@noble/hashes",
  "@swc/helpers",
  "base64-js",
  "brotli",
  "browserify-zlib",
  "clone",
  "dfa",
  "fast-deep-equal",
  "fontkit",
  "inherits",
  "js-md5",
  "linebreak",
  "pako",
  "png-js",
  "restructure",
  "tiny-inflate",
  "tslib",
  "unicode-properties",
  "unicode-trie",
] as const;
const csoundLanguageFallbackNotices = [
  "LICENSE",
  "CSOUND_MANUAL_NOTICE.md",
  "CSOUND_MANUAL_COPYING",
];
const bundledNoticeFallbacks = new Map<string, string[]>([
  [
    "@napi-rs/wasm-runtime",
    ["LICENSE", "PREBUNDLED_THIRD_PARTY_NOTICES.md"],
  ],
  ["@tybys/wasm-util", ["LICENSE"]],
  ["@hlolli/codemirror-lang-csound", csoundLanguageFallbackNotices],
]);

function bundledNoticeFallbackSource(name: string, fileName: string) {
  if (name === "@hlolli/codemirror-lang-csound") {
    if (fileName === "LICENSE") {
      return resolve(
        repositoryRoot,
        "third-party/licenses/codemirror-lang-csound/LICENSE",
      );
    }
    if (fileName === "CSOUND_MANUAL_NOTICE.md") {
      return resolve(
        repositoryRoot,
        "third-party/licenses/codemirror-lang-csound/CSOUND_MANUAL_NOTICE.md",
      );
    }
    if (fileName === "CSOUND_MANUAL_COPYING") {
      return resolve(
        repositoryRoot,
        "third-party/licenses/codemirror-lang-csound/CSOUND_MANUAL_COPYING",
      );
    }
  }
  return resolve(projectRoot, "licenses/npm", name, fileName);
}

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
      resolve(lilypondFontRoot, "NimbusSans-Italic.otf"),
      resolve(outputRoot, "fonts/NimbusSans-Italic.otf"),
    ),
    copyFile(
      resolve(lilypondFontRoot, "NimbusSans-BoldItalic.otf"),
      resolve(outputRoot, "fonts/NimbusSans-BoldItalic.otf"),
    ),
    copyFile(
      resolve(lilypondFontRoot, "NimbusMonoPS-Regular.otf"),
      resolve(outputRoot, "fonts/NimbusMonoPS-Regular.otf"),
    ),
    copyFile(
      resolve(lilypondFontRoot, "NimbusMonoPS-Bold.otf"),
      resolve(outputRoot, "fonts/NimbusMonoPS-Bold.otf"),
    ),
    copyFile(
      resolve(lilypondFontRoot, "NimbusMonoPS-Italic.otf"),
      resolve(outputRoot, "fonts/NimbusMonoPS-Italic.otf"),
    ),
    copyFile(
      resolve(lilypondFontRoot, "NimbusMonoPS-BoldItalic.otf"),
      resolve(outputRoot, "fonts/NimbusMonoPS-BoldItalic.otf"),
    ),
    copyFile(
      resolve(lilypondFontRoot, "C059-Roman.otf"),
      resolve(outputRoot, "fonts/C059-Roman.otf"),
    ),
    copyFile(
      resolve(lilypondFontRoot, "C059-Bold.otf"),
      resolve(outputRoot, "fonts/C059-Bold.otf"),
    ),
    copyFile(
      resolve(lilypondFontRoot, "C059-Italic.otf"),
      resolve(outputRoot, "fonts/C059-Italic.otf"),
    ),
    copyFile(
      resolve(lilypondFontRoot, "C059-BdIta.otf"),
      resolve(outputRoot, "fonts/C059-BdIta.otf"),
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

  const noticePath = resolve(destinationRoot, "THIRD_PARTY_NOTICES.md");
  const notice = await Bun.file(noticePath).text();
  await Bun.write(
    noticePath,
    notice.replaceAll("](editor/", "](../../source/editor/"),
  );
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
    "third-party",
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
      resolve(repositoryRoot, "third-party/sources"),
      resolve(sourceRoot, "third-party/sources"),
      includeRepositorySource,
    ),
    copyTree(
      lilypondLanguagePackageRoot,
      resolve(sourceRoot, "npm/codemirror-lang-lilypond"),
      includeRepositorySource,
    ),
    copyTree(
      csoundLanguagePackageRoot,
      resolve(sourceRoot, "npm/codemirror-lang-csound"),
      includeRepositorySource,
    ),
    ...csoundLanguageFallbackNotices.map((fileName) =>
      copyFile(
        bundledNoticeFallbackSource(
          "@hlolli/codemirror-lang-csound",
          fileName,
        ),
        resolve(sourceRoot, "npm/codemirror-lang-csound", fileName),
      )
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
    "- [Csound CodeMirror exact npm bundle](npm/codemirror-lang-csound/dist/index.js)",
    "- [Csound CodeMirror preferred source](third-party/sources/codemirror-lang-csound/src/csound.grammar)",
    "- [Csound Manual notice and terms](third-party/licenses/csound-manual/COPYING)",
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
    ...csoundLanguageFallbackNotices.map((fileName) =>
      copyFile(
        bundledNoticeFallbackSource(
          "@hlolli/codemirror-lang-csound",
          fileName,
        ),
        resolve(
          editorSourceRoot,
          "licenses/npm/@hlolli/codemirror-lang-csound",
          fileName,
        ),
      )
    ),
    copyFile(
      resolve(csoundLanguagePackageRoot, "THIRD_PARTY_NOTICES.md"),
      resolve(
        editorSourceRoot,
        "licenses/npm/@hlolli/codemirror-lang-csound/THIRD_PARTY_NOTICES.md",
      ),
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
  await copyPdfkitPrebundleNotices(
    resolve(editorSourceRoot, "licenses/npm/pdfkit"),
  );
}

type PackageManifest = {
  name?: string;
  version?: string;
  license?: string;
  repository?: string | { url?: string };
};

async function copyPdfkitPrebundleNotices(destinationRoot: string) {
  const packages: Array<{
    name: string;
    version: string;
    license: string;
    files: string[];
  }> = [];

  for (const name of pdfkitStandalonePackages) {
    const sourceRoot = resolve(projectRoot, "node_modules", name);
    const manifestPath = resolve(sourceRoot, "package.json");
    const manifest = await Bun.file(manifestPath).json() as PackageManifest;
    const version = manifest.version ?? "unknown";
    const packageDestination = resolve(
      destinationRoot,
      "prebundled/packages",
      name,
      version,
    );
    const entries = await readdir(sourceRoot, { withFileTypes: true });
    const licenseFiles = entries
      .filter((entry) =>
        entry.isFile() &&
        /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(entry.name)
      )
      .map((entry) => entry.name)
      .sort();
    const copiedFiles = licenseFiles.length > 0
      ? licenseFiles
      : manifest.license === "MIT"
      ? ["DECLARED-MIT.txt"]
      : [];

    await Promise.all([
      copyFile(manifestPath, resolve(packageDestination, "package.json")),
      ...licenseFiles.map((fileName) =>
        copyFile(
          resolve(sourceRoot, fileName),
          resolve(packageDestination, fileName),
        )
      ),
      ...(copiedFiles.includes("DECLARED-MIT.txt")
        ? [
          copyFile(
            resolve(pdfkitPackageRoot, "LICENSE"),
            resolve(packageDestination, "DECLARED-MIT.txt"),
          ),
        ]
        : []),
    ]);

    packages.push({
      name,
      version,
      license: manifest.license ?? "See source notices",
      files: copiedFiles,
    });
  }

  const termsRoot = resolve(destinationRoot, "prebundled/terms");
  const standaloneSource = await Bun.file(
    resolve(pdfkitPackageRoot, "js/pdfkit.standalone.js"),
  ).text();
  const moduleNames = new Set<string>();
  for (const match of standaloneSource.matchAll(
    /,(\{(?:"[^"\n]+":\d+,?)+\})\](?:,\d+:\[function|\},\{\},\[\d+\]\)\()/g,
  )) {
    try {
      const dependencies = JSON.parse(match[1] ?? "{}") as Record<string, number>;
      for (const dependency of Object.keys(dependencies)) {
        if (dependency.startsWith(".")) {
          continue;
        }
        const normalized = dependency.replace(/\/$/, "");
        const name = normalized === "_process"
          ? "process"
          : normalized.startsWith("@")
          ? normalized.split("/").slice(0, 2).join("/")
          : normalized.split("/", 1)[0];
        if (name) {
          moduleNames.add(name);
        }
      }
    } catch {
      // Keep the exact prebuilt source even if a future module map changes.
    }
  }
  for (const expectedName of [
    "@noble/ciphers",
    "available-typed-arrays",
    "fontkit",
    "pako",
    "readable-stream",
  ]) {
    if (!moduleNames.has(expectedName)) {
      throw new Error(
        `PDFKit's standalone module inventory is missing ${expectedName}.`,
      );
    }
  }
  await Promise.all([
    copyFile(
      resolve(pdfkitPackageRoot, "LICENSE"),
      resolve(destinationRoot, "LICENSE"),
    ),
    copyFile(
      resolve(pdfkitPackageRoot, "package.json"),
      resolve(destinationRoot, "package.json"),
    ),
    copyFile(
      resolve(pdfkitPackageRoot, "js/pdfkit.standalone.js"),
      resolve(destinationRoot, "PREBUNDLED_SOURCE.js"),
    ),
    copyFile(
      resolve(repositoryRoot, "third-party/licenses/wasi-libc/LICENSE-APACHE"),
      resolve(termsRoot, "Apache-2.0.txt"),
    ),
    copyFile(
      resolve(
        projectRoot,
        "licenses/npm/@napi-rs/wasm-runtime/prebundled/ieee754/1.2.1/LICENSE",
      ),
      resolve(termsRoot, "BSD-3-Clause-ieee754.txt"),
    ),
    copyFile(
      resolve(
        projectRoot,
        "licenses/npm/@napi-rs/wasm-runtime/prebundled/tslib/2.8.1/LICENSE.txt",
      ),
      resolve(termsRoot, "0BSD-tslib.txt"),
    ),
    copyFile(
      resolve(
        projectRoot,
        "licenses/npm/@napi-rs/wasm-runtime/prebundled/buffer/6.0.3/LICENSE",
      ),
      resolve(termsRoot, "MIT-buffer.txt"),
    ),
    copyFile(
      resolve(
        projectRoot,
        "licenses/npm/@napi-rs/wasm-runtime/prebundled/safe-buffer/5.2.1/LICENSE",
      ),
      resolve(termsRoot, "MIT-safe-buffer.txt"),
    ),
    copyFile(
      resolve(
        projectRoot,
        "licenses/npm/@napi-rs/wasm-runtime/prebundled/borrowed/NODE-JOYENT-MIT.txt",
      ),
      resolve(termsRoot, "MIT-Node-Joyent.txt"),
    ),
    copyFile(
      resolve(projectRoot, "licenses/npm/pdfkit/INSPECT-JS-MIT.txt"),
      resolve(termsRoot, "MIT-Inspect-JS.txt"),
    ),
    copyFile(
      resolve(projectRoot, "node_modules/pako/lib/zlib/README"),
      resolve(termsRoot, "Zlib-pako.txt"),
    ),
  ]);

  const rows = packages.map((entry) => {
    const root = `prebundled/packages/${sourceLink(entry.name)}/${entry.version}`;
    const files = entry.files.length > 0
      ? entry.files.map((file) => `[${file}](${root}/${file})`).join(", ")
      : `[package metadata](${root}/package.json)`;
    return `| \`${entry.name}\` | ${entry.version} | ${entry.license} | ${files} |`;
  });
  const notice = [
    "# PDFKit standalone browser bundle",
    "",
    "The editor imports `pdfkit@0.19.1` through its published",
    "`js/pdfkit.standalone.js` file. That Browserify file contains PDFKit,",
    "its run-time packages, browser shims, and standard PDF font metrics.",
    "",
    "The build keeps the [exact published file](PREBUNDLED_SOURCE.js),",
    "[PDFKit metadata](package.json), and [PDFKit MIT terms](LICENSE). Its",
    "inline copyright and licence notices stay intact.",
    "",
    "## Locked top-level run-time packages",
    "",
    "| Package | Version | Declared licence | Copied terms |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "## Distinct external names in the Browserify module map",
    "",
    ...[...moduleNames].sort().map((name) => `- \`${name}\``),
    "",
    "Browserify also packs Node browser shims and small support modules into",
    "the one file. The list above comes from that file, but its module map does",
    "not state nested package versions and can contain more than one copy of a",
    "name. The exact prebuilt source controls. Its source notices remain intact,",
    "and full terms that its short notices refer to are copied here:",
    "",
    "- [Apache-2.0](prebundled/terms/Apache-2.0.txt) for Google Brotli and `@swc/helpers`.",
    "- [BSD-3-Clause](prebundled/terms/BSD-3-Clause-ieee754.txt) for `ieee754`.",
    "- [0BSD](prebundled/terms/0BSD-tslib.txt) for `tslib`.",
    "- [MIT buffer terms](prebundled/terms/MIT-buffer.txt) and [safe-buffer terms](prebundled/terms/MIT-safe-buffer.txt).",
    "- [Node and Joyent MIT terms](prebundled/terms/MIT-Node-Joyent.txt) for the stream and utility shims.",
    "- [Inspect JS MIT terms](prebundled/terms/MIT-Inspect-JS.txt) for the `call-bind`, `es-*`, typed-array, and related helpers.",
    "- [zlib terms](prebundled/terms/Zlib-pako.txt) for pako's ported zlib code.",
    "",
    "The package table records the editor's exact locked top-level install. It",
    "helps trace the source, but does not claim to version every module packed",
    "earlier by PDFKit upstream.",
    "",
  ].join("\n");
  await Bun.write(
    resolve(destinationRoot, "PREBUNDLED_THIRD_PARTY_NOTICES.md"),
    notice,
  );
}

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
    const canonicalLilypondNotice = name === "@hlolli/lilypond-wasm" &&
      noticeFiles.includes("THIRD_PARTY_NOTICES.md");
    const napiPrebundle = name === "@napi-rs/wasm-runtime";
    const pdfkitPrebundle = name === "pdfkit";
    const fallbackNoticeFiles = (
      bundledNoticeFallbacks.get(name) ?? []
    ).filter((fileName) =>
      !noticeFiles.includes(fileName) &&
      !(pdfkitPrebundle && fileName === "PREBUNDLED_THIRD_PARTY_NOTICES.md")
    );
    const packageNoticeFiles = canonicalLilypondNotice
      ? noticeFiles.filter((fileName) => fileName !== "THIRD_PARTY_NOTICES.md")
      : noticeFiles;
    const copiedNoticeFiles = [
      ...packageNoticeFiles,
      ...fallbackNoticeFiles,
      ...(canonicalLilypondNotice ? ["THIRD_PARTY_NOTICES.md"] : []),
      ...(napiPrebundle ? ["PREBUNDLED_SOURCE.js"] : []),
      ...(pdfkitPrebundle
        ? ["PREBUNDLED_SOURCE.js", "PREBUNDLED_THIRD_PARTY_NOTICES.md"]
        : []),
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
          bundledNoticeFallbackSource(name, fileName),
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
      ...(pdfkitPrebundle
        ? [
          copyPdfkitPrebundleNotices(destinationRoot),
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

function outputPathForImport(
  metafile: Bun.BuildMetafile,
  importPath: string,
) {
  const normalizedImport = normalizedMetafilePath(importPath);
  const paths = Object.keys(metafile.outputs);
  const exact = paths.find((path) =>
    normalizedMetafilePath(path) === normalizedImport
  );
  if (exact) {
    return exact;
  }

  const fileName = normalizedImport.split("/").at(-1);
  const matches = fileName
    ? paths.filter((path) => normalizedMetafilePath(path).endsWith(`/${fileName}`))
    : [];
  return matches.length === 1 ? matches[0] : null;
}

function reachableOutputs(
  metafile: Bun.BuildMetafile,
  roots: string[],
) {
  const reached = new Set<string>();
  const pending = [...roots];

  while (pending.length > 0) {
    const path = pending.pop();
    if (!path || reached.has(path)) {
      continue;
    }
    reached.add(path);
    const output = metafile.outputs[path];
    if (!output) {
      continue;
    }
    for (const entry of output.imports) {
      const importedPath = outputPathForImport(metafile, entry.path);
      if (importedPath && !reached.has(importedPath)) {
        pending.push(importedPath);
      }
    }
  }

  return reached;
}

async function assertLazyPdfChunks(metafile: Bun.BuildMetafile | undefined) {
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
  const isPdfWrapperInput = (path: string) =>
    normalizedMetafilePath(path).endsWith("pdf/export-pdf.ts");
  const isPdfInput = (path: string) => {
    const normalized = normalizedMetafilePath(path);
    return isPdfWrapperInput(path) ||
      normalized.includes("node_modules/pdfkit/") ||
      normalized.includes("node_modules/svg-to-pdfkit/");
  };
  if (Object.keys(initialOutput.inputs).some(isPdfInput)) {
    throw new Error("The PDF wrapper leaked into the initial editor bundle.");
  }

  const pdfOutputs = outputs.filter(([, output]) =>
    Object.keys(output.inputs).some(isPdfInput)
  );
  if (pdfOutputs.length === 0) {
    throw new Error("The editor build has no PDF export chunks.");
  }

  const wrapperOutput = outputs.find(([, output]) =>
    Object.keys(output.inputs).some(isPdfWrapperInput)
  );
  if (!wrapperOutput) {
    throw new Error("The editor build has no chunk for pdf/export-pdf.ts.");
  }
  const [wrapperPath] = wrapperOutput;
  const importsWrapperLazily = initialOutput.imports.some((entry) =>
    entry.kind === "dynamic-import" &&
    normalizedMetafilePath(entry.path) === normalizedMetafilePath(wrapperPath)
  );
  if (!importsWrapperLazily) {
    throw new Error("The initial editor bundle does not load PDF export lazily.");
  }

  const staticRoots = initialOutput.imports
    .filter((entry) => entry.kind !== "dynamic-import")
    .map((entry) => outputPathForImport(metafile, entry.path))
    .filter((path): path is string => path !== null);
  const staticOutputs = reachableOutputs(metafile, staticRoots);
  const dynamicOutputs = reachableOutputs(metafile, [wrapperPath]);

  for (const [path] of pdfOutputs) {
    if (staticOutputs.has(path)) {
      throw new Error(`The initial editor bundle loads ${path} eagerly.`);
    }
    if (!dynamicOutputs.has(path)) {
      throw new Error(`The PDF export cannot reach its lazy chunk ${path}.`);
    }
    await requireFile(resolve(outputRoot, normalizedMetafilePath(path)));
  }

  const bytes = pdfOutputs.reduce((total, [, output]) => total + output.bytes, 0);
  console.log(
    `Lazy PDF chunks: ${normalizedMetafilePath(initialPath)} -> ` +
      `${pdfOutputs.length} chunks (${(bytes / 1024 / 1024).toFixed(1)} MiB)`,
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
    "fonts/NimbusSans-Italic.otf",
    "fonts/NimbusSans-BoldItalic.otf",
    "fonts/NimbusMonoPS-Regular.otf",
    "fonts/NimbusMonoPS-Bold.otf",
    "fonts/NimbusMonoPS-Italic.otf",
    "fonts/NimbusMonoPS-BoldItalic.otf",
    "fonts/C059-Roman.otf",
    "fonts/C059-Bold.otf",
    "fonts/C059-Italic.otf",
    "fonts/C059-BdIta.otf",
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
    "licenses/npm/@hlolli/codemirror-lang-csound/LICENSE",
    "licenses/npm/@hlolli/codemirror-lang-csound/CSOUND_MANUAL_NOTICE.md",
    "licenses/npm/@hlolli/codemirror-lang-csound/CSOUND_MANUAL_COPYING",
    "licenses/npm/@hlolli/codemirror-lang-csound/THIRD_PARTY_NOTICES.md",
    "licenses/npm/codemirror-lang-lilypond/LICENSE",
    "licenses/npm/pdfkit/LICENSE",
    "licenses/npm/pdfkit/PREBUNDLED_SOURCE.js",
    "licenses/npm/pdfkit/PREBUNDLED_THIRD_PARTY_NOTICES.md",
    "licenses/npm/svg-to-pdfkit/LICENSE",
    "source/README.md",
    "source/REVISION.txt",
    "source/COPYING",
    "source/LICENSE",
    "source/THIRD_PARTY_NOTICES.md",
    "source/flake.lock",
    "source/nix/patches/gmp-wasi.patch",
    "source/third-party/licenses/lilypond/COPYING",
    "source/third-party/licenses/codemirror-lang-csound/LICENSE",
    "source/third-party/licenses/codemirror-lang-csound/CSOUND_MANUAL_NOTICE.md",
    "source/third-party/licenses/codemirror-lang-csound/CSOUND_MANUAL_COPYING",
    "source/third-party/licenses/csound-manual/COPYING",
    "source/third-party/sources/codemirror-lang-csound/REVISION.txt",
    "source/third-party/sources/codemirror-lang-csound/LICENSE",
    "source/third-party/sources/codemirror-lang-csound/CSOUND_MANUAL_NOTICE.md",
    "source/third-party/sources/codemirror-lang-csound/package.json",
    "source/third-party/sources/codemirror-lang-csound/scripts/build.ts",
    "source/third-party/sources/codemirror-lang-csound/src/csound.grammar",
    "source/third-party/sources/codemirror-lang-csound/src/builtin-opcodes.json",
    "source/third-party/sources/codemirror-lang-csound/src/builtin-scoregens.json",
    "source/npm/codemirror-lang-lilypond/LICENSE",
    "source/npm/codemirror-lang-lilypond/package.json",
    "source/npm/codemirror-lang-lilypond/src/index.ts",
    "source/npm/codemirror-lang-csound/LICENSE",
    "source/npm/codemirror-lang-csound/CSOUND_MANUAL_NOTICE.md",
    "source/npm/codemirror-lang-csound/CSOUND_MANUAL_COPYING",
    "source/npm/codemirror-lang-csound/THIRD_PARTY_NOTICES.md",
    "source/npm/codemirror-lang-csound/dist/index.js",
    "source/npm/codemirror-lang-csound/dist/index.js.map",
    "source/editor/SOURCE_FILES.md",
    "source/editor/COPYING",
    "source/editor/LICENSE",
    "source/editor/EDITOR_SOURCE.md",
    "source/editor/licenses/lilypond-wasm/THIRD_PARTY_NOTICES.md",
    "source/editor/licenses/csound-browser/LICENSE",
    "source/editor/licenses/csound-browser/THIRD_PARTY.md",
    "source/editor/licenses/npm/README.md",
    "source/editor/licenses/npm/@hlolli/codemirror-lang-csound/LICENSE",
    "source/editor/licenses/npm/@hlolli/codemirror-lang-csound/CSOUND_MANUAL_NOTICE.md",
    "source/editor/licenses/npm/@hlolli/codemirror-lang-csound/CSOUND_MANUAL_COPYING",
    "source/editor/licenses/npm/@hlolli/codemirror-lang-csound/THIRD_PARTY_NOTICES.md",
    "source/editor/licenses/npm/pdfkit/LICENSE",
    "source/editor/licenses/npm/pdfkit/package.json",
    "source/editor/licenses/npm/pdfkit/PREBUNDLED_SOURCE.js",
    "source/editor/licenses/npm/pdfkit/PREBUNDLED_THIRD_PARTY_NOTICES.md",
    "source/editor/licenses/npm/pdfkit/prebundled/terms/Apache-2.0.txt",
    "source/editor/licenses/npm/pdfkit/prebundled/terms/BSD-3-Clause-ieee754.txt",
    "source/editor/licenses/npm/pdfkit/prebundled/terms/0BSD-tslib.txt",
    "source/editor/licenses/npm/pdfkit/prebundled/terms/MIT-Inspect-JS.txt",
    "source/editor/licenses/lekton/Lekton-Regular.ttf",
    "source/editor/bun.lock",
    "source/editor/main.ts",
    "source/editor/package.json",
    "source/editor/scripts/build.ts",
    "licenses/npm/pdfkit/package.json",
    "licenses/npm/pdfkit/prebundled/terms/Apache-2.0.txt",
    "licenses/npm/pdfkit/prebundled/terms/BSD-3-Clause-ieee754.txt",
    "licenses/npm/pdfkit/prebundled/terms/0BSD-tslib.txt",
    "licenses/npm/pdfkit/prebundled/terms/MIT-Inspect-JS.txt",
  ];

  await Promise.all(
    expectedFiles.map((relativePath) =>
      requireFile(resolve(outputRoot, relativePath))
    ),
  );

  const csoundLanguageSourceMap = await Bun.file(
    resolve(
      outputRoot,
      "source/npm/codemirror-lang-csound/dist/index.js.map",
    ),
  ).json() as { sources?: string[]; sourcesContent?: Array<string | null> };
  const { sources, sourcesContent } = csoundLanguageSourceMap;
  if (
    !sources?.length ||
    !sourcesContent ||
    sourcesContent.length !== sources.length ||
    sourcesContent.some((source) => source === null)
  ) {
    throw new Error(
      "The Csound CodeMirror source map does not contain embedded source entries.",
    );
  }

  const csoundLanguageRevision = await Bun.file(
    resolve(
      outputRoot,
      "source/third-party/sources/codemirror-lang-csound/REVISION.txt",
    ),
  ).text();
  const csoundLanguageManifest = await Bun.file(
    resolve(csoundLanguagePackageRoot, "package.json"),
  ).json() as PackageManifest;
  const sourceVersion = csoundLanguageRevision.match(/^version: (.+)$/m)?.[1];
  if (!sourceVersion || sourceVersion !== csoundLanguageManifest.version) {
    throw new Error(
      "The Csound CodeMirror source version does not match the npm package.",
    );
  }
  for (const expected of [
    "version: 1.0.0-alpha11",
    "tag: v1.0.0-alpha11",
    "commit: e43b2ff18e78c4d4358969999e22f5afb4948425",
  ]) {
    if (!csoundLanguageRevision.includes(expected)) {
      throw new Error(`The Csound CodeMirror source pin is missing ${expected}`);
    }
  }

  await assertMarkdownLinks([
    "EDITOR_SOURCE.md",
    "THIRD_PARTY_NOTICES.md",
    "licenses/lilypond-wasm/THIRD_PARTY_NOTICES.md",
    "licenses/npm/README.md",
    "licenses/npm/@hlolli/lilypond-wasm/THIRD_PARTY_NOTICES.md",
    "licenses/npm/@napi-rs/wasm-runtime/PREBUNDLED_THIRD_PARTY_NOTICES.md",
    "licenses/npm/pdfkit/PREBUNDLED_THIRD_PARTY_NOTICES.md",
    "source/README.md",
    "licenses/npm/@hlolli/codemirror-lang-csound/CSOUND_MANUAL_NOTICE.md",
    "source/THIRD_PARTY_NOTICES.md",
    "source/third-party/licenses/codemirror-lang-csound/CSOUND_MANUAL_NOTICE.md",
    "source/third-party/sources/codemirror-lang-csound/CSOUND_MANUAL_NOTICE.md",
    "source/npm/codemirror-lang-csound/CSOUND_MANUAL_NOTICE.md",
    "source/editor/EDITOR_SOURCE.md",
    "source/editor/SOURCE_FILES.md",
    "source/editor/THIRD_PARTY_NOTICES.md",
    "source/editor/licenses/lilypond-wasm/THIRD_PARTY_NOTICES.md",
    "source/editor/licenses/npm/README.md",
    "source/editor/licenses/npm/@hlolli/codemirror-lang-csound/CSOUND_MANUAL_NOTICE.md",
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
await assertLazyPdfChunks(result.metafile);

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
