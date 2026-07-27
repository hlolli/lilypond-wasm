{boehmgc}: let
  base = boehmgc.override {
    enableMmap = false;
    enableStatic = true;
  };

  isCxxFlag = flag: flag == "--enable-cplusplus";
in
  base.overrideAttrs (old: {
    # Backport https://github.com/bdwgc/bdwgc/pull/519 and later WASI fixes.
    # These bounds match wasi-ld and keep the collector from clearing static data.
    patches =
      (old.patches or [])
      ++ [
        ./patches/boehm-gc-wasi.patch
      ];

    configureFlags =
      builtins.filter (flag: !isCxxFlag flag) (old.configureFlags or [])
      ++ [
        "--disable-cplusplus"
        "--disable-threads"
      ];

    postInstall =
      (old.postInstall or "")
      + ''
        test -f "$out/lib/libgc.a"
      '';

    doCheck = false;
    doInstallCheck = false;

    passthru =
      (old.passthru or {})
      // {
        # Plain WASI cannot expose WebAssembly locals to a conservative
        # collector. Spill pointer locals into linear memory in final modules.
        requiredFinalWasmOptFlags = ["--spill-pointers"];
      };

    meta =
      old.meta
      // {
        description = "Boehm garbage collector cross-compiled for wasm32-wasi";
      };
  })
