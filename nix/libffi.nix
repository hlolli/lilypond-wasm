{
  libffi,
}:

let
  isPaxFlag = flag: flag == "--enable-pax_emutramp";
in
libffi.overrideAttrs (old: {
  # WASI cannot form a new indirect-call type at run time. The patch emits
  # typed scalar calls for zero through four arguments and rejects other CIFs.
  patches = (old.patches or [ ]) ++ [
    ./patches/libffi-wasi.patch
  ];

  configureFlags =
    builtins.filter (flag: !isPaxFlag flag) (old.configureFlags or [ ])
    ++ [
      "--disable-multi-os-directory"
    ];

  postInstall = (old.postInstall or "") + ''
    test -f "$out/lib/libffi.a"
    test -f "$dev/include/ffi.h"
    test -f "$dev/include/ffitarget.h"
    test -f "$out/lib/pkgconfig/libffi.pc"
  '';

  doCheck = false;
  doInstallCheck = false;

  meta = old.meta // {
    description = "libffi fixed scalar calls cross-compiled for wasm32-wasi";
  };
})
