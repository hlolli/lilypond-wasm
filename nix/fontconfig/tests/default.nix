{
  expat,
  font,
  fontconfig,
  freetype,
  runCommand,
  stdenvWasi,
  wasmtime,
  zlib,
}: let
  smokeProgram = stdenvWasi.mkDerivation {
    pname = "fontconfig-wasi-smoke-program";
    inherit (fontconfig) version;

    dontUnpack = true;

    buildPhase = ''
      runHook preBuild

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
        -I${fontconfig.dev}/include \
        -I${freetype.dev}/include/freetype2 \
        ${./smoke.c} \
        ${fontconfig}/lib/libfontconfig.a \
        ${freetype}/lib/libfreetype.a \
        ${expat}/lib/libexpat.a \
        ${zlib}/lib/libz.a \
        -lsetjmp \
        -lm \
        -o fontconfig-smoke.wasm

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p "$out/bin"
      cp fontconfig-smoke.wasm "$out/bin/"

      runHook postInstall
    '';
  };
in
  runCommand "fontconfig-wasi-smoke-${fontconfig.version}"
  {
    nativeBuildInputs = [wasmtime];
  }
  ''
    smoke_output="$(
      wasmtime run \
        -W exceptions=y \
        -C cache=n \
        --dir ${font}/share/fonts/opentype::/fonts \
        ${smokeProgram}/bin/fontconfig-smoke.wasm \
        /fonts/texgyrecursor-regular.otf
    )"
    expected_output="fontconfig 2.18.1: config, scan and match checks passed"

    test "$smoke_output" = "$expected_output"

    mkdir -p "$out"
    cp ${smokeProgram}/bin/fontconfig-smoke.wasm "$out/"
    printf '%s\n' "$smoke_output" > "$out/result.txt"
  ''
