{
  boehmgc,
  buildPackages,
  expat,
  fontconfig,
  freetype,
  fribidi,
  glib,
  gmp,
  guile,
  harfbuzz,
  lib,
  libffi,
  libpng,
  libunistring,
  pango,
  pcre2,
  src,
  stdenv,
  zlib,
}: let
  lilypondVersion = "2.27.2";
  requiredFinalWasmOptFlags =
    lib.unique
    (guile.requiredFinalWasmOptFlags ++ pango.requiredFinalWasmOptFlags);
  wasmMetadataSection = "lilypond-wasm.metadata";
  wasmMetadata = {
    schemaVersion = 1;
    name = "lilypond-wasm";
    repository = "https://github.com/hlolli/lilypond-wasm";
    projectAuthor = "Hlöðver Sigurðsson";
    license = "GPL-3.0-or-later";
    notices = "https://github.com/hlolli/lilypond-wasm/blob/main/THIRD_PARTY_NOTICES.md";
    versions = {
      lilypond = lilypondVersion;
      guile = guile.version;
    };
    lilypondSource = {
      repository = "https://gitlab.com/lilypond/lilypond";
      revision =
        if builtins.isAttrs src
        then src.rev or null
        else null;
      narHash =
        if builtins.isAttrs src
        then src.narHash or null
        else null;
    };
  };
  wasmMetadataFile =
    builtins.toFile
    "lilypond-wasm-metadata.json"
    (builtins.toJSON wasmMetadata);
in
  stdenv.mkDerivation {
    pname = "lilypond-svg-wasi";
    version = lilypondVersion;

    inherit src;

    patches = [
      ./patches/0001-optional-cairo-and-font-build.patch
      ./patches/0002-wasi-svg-only-runtime.patch
    ];

    strictDeps = true;

    nativeBuildInputs = [
      buildPackages.autoconf
      buildPackages.binaryen
      buildPackages.bison
      buildPackages.flex
      buildPackages.gettext
      buildPackages.perl
      buildPackages.pkg-config
      buildPackages.python3
    ];

    # Keep the full static package-config closure explicit. This also makes it
    # clear which ports the first LilyPond link consumes.
    buildInputs = [
      boehmgc
      expat
      fontconfig
      freetype
      fribidi
      glib
      gmp
      guile
      harfbuzz
      libffi
      libpng
      libunistring
      pango
      pcre2
      zlib
    ];

    configureFlags = [
      "--disable-cairo"
      "--disable-documentation"
      "--disable-fonts"
      "--disable-gs-api"
      "--with-extractpdfmark=no"
      "--with-flexlexer-dir=${buildPackages.flex}/include"
    ];

    env = {
      NIX_CFLAGS_COMPILE =
        "-O2"
        + " -D_WASI_EMULATED_PROCESS_CLOCKS"
        + " -mllvm -wasm-enable-sjlj"
        + " -mllvm -wasm-use-legacy-eh=false";
      # Full Scheme startup needs more than wasm-ld's small default stack.
      NIX_LDFLAGS = "-z,stack-size=8388608";
    };

    LIBS = "-lwasi-emulated-process-clocks";

    preConfigure = ''
      ./autogen.sh --noconfigure

      # LilyPond's configure checks do not ask pkg-config for private static
      # dependencies. Supply those flags here because every target library is
      # static.
      export BDWGC_CFLAGS="$("$PKG_CONFIG" --cflags bdw-gc)"
      export BDWGC_LIBS="$("$PKG_CONFIG" --static --libs bdw-gc)"
      export FONTCONFIG_CFLAGS="$("$PKG_CONFIG" --cflags fontconfig)"
      export FONTCONFIG_LIBS="$("$PKG_CONFIG" --static --libs fontconfig)"
      export FREETYPE2_CFLAGS="$("$PKG_CONFIG" --cflags freetype2)"
      export FREETYPE2_LIBS="$("$PKG_CONFIG" --static --libs freetype2)"
      export GLIB_CFLAGS="$("$PKG_CONFIG" --cflags glib-2.0)"
      export GLIB_LIBS="$("$PKG_CONFIG" --static --libs glib-2.0)"
      export GOBJECT_CFLAGS="$("$PKG_CONFIG" --cflags gobject-2.0)"
      export GOBJECT_LIBS="$("$PKG_CONFIG" --static --libs gobject-2.0)"
      export GUILE_CFLAGS="$("$PKG_CONFIG" --cflags guile-3.0)"
      export GUILE_LIBS="$("$PKG_CONFIG" --static --libs guile-3.0)"
      export LIBPNG_CFLAGS="$("$PKG_CONFIG" --cflags libpng)"
      export LIBPNG_LIBS="$("$PKG_CONFIG" --static --libs libpng)"
      export PANGO_FT2_CFLAGS="$("$PKG_CONFIG" --cflags pangoft2)"
      export PANGO_FT2_LIBS="$("$PKG_CONFIG" --static --libs pangoft2)"
      export ZLIB_CFLAGS="$("$PKG_CONFIG" --cflags zlib)"
      export ZLIB_LIBS="$("$PKG_CONFIG" --static --libs zlib)"
    '';

    enableParallelBuilding = true;

    buildPhase = ''
      runHook preBuild

      # LilyPond treats an inherited "out" variable as an output-directory
      # suffix. Keep Nix's store output out of the make environment.
      env -u out make -C lily default

      # Emulate compatible callbacks with different declared WebAssembly
      # types, and keep Guile's live GC pointers visible in linear memory.
      wasm-opt \
        ${lib.escapeShellArgs requiredFinalWasmOptFlags} \
        lily/out/lilypond \
        -o lilypond.optimized.wasm

      python3 ${./add-wasm-custom-section.py} \
        --name ${wasmMetadataSection} \
        --payload ${wasmMetadataFile} \
        lilypond.optimized.wasm \
        lilypond.wasm

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p "$out/bin"
      cp lilypond.wasm "$out/bin/lilypond.wasm"

      license_dir="$out/share/licenses/lilypond-wasm"
      mkdir -p "$license_dir"
      cp ${../../COPYING} "$license_dir/COPYING"
      cp ${../../LICENSE} "$license_dir/LICENSE"
      cp ${../../THIRD_PARTY_NOTICES.md} "$license_dir/THIRD_PARTY_NOTICES.md"
      mkdir -p "$license_dir/third-party"
      cp -R ${../../third-party/licenses} "$license_dir/third-party/licenses"

      test -s "$out/bin/lilypond.wasm"
      test -s "$license_dir/COPYING"
      test -s "$license_dir/third-party/licenses/lilypond/LICENSE"
      test -s "$license_dir/third-party/licenses/wasi-libc/LICENSE"

      runHook postInstall
    '';

    dontStrip = true;

    doCheck = false;
    doInstallCheck = false;

    passthru = {
      inherit
        requiredFinalWasmOptFlags
        wasmMetadata
        wasmMetadataFile
        wasmMetadataSection
        ;
    };

    meta = {
      description = "SVG-only LilyPond command linked statically for wasm32-wasi";
      homepage = "https://lilypond.org/";
      license = lib.licenses.gpl3Plus;
      platforms = lib.platforms.all;
    };
  }
