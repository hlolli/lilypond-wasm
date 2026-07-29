{
  coreutils,
  diffutils,
  file,
  guile,
  lib,
  lilypond,
  lilypondAssets,
  runCommand,
  wasmtime,
}:
assert lib.assertMsg
  (lilypond.version == lilypondAssets.version)
  "LilyPond and its assets must have the same version";
  runCommand "lilypond-svg-wasi-bytecode-${lilypond.version}"
  {
    nativeBuildInputs = [
      coreutils
      diffutils
      file
      wasmtime
    ];

    meta = {
      description = "Precompiled LilyPond Scheme modules for the WASI SVG runtime";
      homepage = "https://lilypond.org/";
      license = lib.licenses.gpl3Plus;
      platforms = lib.platforms.all;
    };
  }
  ''
    assets="${lilypondAssets}/share/lilypond/${lilypondAssets.version}"
    data_dir="$PWD/lilypond"

    # Guile writes auto-compiled files below LilyPond's data directory.
    # Use a fixed guest path so no Nix build path enters the bytecode.
    mkdir -p "$data_dir"
    cp -R --preserve=timestamps "$assets/." "$data_dir/"
    chmod -R u+w "$data_dir"

    mkdir -p work/cache/fontconfig work/home work/lily-lib work/tmp
    cp ${./compile-svg.ly} work/compile-svg.ly

    run_lilypond() {
      local auto_compile="$1"
      local lilypond_libdir="$2"
      shift 2

      # Keep the limit outside Wasmtime. Its epoch timeout can slow this
      # workload sharply; the host-side limit only guards a stuck build.
      timeout 120s wasmtime run \
        -W exceptions=y \
        -C cache=n \
        --dir "$PWD/work::/work" \
        --dir "$data_dir::/lilypond" \
        --dir ${guile}/share/guile/3.0::/guile \
        --dir ${guile}/lib/guile/3.0/ccache::/guile-ccache \
        "$@" \
        --env FONTCONFIG_FILE=/lilypond/fonts/fonts.conf \
        --env FONTCONFIG_PATH=/lilypond/fonts \
        --env GUILE_AUTO_COMPILE="$auto_compile" \
        --env GUILE_LOAD_PATH=/guile \
        --env GUILE_LOAD_COMPILED_PATH=/guile-ccache \
        --env GUILE_SYSTEM_PATH=/guile \
        --env GUILE_SYSTEM_COMPILED_PATH=/guile-ccache \
        --env HOME=/work/home \
        --env LILYPOND_DATADIR=/lilypond \
        --env LILYPOND_LIBDIR="$lilypond_libdir" \
        --env SOURCE_DATE_EPOCH=1 \
        --env TMPDIR=/work/tmp \
        --env XDG_CACHE_HOME=/work/cache \
        --argv0 /lilypond \
        ${lilypond}/bin/lilypond.wasm \
        -dbackend=svg \
        -ddeterministic \
        -djob-count=1 \
        -dpoint-and-click=#f \
        -drandom-seed=1 \
        --formats=svg \
        -o /work/compile-svg \
        /work/compile-svg.ly
    }

    run_lilypond 1 /work/lily-lib

    test -s work/compile-svg.svg
    cp work/compile-svg.svg work/compiled-from-source.svg

    generated="$data_dir/guile-bytecode"
    test -d "$generated"
    find "$generated" -type f -name '*.scm.go' | LC_ALL=C sort \
      > work/compiled-files.txt
    test -s work/compiled-files.txt

    mkdir -p "$out/ccache/lily"
    while IFS= read -r compiled; do
      module_name="$(basename "$compiled" .scm.go)"
      source_file="$assets/scm/lily/$module_name.scm"
      destination="$out/ccache/lily/$module_name.go"

      if test ! -f "$source_file"; then
        echo "compiled file has no LilyPond source: $compiled" >&2
        exit 1
      fi
      if test -e "$destination"; then
        echo "compiled module name collision: $module_name" >&2
        exit 1
      fi

      cp "$compiled" "$destination"

      # Guile only accepts bytecode at least as new as its source. Nix
      # normalizes store mtimes, and Guile treats equal mtimes as fresh.
      touch -r "$source_file" "$destination"
      chmod 0444 "$destination"
    done < work/compiled-files.txt

    # LilyPond startup plus the SVG driver currently loads 66 modules. Keep
    # this as a lower bound so a source update can add modules without an
    # unrelated edit here, but cannot silently ship a partial cache.
    compiled_count="$(
      find "$out/ccache/lily" -maxdepth 1 -type f -name '*.go' | wc -l
    )"
    if test "$compiled_count" -lt 66; then
      echo "expected at least 66 LilyPond modules, got $compiled_count" >&2
      exit 1
    fi

    for required_module in \
      lily \
      backend-library \
      font-encodings \
      framework-svg \
      output-svg \
      page \
      paper-system \
      clip-region
    do
      bytecode="$out/ccache/lily/$required_module.go"
      source_file="$assets/scm/lily/$required_module.scm"
      test -s "$bytecode"
      if test "$bytecode" -ot "$source_file"; then
        echo "stale bytecode: $bytecode" >&2
        exit 1
      fi
    done

    # Guile bytecode is ELF with its own neutral machine type. A 64-bit file
    # here means the WASI compiler used the host word size and will not load.
    for target_module in lily framework-svg; do
      description="$(file -b "$out/ccache/lily/$target_module.go")"
      printf '%s\n' "$description" | grep -F "ELF 32-bit LSB"
    done

    # Prove a fresh process accepts the files we will package. Remove the
    # build cache and make every matching source fail if Guile falls back to
    # it. Equal file times are valid and match Nix and npm package output.
    mv "$generated" work/generated-bytecode
    for bytecode in "$out/ccache/lily/"*.go; do
      module_name="$(basename "$bytecode" .go)"
      source_file="$data_dir/scm/lily/$module_name.scm"
      printf '%s\n' \
        '(error "LilyPond bytecode cache was not used")' \
        > "$source_file"
      touch -r "$bytecode" "$source_file"
    done

    run_lilypond \
      0 \
      /lilypond-lib \
      --dir "$out/ccache::/lilypond-lib/ccache"

    cmp work/compiled-from-source.svg work/compile-svg.svg
  ''
