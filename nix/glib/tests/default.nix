{
  binaryen,
  glib,
  lib,
  libffi,
  pcre2,
  pkg-config,
  runCommand,
  stdenvWasi,
  wasmtime,
}: let
  smokeProgram = stdenvWasi.mkDerivation {
    pname = "glib-wasi-smoke-program";
    inherit (glib) version;

    dontUnpack = true;

    nativeBuildInputs = [
      binaryen
      pkg-config
    ];

    buildPhase = ''
      runHook preBuild

      export PKG_CONFIG_LIBDIR="${glib.dev}/lib/pkgconfig:${libffi.dev}/lib/pkgconfig:${pcre2.dev}/lib/pkgconfig"

      $CC \
        -std=c11 \
        -Wall \
        -Wextra \
        -Werror \
        -O2 \
        ${./smoke.c} \
        $(pkg-config --static --cflags --libs gio-2.0) \
        -o glib-smoke-raw.wasm

      # GObject and its users cast C callbacks between compatible signatures.
      # WebAssembly checks indirect-call signatures exactly, so the final
      # linked module needs the pass advertised by the GLib package.
      wasm-opt \
        ${lib.escapeShellArgs glib.requiredFinalWasmOptFlags} \
        glib-smoke-raw.wasm \
        -o glib-smoke.wasm

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p "$out/bin"
      cp glib-smoke.wasm "$out/bin/"

      runHook postInstall
    '';
  };
in
  runCommand "glib-wasi-smoke-${glib.version}"
  {
    nativeBuildInputs = [wasmtime];
  }
  ''
    smoke_output="$(
      wasmtime run \
        -C cache=n \
        ${smokeProgram}/bin/glib-smoke.wasm
    )"
    expected_output="glib ${glib.version}: regex, base64, GObject, GListModel and WASI stubs passed"

    test "$smoke_output" = "$expected_output"

    mkdir -p "$out"
    cp ${smokeProgram}/bin/glib-smoke.wasm "$out/"
    printf '%s\n' "$smoke_output" > "$out/result.txt"
  ''
