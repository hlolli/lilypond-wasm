export declare const lilypondVersion: "2.27.2";
export declare const guileVersion: "3.0.11";
export declare const wasmMetadataSection: "lilypond-wasm.metadata";

export declare const lilypondWasmUrl: URL;
export declare const lilypondDataUrl: URL;
export declare const guileCompiledUrl: URL;
export declare const runtimeManifestUrl: URL;

export declare const runtimeMounts: Readonly<{
  "/lilypond": URL;
  "/guile-ccache": URL;
}>;

export declare const runtimeEnvironment: Readonly<{
  FONTCONFIG_FILE: "/lilypond/fonts/fonts.conf";
  FONTCONFIG_PATH: "/lilypond/fonts";
  GUILE_AUTO_COMPILE: "0";
  GUILE_LOAD_PATH: "/guile";
  GUILE_LOAD_COMPILED_PATH: "/guile-ccache";
  GUILE_SYSTEM_PATH: "/guile";
  GUILE_SYSTEM_COMPILED_PATH: "/guile-ccache";
  HOME: "/work/home";
  LILYPOND_DATADIR: "/lilypond";
  LILYPOND_LIBDIR: "/work/lily-lib";
  TMPDIR: "/work/tmp";
  XDG_CACHE_HOME: "/work/cache";
}>;

export declare const runtimeRequirements: Readonly<{
  argv0: "/lilypond";
  wasi: "preview1";
  wasmExceptions: true;
  writableDirectory: "/work";
}>;
