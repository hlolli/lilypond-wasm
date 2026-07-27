{
  fribidi,
  runCommand,
  stdenvWasi,
  wasmtime,
}: let
  smokeProgram = stdenvWasi.mkDerivation {
    pname = "fribidi-wasi-smoke-program";
    inherit (fribidi) version;

    dontUnpack = true;

    buildPhase = ''
      runHook preBuild

      $CC \
        -std=c11 \
        -Wall \
        -Wextra \
        -Werror \
        -O2 \
        -I${fribidi.dev}/include/fribidi \
        ${./smoke.c} \
        ${fribidi}/lib/libfribidi.a \
        -o fribidi-smoke.wasm

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p "$out/bin"
      cp fribidi-smoke.wasm "$out/bin/"

      runHook postInstall
    '';
  };
in
  runCommand "fribidi-wasi-smoke-${fribidi.version}"
  {
    nativeBuildInputs = [wasmtime];
  }
  ''
    smoke_output="$(
      wasmtime run \
        -C cache=n \
        ${smokeProgram}/bin/fribidi-smoke.wasm
    )"
    expected_output="fribidi ${fribidi.version}: bidi levels and bracket pairs passed"

    test "$smoke_output" = "$expected_output"

    mkdir -p "$out"
    cp ${smokeProgram}/bin/fribidi-smoke.wasm "$out/"
    printf '%s\n' "$smoke_output" > "$out/result.txt"
  ''
