{
  pcre2,
  runCommand,
  stdenvWasi,
  wasmtime,
}: let
  smokeProgram = stdenvWasi.mkDerivation {
    pname = "pcre2-wasi-smoke-program";
    inherit (pcre2) version;

    dontUnpack = true;

    buildPhase = ''
      runHook preBuild

      $CC \
        -std=c11 \
        -Wall \
        -Wextra \
        -Werror \
        -O2 \
        -DPCRE2_CODE_UNIT_WIDTH=8 \
        -I${pcre2.dev}/include \
        ${./smoke.c} \
        ${pcre2}/lib/libpcre2-8.a \
        -o pcre2-smoke.wasm

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p "$out/bin"
      cp pcre2-smoke.wasm "$out/bin/"

      runHook postInstall
    '';
  };
in
  runCommand "pcre2-wasi-smoke-${pcre2.version}"
  {
    nativeBuildInputs = [wasmtime];
  }
  ''
    smoke_output="$(
      wasmtime run \
        -C cache=n \
        ${smokeProgram}/bin/pcre2-smoke.wasm
    )"
    expected_output="pcre2 ${pcre2.version}: UTF-8 matching and captures passed"

    test "$smoke_output" = "$expected_output"

    mkdir -p "$out"
    cp ${smokeProgram}/bin/pcre2-smoke.wasm "$out/"
    printf '%s\n' "$smoke_output" > "$out/result.txt"
  ''
