{
  binaryen,
  guile,
  pkg-config,
  runCommand,
  stdenvWasi,
  wasmtime,
}: let
  smokeProgram = stdenvWasi.mkDerivation {
    pname = "guile-wasi-smoke-program";
    inherit (guile) version;

    dontUnpack = true;

    nativeBuildInputs = [
      binaryen
      pkg-config
    ];
    buildInputs = [guile];

    buildPhase = ''
      runHook preBuild

      export PKG_CONFIG_PATH="${guile.dev}/lib/pkgconfig"

      $CC \
        -std=c11 \
        -Wall \
        -Wextra \
        -Werror \
        -Wno-unused-parameter \
        -O2 \
        -mllvm \
        -wasm-enable-sjlj \
        -mllvm \
        -wasm-use-legacy-eh=false \
        ${./smoke.c} \
        $(pkg-config --static --cflags --libs guile-3.0) \
        -o guile-smoke-raw.wasm

      wasm-opt \
        --fpcast-emu \
        guile-smoke-raw.wasm \
        -o guile-smoke.wasm

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p "$out/bin"
      cp guile-smoke.wasm "$out/bin/"

      runHook postInstall
    '';
  };
in
  runCommand "guile-wasi-smoke-${guile.version}"
  {
    nativeBuildInputs = [wasmtime];
  }
  ''
    smoke_output="$(
      wasmtime run \
        -W exceptions=y \
        -C cache=n \
        --dir ${guile}/share/guile/3.0::/guile \
        --dir ${guile}/lib/guile/3.0/ccache::/guile-ccache \
        --env GUILE_AUTO_COMPILE=0 \
        --env GUILE_LOAD_PATH=/guile \
        --env GUILE_LOAD_COMPILED_PATH=/guile-ccache \
        --env GUILE_SYSTEM_PATH=/guile \
        --env GUILE_SYSTEM_COMPILED_PATH=/guile-ccache \
        ${smokeProgram}/bin/guile-smoke.wasm
    )"
    expected_output="guile result: 6"

    test "$smoke_output" = "$expected_output"

    mkdir -p "$out"
    cp ${smokeProgram}/bin/guile-smoke.wasm "$out/"
    printf '%s\n' "$smoke_output" > "$out/result.txt"
  ''
