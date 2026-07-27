{
  __flattenIncludeHackHook,
  buildPackages,
  freetype,
  zlib,
}:
freetype.overrideAttrs (old: {
  pname = "freetype-wasi";

  # FreeType's platform layer includes setjmp even when optional font formats
  # are off. Use the same standard WebAssembly exception format as libpng.
  env =
    (old.env or {})
    // {
      CFLAGS =
        (old.env.CFLAGS or "")
        + " -O2"
        + " -mllvm -wasm-enable-sjlj"
        + " -mllvm -wasm-use-legacy-eh=false";
      LIBS = "-lsetjmp";
    };

  nativeBuildInputs = [
    buildPackages.pkg-config
    buildPackages.which
    buildPackages.gnumake
    __flattenIncludeHackHook
  ];

  propagatedBuildInputs = [zlib];

  configureFlags = [
    "--disable-freetype-config"
    "--with-brotli=no"
    "--with-bzip2=no"
    "--with-harfbuzz=no"
    "--with-png=no"
    "--with-zlib=yes"
  ];

  postInstall = ''
    substituteInPlace "$out/lib/pkgconfig/freetype2.pc" \
      --replace-fail " -lfreetype " " -lfreetype -lsetjmp "

    test -f "$out/lib/libfreetype.a"
    test -f "$dev/include/freetype2/ft2build.h"
    test -f "$dev/include/freetype2/freetype/freetype.h"
  '';

  postFixup = ''
    test -f "$dev/lib/pkgconfig/freetype2.pc"
  '';

  doCheck = false;
  doInstallCheck = false;

  meta =
    old.meta
    // {
      description = "FreeType static archive cross-compiled for wasm32-wasi";
    };
})
