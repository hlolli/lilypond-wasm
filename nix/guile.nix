{
  boehmgc,
  guile_3_0,
  lib,
  libffi,
  libunistring,
}:

let
  base = guile_3_0.override {
    inherit boehmgc libffi;
  };

  isUnusedTargetInput =
    package:
    builtins.elem (package.pname or (lib.getName package)) [
      "libtool"
      "readline"
    ];

  isWrapperHook =
    package: (package.pname or (lib.getName package)) == "make-shell-wrapper-hook";

  isReadlineFlag = flag: lib.hasPrefix "--with-libreadline-prefix=" flag;
in
base.overrideAttrs (old: {
  pname = "guile-wasi";

  # A static Guile does not need a terminal editor or loadable modules.
  # Leaving these in pulls ncurses and libltdl into the target closure.
  buildInputs = builtins.filter (
    package: !isUnusedTargetInput package
  ) (old.buildInputs or [ ]);

  propagatedBuildInputs = builtins.filter (
    package: !isUnusedTargetInput package
  ) (old.propagatedBuildInputs or [ ]);

  nativeBuildInputs = builtins.filter (
    package: !isWrapperHook package
  ) (old.nativeBuildInputs or [ ]);

  configureFlags =
    builtins.filter (flag: !isReadlineFlag flag) (old.configureFlags or [ ])
    ++ [
      "--disable-jit"
      "--disable-networking"
      "--disable-nls"
      "--with-modules=no"
      "--with-threads=null"
      "--without-libreadline-prefix"
    ];

  # The target cannot run Guile's installed helper programs. Keep the static
  # library, headers, package metadata, and Scheme files for later links.
  postInstall = ''
    test -f "$out/lib/libguile-3.0.a"
    sed -i "$out/lib/pkgconfig/guile"-*.pc \
      -e "s|-lffi|-L${libffi}/lib -lffi|g" \
      -e "s|-lunistring|-L${libunistring}/lib -lunistring|g" \
      -e "s|^Cflags:\(.*\)$|Cflags: -I${libunistring.dev}/include \1|g" \
      -e "s|includedir=$out|includedir=$dev|g"
    rm -rf "$out/bin"
    find "$out/lib" -type f \( -name '*.so' -o -name '*.so.*' -o -name '*.dylib' \) -delete
  '';

  doCheck = false;
  doInstallCheck = false;

  meta = old.meta // {
    description = "GNU Guile static archive cross-compiled for wasm32-wasi";
  };
})
