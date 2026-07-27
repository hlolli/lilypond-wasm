{
  font,
  freetype,
  harfbuzz,
  pkg-config,
  runCommand,
  stdenvWasi,
  wasmtime,
  zlib,
}: let
  smokeProgram = stdenvWasi.mkDerivation {
    pname = "harfbuzz-wasi-smoke-program";
    inherit (harfbuzz) version;

    dontUnpack = true;

    nativeBuildInputs = [pkg-config];

    buildPhase = ''
      runHook preBuild

      export PKG_CONFIG_LIBDIR="${harfbuzz.dev}/lib/pkgconfig:${freetype.dev}/lib/pkgconfig:${zlib.dev}/share/pkgconfig"

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
        $(pkg-config --static --cflags --libs harfbuzz) \
        -o harfbuzz-smoke.wasm

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p "$out/bin"
      cp harfbuzz-smoke.wasm "$out/bin/"

      runHook postInstall
    '';
  };
in
  runCommand "harfbuzz-wasi-smoke-${harfbuzz.version}"
  {
    nativeBuildInputs = [wasmtime];
  }
  ''
    smoke_output="$(
      wasmtime run \
        -W exceptions=y \
        -C cache=n \
        --dir ${font}/share/fonts/truetype::/fonts \
        ${smokeProgram}/bin/harfbuzz-smoke.wasm \
        /fonts/DejaVuSans.ttf
    )"
    expected_output="harfbuzz ${harfbuzz.version}: Latin ligature, Arabic shaping and WASI file checks passed"

    test "$smoke_output" = "$expected_output"

    mkdir -p "$out"
    cp ${smokeProgram}/bin/harfbuzz-smoke.wasm "$out/"
    printf '%s\n' "$smoke_output" > "$out/result.txt"
  ''
