{zlib}: let
  base = zlib.override {
    shared = false;
    splitStaticOutput = false;
  };
in
  base.overrideAttrs (old: {
    pname = "zlib-wasi";

    # Nixpkgs adds this ELF linker flag for LLD. wasm-ld rejects it, which
    # makes zlib's configure script misdetect strerror and vsnprintf.
    env =
      (old.env or {})
      // {
        NIX_LDFLAGS = "";
      };

    postInstall =
      (old.postInstall or "")
      + ''
        test -f "$out/lib/libz.a"
        test -f "$dev/include/zlib.h"
        test -f "$dev/include/zconf.h"
        test -f "$dev/share/pkgconfig/zlib.pc"
      '';

    doCheck = false;
    doInstallCheck = false;

    meta =
      old.meta
      // {
        description = "zlib static archive cross-compiled for wasm32-wasi";
      };
  })
