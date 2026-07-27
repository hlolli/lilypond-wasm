{pcre2}:
pcre2.overrideAttrs (old: {
  pname = "pcre2-wasi";

  outputs = [
    "out"
    "dev"
  ];

  configureFlags = [
    "--disable-pcre2-16"
    "--disable-pcre2-32"
    "--disable-jit"
    "--disable-pcre2grep-jit"
    "--disable-pcre2grep-callout-fork"
    "--disable-pcre2grep-libz"
    "--disable-pcre2grep-libbz2"
    "--disable-pcre2test-libedit"
    "--disable-pcre2test-libreadline"
  ];

  # The test tools use process clocks and resource limits that WASI lacks.
  # GLib uses the 8-bit library. The small POSIX wrapper shares the same
  # upstream build and install targets, so keep it as part of this package.
  buildPhase = ''
    runHook preBuild

    make libpcre2-8.la libpcre2-posix.la

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    make \
      install-libLTLIBRARIES \
      install-pkgconfigDATA \
      install-includeHEADERS \
      install-nodist_includeHEADERS

    runHook postInstall
  '';

  postInstall = ''
    test -f "$out/lib/libpcre2-8.a"
    test -f "$out/lib/libpcre2-posix.a"
    test -f "$dev/include/pcre2.h"
  '';

  postFixup = ''
    test -f "$dev/lib/pkgconfig/libpcre2-8.pc"
    test -f "$dev/lib/pkgconfig/libpcre2-posix.pc"
  '';

  doCheck = false;
  doInstallCheck = false;

  meta =
    old.meta
    // {
      description = "PCRE2 8-bit static archives cross-compiled for wasm32-wasi";
    };
})
