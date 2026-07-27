{
  libpng,
  zlib,
}: let
  base = libpng.override {
    apngSupport = false;
    inherit zlib;
  };
in
  base.overrideAttrs (old: {
    pname = "libpng-wasi";

    # Keep the simplified API used by LilyPond. It uses setjmp inside libpng.
    # Build WASI SJLJ with standard WebAssembly exceptions; final consumers
    # must use the same flags.
    CFLAGS =
      "-O2"
      + " -mllvm -wasm-enable-sjlj"
      + " -mllvm -wasm-use-legacy-eh=false";
    LIBS = "-lsetjmp";

    configureFlags =
      (old.configureFlags or [])
      ++ [
        "--disable-hardware-optimizations"
        "--disable-tests"
        "--disable-tools"
      ];

    postInstall =
      (old.postInstall or "")
      + ''
        test -f "$out/lib/libpng16.a"
        test -f "$dev/include/libpng16/png.h"
        test -f "$dev/include/libpng16/pngconf.h"
        test -f "$dev/include/libpng16/pnglibconf.h"
        test -f "$dev/lib/pkgconfig/libpng16.pc"
      '';

    doCheck = false;
    doInstallCheck = false;

    meta =
      old.meta
      // {
        description = "libpng static archive cross-compiled for wasm32-wasi";
      };
  })
