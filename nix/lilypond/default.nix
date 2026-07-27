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
}:
stdenv.mkDerivation (finalAttrs: {
  pname = "lilypond-svg-wasi";
  version = "2.27.2";

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

    # GLib, GObject, Guile, and LilyPond use compatible callbacks with
    # different declared C types. WebAssembly checks indirect call types.
    wasm-opt \
      ${lib.escapeShellArgs pango.requiredFinalWasmOptFlags} \
      lily/out/lilypond \
      -o lilypond.wasm

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin"
    cp lilypond.wasm "$out/bin/lilypond.wasm"

    test -s "$out/bin/lilypond.wasm"

    runHook postInstall
  '';

  dontStrip = true;

  doCheck = false;
  doInstallCheck = false;

  passthru = {
    requiredFinalWasmOptFlags = pango.requiredFinalWasmOptFlags;
  };

  meta = {
    description = "SVG-only LilyPond command linked statically for wasm32-wasi";
    homepage = "https://lilypond.org/";
    license = lib.licenses.gpl3Plus;
    platforms = lib.platforms.all;
  };
})
