{
  libpng,
  runCommand,
  stdenvWasi,
  wasmtime,
  zlib,
}: let
  smokeProgram = stdenvWasi.mkDerivation {
    pname = "libpng-wasi-smoke-program";
    inherit (libpng) version;

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
        -I${libpng.dev}/include/libpng16 \
        -I${zlib.dev}/include \
        ${./smoke.c} \
        ${libpng}/lib/libpng16.a \
        ${zlib}/lib/libz.a \
        -lsetjmp \
        -lm \
        -o libpng-smoke.wasm

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p "$out/bin"
      cp libpng-smoke.wasm "$out/bin/"

      runHook postInstall
    '';
  };
in
  runCommand "libpng-wasi-smoke-${libpng.version}"
  {
    nativeBuildInputs = [wasmtime];
  }
  ''
    smoke_output="$(wasmtime run -W exceptions=y -C cache=n ${smokeProgram}/bin/libpng-smoke.wasm)"
    expected_output="libpng ${libpng.version}: memory PNG and setjmp checks passed"

    test "$smoke_output" = "$expected_output"

    mkdir -p "$out"
    cp ${smokeProgram}/bin/libpng-smoke.wasm "$out/"
    printf '%s\n' "$smoke_output" > "$out/result.txt"
  ''
