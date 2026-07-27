{
  __flattenIncludeHackHook,
  buildPackages,
  expat,
  fontconfig,
  freetype,
}:
fontconfig.overrideAttrs (old: {
  pname = "fontconfig-wasi";

  outputs = [
    "out"
    "dev"
  ];

  patches =
    (old.patches or [])
    ++ [
      ./patches/0001-wasi-cache-locks.patch
      ./patches/0002-cross-snprintf-check.patch
    ];

  nativeBuildInputs = [
    buildPackages.autoreconfHook
    buildPackages.gperf
    buildPackages.pkg-config
    buildPackages.python3
    __flattenIncludeHackHook
  ];

  buildInputs = [
    expat
    freetype
  ];

  propagatedBuildInputs = [
    expat
    freetype
  ];

  env =
    (old.env or {})
    // {
      CFLAGS =
        (old.env.CFLAGS or "")
        + " -O2 -DFC_NO_MT"
        + " -mllvm -wasm-enable-sjlj"
        + " -mllvm -wasm-use-legacy-eh=false";
      ac_cv_va_copy = "C99";
      fc_cv_c99_vsnprintf = "yes";
    };

  configureFlags = [
    "--disable-cache-build"
    "--disable-docs"
    "--disable-iconv"
    "--disable-nls"
    "--disable-shared"
    "--enable-static"
    "--sysconfdir=/etc"
    "--with-add-fonts=no"
    "--with-arch=wasm32"
    "--with-baseconfigdir=/etc/fonts"
    "--with-cache-dir=/tmp/fontconfig-cache"
    "--with-configdir=/etc/fonts/conf.d"
    "--with-default-fonts=/fonts"
    "--with-templatedir=/share/fontconfig/conf.avail"
  ];

  # The command-line tools need process and cache APIs. Build only the static
  # library and the tables it generates with build-platform tools.
  buildPhase = ''
    runHook preBuild

    make -C fc-const fcconst.h
    make -C src \
      ../fc-case/fccase.h \
      ../fc-lang/fclang.h \
      stamp-fcstdint \
      fcobjshash.h \
      fcalias.h \
      fcaliastail.h \
      fcftalias.h \
      fcftaliastail.h
    make -C src libfontconfig.la

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    make -C src install-libLTLIBRARIES
    make -C fontconfig install-fontconfigincludeHEADERS
    make install-pkgconfigDATA

    runHook postInstall
  '';

  postInstall = ''
    test -f "$out/lib/libfontconfig.a"
    test -f "$dev/include/fontconfig/fontconfig.h"
    test -f "$dev/include/fontconfig/fcfreetype.h"
  '';

  postFixup = ''
    test -f "$dev/lib/pkgconfig/fontconfig.pc"
  '';

  doCheck = false;
  doInstallCheck = false;

  meta =
    old.meta
    // {
      description = "Fontconfig static archive cross-compiled for wasm32-wasi";
    };
})
