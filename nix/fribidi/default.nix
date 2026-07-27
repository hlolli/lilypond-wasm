{fribidi}:
fribidi.overrideAttrs (old: {
  outputs = [
    "out"
    "dev"
  ];

  mesonFlags =
    (old.mesonFlags or [])
    ++ [
      "-Dbin=false"
      "-Ddefault_library=static"
      "-Ddocs=false"
      "-Dtests=false"
    ];

  postInstall =
    (old.postInstall or "")
    + ''
      test -f "$out/lib/libfribidi.a"
      test -f "$dev/include/fribidi/fribidi.h"
    '';

  postFixup =
    (old.postFixup or "")
    + ''
      test -f "$dev/lib/pkgconfig/fribidi.pc"
    '';

  doCheck = false;
  doInstallCheck = false;

  meta =
    old.meta
    // {
      description = "FriBidi static archive cross-compiled for wasm32-wasi";
    };
})
