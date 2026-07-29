const packageRootUrl = new URL("./", import.meta.url);

const resolvePackageFile = (path) => new URL(path, packageRootUrl);

export const lilypondVersion = "2.27.2";
export const guileVersion = "3.0.11";
export const wasmMetadataSection = "lilypond-wasm.metadata";

export const lilypondWasmUrl = resolvePackageFile("dist/lilypond.wasm");
export const lilypondDataUrl = resolvePackageFile(
  `runtime/lilypond/${lilypondVersion}/`,
);
export const lilypondCompiledUrl = resolvePackageFile(
  "runtime/lilypond-lib/",
);
export const guileCompiledUrl = resolvePackageFile(
  "runtime/guile-ccache/",
);
export const runtimeManifestUrl = resolvePackageFile("runtime-manifest.json");

export const runtimeMounts = Object.freeze({
  "/lilypond": lilypondDataUrl,
  "/guile-ccache": guileCompiledUrl,
  "/lilypond-lib": lilypondCompiledUrl,
});

// Keep LilyPond's compiled files after its source files. This matters for
// in-memory file systems that set file times as each mount is written.
export const runtimeMountOrder = Object.freeze([
  "/lilypond",
  "/guile-ccache",
  "/lilypond-lib",
]);

export const runtimeEnvironment = Object.freeze({
  FONTCONFIG_FILE: "/lilypond/fonts/fonts.conf",
  FONTCONFIG_PATH: "/lilypond/fonts",
  GUILE_AUTO_COMPILE: "0",
  GUILE_LOAD_PATH: "/guile",
  GUILE_LOAD_COMPILED_PATH: "/guile-ccache",
  GUILE_SYSTEM_PATH: "/guile",
  GUILE_SYSTEM_COMPILED_PATH: "/guile-ccache",
  HOME: "/work/home",
  LILYPOND_DATADIR: "/lilypond",
  LILYPOND_LIBDIR: "/lilypond-lib",
  TMPDIR: "/work/tmp",
  XDG_CACHE_HOME: "/work/cache",
});

export const runtimeRequirements = Object.freeze({
  argv0: "/lilypond",
  wasi: "preview1",
  wasmExceptions: true,
  writableDirectory: "/work",
});
