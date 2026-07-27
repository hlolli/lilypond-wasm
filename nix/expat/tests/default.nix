{
  expat,
  runCommand,
  stdenvWasi,
  wasmtime,
}: let
  smokeProgram = stdenvWasi.mkDerivation {
    pname = "expat-wasi-smoke-program";
    inherit (expat) version;

    dontUnpack = true;

    buildPhase = ''
      runHook preBuild

      $CC \
        -std=c11 \
        -Wall \
        -Wextra \
        -Werror \
        -O2 \
        -I${expat.dev}/include \
        ${./smoke.c} \
        ${expat}/lib/libexpat.a \
        -lm \
        -o expat-smoke.wasm

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p "$out/bin"
      cp expat-smoke.wasm "$out/bin/"

      runHook postInstall
    '';
  };
in
  runCommand "expat-wasi-smoke-${expat.version}"
  {
    nativeBuildInputs = [wasmtime];
  }
  ''
    smoke_output="$(wasmtime run -C cache=n ${smokeProgram}/bin/expat-smoke.wasm)"
    expected_output="expat ${expat.version}: streaming XML parse passed"

    test "$smoke_output" = "$expected_output"

    mkdir -p "$out"
    cp ${smokeProgram}/bin/expat-smoke.wasm "$out/"
    printf '%s\n' "$smoke_output" > "$out/result.txt"
  ''
