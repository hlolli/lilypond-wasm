{
  font,
  freetype,
  runCommand,
  stdenvWasi,
  wasmtime,
  xxd,
  zlib,
}: let
  smokeProgram = stdenvWasi.mkDerivation {
    pname = "freetype-wasi-smoke-program";
    inherit (freetype) version;

    dontUnpack = true;

    nativeBuildInputs = [xxd];

    buildPhase = ''
      runHook preBuild

      xxd \
        -i \
        -n fixture_font \
        ${font}/share/fonts/opentype/texgyrecursor-regular.otf \
        fixture.c

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
        -I${freetype.dev}/include/freetype2 \
        ${./smoke.c} \
        fixture.c \
        ${freetype}/lib/libfreetype.a \
        ${zlib}/lib/libz.a \
        -lsetjmp \
        -lm \
        -o freetype-smoke.wasm

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p "$out/bin"
      cp freetype-smoke.wasm "$out/bin/"

      runHook postInstall
    '';
  };
in
  runCommand "freetype-wasi-smoke-${freetype.version}"
  {
    nativeBuildInputs = [wasmtime];
  }
  ''
    smoke_output="$(
      wasmtime run \
        -W exceptions=y \
        -C cache=n \
        --dir ${font}/share/fonts/opentype::/fonts \
        ${smokeProgram}/bin/freetype-smoke.wasm \
        /fonts/texgyrecursor-regular.otf
    )"
    expected_output="freetype ${freetype.version}: CFF outline and validation checks passed"

    test "$smoke_output" = "$expected_output"

    mkdir -p "$out"
    cp ${smokeProgram}/bin/freetype-smoke.wasm "$out/"
    printf '%s\n' "$smoke_output" > "$out/result.txt"
  ''
