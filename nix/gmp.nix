{
  gmp,
}:

let
  base = gmp.override {
    cxx = false;
    withStatic = true;
  };
in
base.overrideAttrs (old: {
  pname = "gmp-wasi";

  # WASI has no signals. GMP's error paths already abort after SIGFPE, so
  # use that final action directly instead of linking a signal shim.
  patches = (old.patches or [ ]) ++ [
    ./patches/gmp-wasi.patch
  ];

  configureFlags = (old.configureFlags or [ ]) ++ [
    "--disable-assembly"
    # GMP otherwise uses alloca for scratch blocks up to 32 KiB. Nested
    # arithmetic can exhaust WebAssembly's fixed stack, so keep scratch data
    # on the growable heap.
    "--enable-alloca=malloc-reentrant"
  ];

  postInstall = (old.postInstall or "") + ''
    test -f "$out/lib/libgmp.a"
  '';

  doCheck = false;
  doInstallCheck = false;

  meta = old.meta // {
    description = "GNU MP static archive cross-compiled for wasm32-wasi";
  };
})
