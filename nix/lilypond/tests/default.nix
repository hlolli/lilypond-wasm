{
  lilypond,
  runCommand,
  wasmtime,
}:
runCommand "lilypond-svg-wasi-link-smoke-${lilypond.version}"
{
  nativeBuildInputs = [wasmtime];
}
''
  version_output="$(
    wasmtime run \
      -W exceptions=y \
      -C cache=n \
      ${lilypond}/bin/lilypond.wasm \
      --version
  )"

  printf '%s\n' "$version_output" | grep -F "GNU LilyPond ${lilypond.version}"

  mkdir -p "$out"
  cp ${lilypond}/bin/lilypond.wasm "$out/"
  printf '%s\n' "$version_output" > "$out/result.txt"
''
