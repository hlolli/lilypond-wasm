{
  buildPackages,
  glib,
  libffi,
  pcre2,
}:
glib.overrideAttrs (old: {
  pname = "glib-wasi";

  outputs = [
    "out"
    "dev"
  ];

  patches =
    (old.patches or [])
    ++ [
      ./patches/0001-wasi-minimal-build.patch
      ./patches/0002-wasi-libc.patch
      ./patches/0003-wasi-main-loop.patch
      ./patches/0004-wasi-tests-and-threads.patch
      ./patches/0005-wasi-unix-api.patch
      ./patches/0006-wasi-wakeup.patch
      ./patches/0007-wasi-no-target-tools.patch
      ./patches/0008-wasi-thread-creation.patch
      ./patches/0009-wasi-glistmodel.patch
    ];

  depsBuildBuild = [];

  nativeBuildInputs = [
    buildPackages.meson
    buildPackages.ninja
    buildPackages.pkg-config
    buildPackages.perl
    buildPackages.python3
  ];

  buildInputs = [
    libffi
    pcre2
  ];

  propagatedBuildInputs = [
    libffi
    pcre2
  ];

  env =
    (old.env or {})
    // {
      NIX_CFLAGS_COMPILE =
        (old.env.NIX_CFLAGS_COMPILE or "")
        + " -D_WASI_EMULATED_GETPID -D_WASI_EMULATED_SIGNAL";
    };

  mesonFlags = [
    "-Dbsymbolic_functions=false"
    "-Ddefault_library=static"
    "-Ddocumentation=false"
    "-Ddtrace=disabled"
    "-Dglib_debug=disabled"
    "-Dinstalled_tests=false"
    "-Dintrospection=disabled"
    "-Dlibelf=disabled"
    "-Dlibmount=disabled"
    "-Dman-pages=disabled"
    "-Dnls=disabled"
    "-Dselinux=disabled"
    "-Dsysprof=disabled"
    "-Dsystemtap=disabled"
    "-Dtests=false"
    "-Dxattr=false"
  ];

  postPatch = ''
    patchShebangs tools/gen-visibility-macros.py
  '';

  # The host package's setup hook manages GSettings schemas. This WASI subset
  # does not build GSettings, so do not change downstream install phases.
  setupHook = null;

  postConfigure = ''
    patchShebangs gobject/glib-genmarshal gobject/glib-mkenums
  '';

  postInstall = ''
    rm -rf "$out/bin" "$out/share"
    rm -f "$out"/lib/*-gdb.py

    substituteInPlace "$out/lib/pkgconfig/glib-2.0.pc" \
      --replace-fail \
        "-lglib-2.0 -lm" \
        "-lglib-2.0 -lm -lwasi-emulated-getpid -lwasi-emulated-signal" \
      --replace-fail \
        "Cflags: " \
        "Cflags: -D_WASI_EMULATED_GETPID -D_WASI_EMULATED_SIGNAL "

    sed -i \
      -e '/^devbindir=/d' \
      -e '/^glib_genmarshal=/d' \
      -e '/^gobject_query=/d' \
      -e '/^glib_mkenums=/d' \
      -e '/^glib_valgrind_suppressions=/d' \
      "$out/lib/pkgconfig/glib-2.0.pc"

    test -f "$out/lib/libglib-2.0.a"
    test -f "$out/lib/libgobject-2.0.a"
    test -f "$out/lib/libgio-2.0.a"
    test -f "$dev/include/glib-2.0/glib.h"
    test -f "$dev/include/glib-2.0/glib-object.h"
    test -f "$dev/include/glib-2.0/gio/gio.h"
    test -f "$dev/include/glib-2.0/gio/gioerror.h"
    test -f "$dev/include/glib-2.0/gio/glistmodel.h"
  '';

  postFixup = ''
    test -f "$dev/lib/pkgconfig/glib-2.0.pc"
    test -f "$dev/lib/pkgconfig/gobject-2.0.pc"
    test -f "$dev/lib/pkgconfig/gio-2.0.pc"
  '';

  doCheck = false;
  doInstallCheck = false;

  # GObject and Pango cast callbacks between C signatures. WebAssembly checks
  # indirect-call types exactly, so the final linked module needs this pass.
  passthru =
    (old.passthru or {})
    // {
      requiredFinalWasmOptFlags = ["--fpcast-emu"];
    };

  meta =
    old.meta
    // {
      description = "GLib, GObject, and GListModel static archives cross-compiled for wasm32-wasi";
    };
})
