{
  coreutils,
  diffutils,
  file,
  guile,
  jq,
  lib,
  lilypond,
  lilypondAssets,
  lilypondBytecode,
  src,
  stdenvNoCC,
  version,
  wasmtime,
}:
assert lib.assertMsg
(lilypond.version == lilypondAssets.version)
"LilyPond and its assets must have the same version";
  stdenvNoCC.mkDerivation {
    pname = "lilypond-csound-score-plugin-wasi";
    inherit src version;

    patches = [
      ./patches/0001-support-lilypond-2.27-wasi.patch
    ];

    strictDeps = true;
    nativeBuildInputs = [
      coreutils
      diffutils
      file
      jq
      wasmtime
    ];

    dontConfigure = true;
    dontFixup = true;

    buildPhase = ''
      runHook preBuild

      assets="${lilypondAssets}/share/lilypond/${lilypondAssets.version}"
      data_dir="$PWD/lilypond"

      # Compile at the same guest paths used by the npm runtime. Guile puts
      # auto-compiled files below the data directory before we move the two
      # plugin files into the packaged compiled-load path.
      mkdir -p "$data_dir"
      cp -R --preserve=timestamps "$assets/." "$data_dir/"
      chmod -R u+w "$data_dir"
      install -Dm0644 src/lpcs.ily "$data_dir/ly/lpcs.ily"
      install -Dm0644 src/lpcs/core.scm "$data_dir/scm/lpcs/core.scm"
      install -Dm0644 \
        src/lpcs/lilypond.scm \
        "$data_dir/scm/lpcs/lilypond.scm"

      mkdir -p \
        built-ccache/lpcs \
        work/cache/fontconfig \
        work/home \
        work/lily-lib/ccache \
        work/tmp
      cp -R --preserve=timestamps \
        ${lilypondBytecode}/ccache/. \
        work/lily-lib/ccache/
      chmod -R u+w work/lily-lib
      cp tests/lilypond/fixtures/basic.ly work/basic.ly
      cp tests/lilypond/fixtures/gestures.ly work/gestures.ly

      run_lilypond() {
        local auto_compile="$1"
        local input_name="$2"

        timeout 120s wasmtime run \
          -W exceptions=y \
          -C cache=n \
          --dir "$PWD/work::/work" \
          --dir "$data_dir::/lilypond" \
          --dir ${guile}/share/guile/3.0::/guile \
          --dir ${guile}/lib/guile/3.0/ccache::/guile-ccache \
          --dir "$PWD/work/lily-lib::/lilypond-lib" \
          --env FONTCONFIG_FILE=/lilypond/fonts/fonts.conf \
          --env FONTCONFIG_PATH=/lilypond/fonts \
          --env GUILE_AUTO_COMPILE="$auto_compile" \
          --env GUILE_LOAD_PATH=/guile \
          --env GUILE_LOAD_COMPILED_PATH=/guile-ccache \
          --env GUILE_SYSTEM_PATH=/guile \
          --env GUILE_SYSTEM_COMPILED_PATH=/guile-ccache \
          --env HOME=/work/home \
          --env LILYPOND_DATADIR=/lilypond \
          --env LILYPOND_LIBDIR=/lilypond-lib \
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
          -o "/work/$input_name" \
          "/work/$input_name.ly"
      }

      run_lilypond 1 basic

      test -s work/basic.svg
      test -s work/basic.lpcs.json
      test -s work/basic.sco
      jq -e '
        .format == "lpcs-ir"
        and .version == 3
        and (.events | length) > 0
      ' work/basic.lpcs.json

      generated="$data_dir/guile-bytecode/lilypond/scm/lpcs"
      for module_name in core lilypond; do
        compiled="$generated/$module_name.scm.go"
        source_file="$data_dir/scm/lpcs/$module_name.scm"
        destination="built-ccache/lpcs/$module_name.go"

        test -s "$compiled"
        cp "$compiled" "$destination"
        touch -r "$source_file" "$destination"
        chmod 0444 "$destination"

        description="$(file -b "$destination")"
        printf '%s\n' "$description" | grep -F "ELF 32-bit LSB"
      done

      test "$(
        find built-ccache/lpcs -maxdepth 1 -type f -name '*.go' | wc -l
      )" -eq 2

      cp work/basic.svg work/basic-from-source.svg
      cp work/basic.lpcs.json work/basic-from-source.lpcs.json
      cp work/basic.sco work/basic-from-source.sco
      cp -R --preserve=timestamps built-ccache/lpcs work/lily-lib/ccache/

      # Prove a fresh target process uses the two packaged cache files.
      # The include file still checks that sources exist, but either poisoned
      # source will stop the build if primitive-load-path misses its cache.
      mv "$data_dir/guile-bytecode" work/generated-bytecode
      for module_name in core lilypond; do
        source_file="$data_dir/scm/lpcs/$module_name.scm"
        bytecode="work/lily-lib/ccache/lpcs/$module_name.go"
        printf '%s\n' \
          '(error "LPCS bytecode cache was not used")' \
          > "$source_file"
        touch -r "$bytecode" "$source_file"
      done

      run_lilypond 0 basic

      cmp work/basic-from-source.svg work/basic.svg
      cmp work/basic-from-source.lpcs.json work/basic.lpcs.json
      cmp work/basic-from-source.sco work/basic.sco

      # Cover the mutable session and gesture paths with the same source
      # poison in place.
      run_lilypond 0 gestures

      test -s work/gestures.svg
      test -s work/gestures.lpcs.json
      test -s work/gestures.sco
      test -s work/gestures.lpcs.timeline.json
      test -s work/gestures.lpcs.gestures.json
      jq -e '
        .format == "lpcs-gestures"
        and .version == 1
        and (.gestures | length) == 2
      ' work/gestures.lpcs.gestures.json

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      data_output="$out/share/lilypond/${lilypond.version}"
      install -Dm0644 src/lpcs.ily "$data_output/ly/lpcs.ily"
      install -Dm0644 src/lpcs/core.scm "$data_output/scm/lpcs/core.scm"
      install -Dm0644 \
        src/lpcs/lilypond.scm \
        "$data_output/scm/lpcs/lilypond.scm"
      cp -R --preserve=timestamps built-ccache "$out/ccache"
      install -Dm0644 \
        LICENSE \
        "$out/share/licenses/lilypond-csound-score-plugin/LICENSE"

      test -s "$out/ccache/lpcs/core.go"
      test -s "$out/ccache/lpcs/lilypond.go"

      runHook postInstall
    '';

    passthru = {
      inherit src;
      lilypondVersion = lilypond.version;
      sourceRevision = src.rev or null;
    };

    meta = {
      description = "Precompiled LilyPond Csound Score plugin for the WASI runtime";
      homepage = "https://github.com/hlolli/lilypond-csound-score-plugin";
      license = lib.licenses.gpl3Only;
      platforms = lib.platforms.all;
    };
  }
