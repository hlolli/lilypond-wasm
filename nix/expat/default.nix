{expat}:
expat.overrideAttrs (old: {
  # The library has no process-clock dependency. Expat's benchmark does, and
  # the remaining programs are not needed in the target package.
  configureFlags =
    (old.configureFlags or [])
    ++ [
      "--without-docbook"
      "--without-examples"
      "--without-tests"
      "--without-xmlwf"
    ];

  postInstall =
    (old.postInstall or "")
    + ''
      test -f "$out/lib/libexpat.a"
      test -f "$dev/include/expat.h"
      test -f "$dev/include/expat_config.h"
      test -f "$dev/include/expat_external.h"
      test -f "$dev/lib/pkgconfig/expat.pc"
    '';

  doCheck = false;
  doInstallCheck = false;

  meta =
    old.meta
    // {
      description = "Expat static archive cross-compiled for wasm32-wasi";
    };
})
