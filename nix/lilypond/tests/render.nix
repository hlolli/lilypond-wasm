{
  guile,
  lilypond,
  lilypondAssets,
  runCommand,
  wasmtime,
}:
assert lilypond.version == lilypondAssets.version;
  runCommand "lilypond-svg-wasi-render-smoke-${lilypond.version}"
  {
    nativeBuildInputs = [wasmtime];
  }
  ''
    mkdir -p work/cache/fontconfig work/home work/lily-lib work/tmp
    cp ${./smoke.ly} work/smoke.ly

    wasmtime run \
      -W exceptions=y \
      -W timeout=600s \
      -C cache=n \
      --dir "$PWD/work::/work" \
      --dir ${lilypondAssets}/share/lilypond/${lilypondAssets.version}::/lilypond \
      --dir ${guile}/share/guile/3.0::/guile \
      --dir ${guile}/lib/guile/3.0/ccache::/guile-ccache \
      --env FONTCONFIG_FILE=/lilypond/fonts/fonts.conf \
      --env FONTCONFIG_PATH=/lilypond/fonts \
      --env GUILE_AUTO_COMPILE=0 \
      --env GUILE_LOAD_PATH=/guile \
      --env GUILE_LOAD_COMPILED_PATH=/guile-ccache \
      --env GUILE_SYSTEM_PATH=/guile \
      --env GUILE_SYSTEM_COMPILED_PATH=/guile-ccache \
      --env HOME=/work/home \
      --env LILYPOND_DATADIR=/lilypond \
      --env LILYPOND_LIBDIR=/work/lily-lib \
      --env TMPDIR=/work/tmp \
      --env XDG_CACHE_HOME=/work/cache \
      --argv0 /lilypond \
      ${lilypond}/bin/lilypond.wasm \
      -dbackend=svg \
      -djob-count=1 \
      -dpoint-and-click=#f \
      -drandom-seed=1 \
      --formats=svg \
      -o /work/smoke \
      /work/smoke.ly

    test -s work/smoke.svg
    grep -F "<svg" work/smoke.svg
    grep -F "<path" work/smoke.svg
    grep -F "<text" work/smoke.svg
    grep -F 'font-family="C059"' work/smoke.svg
    grep -F ">WASI Text</tspan>" work/smoke.svg
    grep -F ">Bun</tspan>" work/smoke.svg
    grep -F ">dled</tspan>" work/smoke.svg
    grep -F ">text</tspan>" work/smoke.svg
    grep -F ">works.</tspan>" work/smoke.svg

    mkdir -p "$out"
    cp work/smoke.svg "$out/"
  ''
