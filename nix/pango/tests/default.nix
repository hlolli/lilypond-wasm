{
  binaryen,
  expat,
  font,
  fontconfig,
  freetype,
  fribidi,
  glib,
  harfbuzz,
  lib,
  libffi,
  pango,
  pcre2,
  pkg-config,
  runCommand,
  stdenvWasi,
  wasmtime,
  zlib,
}: let
  smokeProgram = stdenvWasi.mkDerivation {
    pname = "pango-wasi-smoke-program";
    inherit (pango) version;

    dontUnpack = true;

    nativeBuildInputs = [
      binaryen
      pkg-config
    ];

    buildPhase = ''
      runHook preBuild

      export PKG_CONFIG_LIBDIR="${
        lib.concatStringsSep ":" [
          "${pango.dev}/lib/pkgconfig"
          "${glib.dev}/lib/pkgconfig"
          "${libffi.dev}/lib/pkgconfig"
          "${pcre2.dev}/lib/pkgconfig"
          "${harfbuzz.dev}/lib/pkgconfig"
          "${fribidi.dev}/lib/pkgconfig"
          "${fontconfig.dev}/lib/pkgconfig"
          "${expat.dev}/lib/pkgconfig"
          "${freetype.dev}/lib/pkgconfig"
          "${zlib.dev}/share/pkgconfig"
        ]
      }"

      $CC \
        -std=c11 \
        -Wall \
        -Wextra \
        -Werror \
        -O2 \
        -mllvm \
        -wasm-enable-sjlj \
        -mllvm \
        -wasm-use-legacy-eh=false \
        ${./smoke.c} \
        $(pkg-config --static --cflags --libs pangoft2) \
        -o pango-smoke-raw.wasm

      # Pango and GObject use compatible C callbacks with different declared
      # signatures. WebAssembly checks those signatures at indirect calls.
      wasm-opt \
        ${lib.escapeShellArgs pango.requiredFinalWasmOptFlags} \
        pango-smoke-raw.wasm \
        -o pango-smoke.wasm

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p "$out/bin"
      cp pango-smoke.wasm "$out/bin/"

      runHook postInstall
    '';
  };
in
  runCommand "pango-wasi-smoke-${pango.version}"
  {
    nativeBuildInputs = [wasmtime];
  }
  ''
    smoke_output="$(
      wasmtime run \
        -W exceptions=y \
        -C cache=n \
        --dir ${font}/share/fonts/truetype::/fonts \
        ${smokeProgram}/bin/pango-smoke.wasm \
        /fonts/DejaVuSans.ttf
    )"
    expected_output="pango ${pango.version}: font selection, Latin features and Arabic layout passed"

    test "$smoke_output" = "$expected_output"

    mkdir -p "$out"
    cp ${smokeProgram}/bin/pango-smoke.wasm "$out/"
    printf '%s\n' "$smoke_output" > "$out/result.txt"
  ''
