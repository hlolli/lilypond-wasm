{
  libunistring,
}:

libunistring.overrideAttrs (old: {
  pname = "libunistring-wasi";

  # wasi-libc uses musl's locale objects and exposes their names through
  # nl_langinfo_l. Let libunistring use that path on WASI too.
  patches = (old.patches or [ ]) ++ [
    ./patches/libunistring-wasi.patch
  ];

  # Automake builds test helpers as part of its default target. Their gnulib
  # signal wrapper cannot work on WASI, so keep them out of this library-only
  # package while still installing the library, headers, docs, and info pages.
  makeFlags = (old.makeFlags or [ ]) ++ [
    "SUBDIRS=doc gnulib-local lib"
  ];

  postInstall = (old.postInstall or "") + ''
    test -f "$out/lib/libunistring.a"
    test -f "$dev/include/unistr.h"
    test -f "$dev/include/unistring/version.h"
  '';

  doCheck = false;
  doInstallCheck = false;

  meta = old.meta // {
    description = "GNU libunistring static archive cross-compiled for wasm32-wasi";
  };
})
