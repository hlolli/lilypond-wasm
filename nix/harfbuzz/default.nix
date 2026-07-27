{
  buildPackages,
  freetype,
  harfbuzz,
}: let
  base = harfbuzz.override {
    inherit freetype;
    withCairo = false;
    withCoreText = false;
    withGraphite2 = false;
    withIcu = false;
    withIntrospection = false;
    withRaster = false;
  };
in
  base.overrideAttrs (old: {
    pname = "harfbuzz-wasi";

    outputs = [
      "out"
      "dev"
    ];

    patches =
      (old.patches or [])
      ++ [
        ./patches/0001-wasi-single-thread-and-stdio.patch
      ];

    depsBuildBuild = [];

    nativeBuildInputs = [
      buildPackages.meson
      buildPackages.ninja
      buildPackages.pkg-config
      buildPackages.python3
    ];

    buildInputs = [freetype];
    propagatedBuildInputs = [freetype];

    # The FreeType headers include setjmp.h. Keep this package and all static
    # users on FreeType's standard WebAssembly exception format.
    NIX_CFLAGS_COMPILE =
      (old.NIX_CFLAGS_COMPILE or "")
      + " -DHB_NO_MT"
      + " -DHB_NO_MMAP"
      + " -mllvm -wasm-enable-sjlj"
      + " -mllvm -wasm-use-legacy-eh=false";

    mesonFlags = [
      "-Dbenchmark=disabled"
      "-Dcairo=disabled"
      "-Dchafa=disabled"
      "-Dcoretext=disabled"
      "-Ddefault_library=static"
      "-Ddirectwrite=disabled"
      "-Ddocs=disabled"
      "-Dfontations=disabled"
      "-Dfreetype=enabled"
      "-Dgdi=disabled"
      "-Dglib=disabled"
      "-Dgobject=disabled"
      "-Dgraphite=disabled"
      "-Dgraphite2=disabled"
      "-Dharfrust=disabled"
      "-Dicu=disabled"
      "-Dintrospection=disabled"
      "-Dkbts=disabled"
      "-Dpng=disabled"
      "-Draster=disabled"
      "-Dsubset=disabled"
      "-Dtests=disabled"
      "-Dutilities=disabled"
      "-Dvector=disabled"
      "-Dwasm=disabled"
      "-Dwith_libstdcxx=false"
      "-Dzlib=disabled"
    ];

    postInstall = ''
      test -f "$out/lib/libharfbuzz.a"

      test ! -e "$out/lib/libharfbuzz-gobject.a"
      test ! -e "$out/lib/libharfbuzz-raster.a"
      test ! -e "$out/lib/libharfbuzz-subset.a"
      test ! -e "$out/lib/libharfbuzz-vector.a"
    '';

    postFixup =
      (old.postFixup or "")
      + ''
        test -f "$dev/include/harfbuzz/hb.h"
        test -f "$dev/include/harfbuzz/hb-ft.h"
        test -f "$dev/include/harfbuzz/hb-features.h"
        test -f "$dev/lib/pkgconfig/harfbuzz.pc"

        test ! -e "$dev/include/harfbuzz/hb-glib.h"
        test ! -e "$dev/include/harfbuzz/hb-gobject.h"

        grep -Fq "#define HB_HAS_FREETYPE 1" \
          "$dev/include/harfbuzz/hb-features.h"
        grep -Fq "Requires: freetype2" \
          "$dev/lib/pkgconfig/harfbuzz.pc"
      '';

    doCheck = false;
    doInstallCheck = false;

    meta =
      old.meta
      // {
        description = "HarfBuzz static archive cross-compiled for wasm32-wasi";
      };
  })
