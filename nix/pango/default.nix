{
  buildPackages,
  fontconfig,
  freetype,
  fribidi,
  glib,
  harfbuzz,
  pango,
}: let
  base = pango.override {
    withIntrospection = false;
    x11Support = false;
  };
in
  base.overrideAttrs (old: {
    pname = "pango-wasi";

    outputs = [
      "out"
      "dev"
    ];

    patches =
      (old.patches or [])
      ++ [
        ./patches/0001-wasi-skip-target-tools.patch
        ./patches/0002-wasi-synchronous-fontconfig.patch
        ./patches/0003-wasi-stdio-locks.patch
      ];

    depsBuildBuild = [];

    nativeBuildInputs = [
      buildPackages.glib.dev
      buildPackages.meson
      buildPackages.ninja
      buildPackages.pkg-config
      buildPackages.python3
    ];

    buildInputs = [
      fontconfig
      freetype
      fribidi
      glib
      harfbuzz
    ];

    propagatedBuildInputs = [
      fontconfig
      freetype
      fribidi
      glib
      harfbuzz
    ];

    # The nixpkgs package points FONTCONFIG_FILE at a native test font set.
    # Pango is cross-compiled here and does not run target programs at build
    # time, so keep that stock Fontconfig closure out of the derivation.
    env = {};

    NIX_CFLAGS_COMPILE =
      (old.NIX_CFLAGS_COMPILE or "")
      + " -mllvm -wasm-enable-sjlj"
      + " -mllvm -wasm-use-legacy-eh=false";

    mesonFlags = [
      "-Dbuild-examples=false"
      "-Dbuild-testsuite=false"
      "-Dcairo=disabled"
      "-Ddefault_library=static"
      "-Ddocumentation=false"
      "-Dfontconfig=enabled"
      "-Dfreetype=enabled"
      "-Dintrospection=disabled"
      "-Dlibthai=disabled"
      "-Dman-pages=false"
      "-Dsysprof=disabled"
      "-Dxft=disabled"
    ];

    postInstall = ''
      rm -rf "$out/bin" "$out/share"

      test -f "$out/lib/libpango-1.0.a"
      test -f "$out/lib/libpangoft2-1.0.a"

      test ! -e "$out/lib/libpangocairo-1.0.a"
      test ! -e "$out/lib/libpangoxft-1.0.a"
    '';

    postFixup = ''
      test -f "$dev/include/pango-1.0/pango/pango.h"
      test -f "$dev/include/pango-1.0/pango/pangofc-fontmap.h"
      test -f "$dev/include/pango-1.0/pango/pangoft2.h"

      test -f "$dev/lib/pkgconfig/pango.pc"
      test -f "$dev/lib/pkgconfig/pangofc.pc"
      test -f "$dev/lib/pkgconfig/pangoft2.pc"
      test -f "$dev/lib/pkgconfig/pangoot.pc"

      test ! -e "$dev/lib/pkgconfig/pangocairo.pc"
      test ! -e "$dev/lib/pkgconfig/pangoxft.pc"
    '';

    doCheck = false;
    doInstallCheck = false;

    passthru =
      (old.passthru or {})
      // {
        requiredFinalWasmOptFlags = glib.requiredFinalWasmOptFlags;
      };

    meta =
      old.meta
      // {
        description = "Pango and PangoFT2 static archives cross-compiled for wasm32-wasi";
      };
  })
