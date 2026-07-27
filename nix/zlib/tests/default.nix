{
  runCommand,
  stdenvWasi,
  wasmtime,
  zlib,
}: let
  smokeProgram = stdenvWasi.mkDerivation {
    pname = "zlib-wasi-smoke-program";
    inherit (zlib) version;

    dontUnpack = true;

    buildPhase = ''
      runHook preBuild

      $CC \
        -std=c11 \
        -Wall \
        -Wextra \
        -Werror \
        -O2 \
        -I${zlib.dev}/include \
        ${./smoke.c} \
        ${zlib}/lib/libz.a \
        -o zlib-smoke.wasm

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p "$out/bin"
      cp zlib-smoke.wasm "$out/bin/"

      runHook postInstall
    '';
  };
in
  runCommand "zlib-wasi-smoke-${zlib.version}"
  {
    nativeBuildInputs = [wasmtime];
  }
  ''
    smoke_output="$(wasmtime run -C cache=n ${smokeProgram}/bin/zlib-smoke.wasm)"
    expected_output="zlib ${zlib.version}: inflate round trip passed"

    test "$smoke_output" = "$expected_output"

    mkdir -p "$out"
    cp ${smokeProgram}/bin/zlib-smoke.wasm "$out/"
    printf '%s\n' "$smoke_output" > "$out/result.txt"
  ''
