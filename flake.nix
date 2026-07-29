{
  description = "Static LilyPond dependencies for WebAssembly";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    lilypond = {
      url = "gitlab:lilypond/lilypond/master";
      flake = false;
    };
  };

  outputs = {
    lilypond,
    nixpkgs,
    self,
    ...
  }: let
    systems = [
      "aarch64-darwin"
      "aarch64-linux"
      "x86_64-linux"
    ];
    forAllSystems = nixpkgs.lib.genAttrs systems;
    projectSource = nixpkgs.lib.cleanSourceWith {
      name = "lilypond-wasm-source";
      src = self.outPath;
      filter = path: _type: let
        sourceRoot = builtins.toString self.outPath;
        relativePath =
          nixpkgs.lib.removePrefix
          "${sourceRoot}/"
          (builtins.toString path);
        rootEntry = !(nixpkgs.lib.hasInfix "/" relativePath);
      in
        builtins.baseNameOf path
        != ".DS_Store"
        && !(
          rootEntry
          && (
            builtins.elem relativePath [
              ".direnv"
              ".git"
              ".local-packages"
              "lilypond"
            ]
            || nixpkgs.lib.hasPrefix "result" relativePath
          )
        );
    };
    canonicalLilypondSource = builtins.path {
      name = "lilypond-source";
      path = lilypond.outPath;
    };
    canonicalNixpkgsSource = builtins.path {
      name = "nixpkgs-source";
      path = nixpkgs.outPath;
    };
    sourcePins = {
      lilypond = {
        revision = lilypond.rev or null;
        narHash = lilypond.narHash or null;
      };
      lilypond-wasm = {
        revision = self.rev or self.dirtyRev or null;
        narHash = self.narHash or null;
      };
      nixpkgs = {
        revision = nixpkgs.rev or null;
        narHash = nixpkgs.narHash or null;
      };
    };
    scopeForSystem = system: let
      pkgs = import nixpkgs {
        inherit system;
        config.allowUnsupportedSystem = true;
      };
      pkgsWasm = pkgs.pkgsCross.wasi32;
      lilypondSource = lilypond;
      packages = rec {
        boehm-gc = pkgsWasm.callPackage ./nix/boehm-gc.nix {};
        expat = pkgsWasm.callPackage ./nix/expat {};
        freetype = pkgsWasm.callPackage ./nix/freetype {
          inherit zlib;
        };
        fribidi = pkgsWasm.callPackage ./nix/fribidi {};
        fontconfig = pkgsWasm.callPackage ./nix/fontconfig {
          inherit expat freetype;
        };
        glib = pkgsWasm.callPackage ./nix/glib {
          inherit libffi pcre2;
        };
        gmp = pkgsWasm.callPackage ./nix/gmp.nix {};
        harfbuzz = pkgsWasm.callPackage ./nix/harfbuzz {
          inherit freetype;
        };
        libffi = pkgsWasm.callPackage ./nix/libffi.nix {};
        libpng = pkgsWasm.callPackage ./nix/libpng {
          inherit zlib;
        };
        libunistring = pkgsWasm.callPackage ./nix/libunistring.nix {};
        lilypond-assets = pkgs.callPackage ./nix/lilypond/assets {
          src = lilypondSource;
        };
        lilypond-bytecode = pkgs.callPackage ./nix/lilypond/bytecode {
          inherit guile lilypond;
          lilypondAssets = lilypond-assets;
        };
        lilypond = pkgsWasm.callPackage ./nix/lilypond {
          boehmgc = boehm-gc;
          inherit
            expat
            fontconfig
            freetype
            fribidi
            glib
            gmp
            guile
            harfbuzz
            libffi
            libpng
            libunistring
            pango
            pcre2
            zlib
            ;
          src = lilypondSource;
        };
        lilypond-npm = pkgs.callPackage ./nix/lilypond/npm.nix {
          inherit guile lilypond;
          lilypondAssets = lilypond-assets;
          lilypondBytecode = lilypond-bytecode;
          lilypondSourceBundle = lilypond-source-bundle;
        };
        lilypond-source-bundle = pkgs.callPackage ./nix/lilypond/source-bundle.nix {
          compilerRt = pkgsWasm.llvmPackages.compiler-rt;
          libcxx = pkgsWasm.llvmPackages.libcxx;
          lilypondPackage = lilypond;
          lilypondAssets = lilypond-assets;
          inherit
            projectSource
            sourcePins
            ;
          lilypondSource = canonicalLilypondSource;
          linkedSources = [
            {
              kind = "directory";
              name = "boehm-gc";
              package = boehm-gc;
            }
            {
              kind = "file";
              name = "expat";
              package = expat;
            }
            {
              kind = "file";
              name = "fontconfig";
              package = fontconfig;
            }
            {
              kind = "file";
              name = "freetype";
              package = freetype;
            }
            {
              kind = "file";
              name = "fribidi";
              package = fribidi;
            }
            {
              kind = "file";
              name = "glib";
              package = glib;
            }
            {
              kind = "file";
              name = "gmp";
              package = gmp;
            }
            {
              kind = "file";
              name = "guile";
              package = guile;
            }
            {
              kind = "file";
              name = "harfbuzz";
              package = harfbuzz;
            }
            {
              kind = "file";
              name = "libffi";
              package = libffi;
            }
            {
              kind = "file";
              name = "libpng";
              package = libpng;
            }
            {
              kind = "file";
              name = "libunistring";
              package = libunistring;
            }
            {
              kind = "file";
              name = "pango";
              package = pango;
            }
            {
              kind = "file";
              name = "pcre2";
              package = pcre2;
            }
            {
              kind = "file";
              name = "zlib";
              package = zlib;
            }
          ];
          nixpkgsSource = canonicalNixpkgsSource;
          version =
            (builtins.fromJSON (builtins.readFile ./npm/package.json)).version;
          wasiLibc = pkgsWasm.wasilibc;
        };
        lilypond-npm-tarball = pkgs.callPackage ./nix/lilypond/npm-tarball.nix {
          lilypondNpm = lilypond-npm;
          lilypondSourceBundle = lilypond-source-bundle;
        };
        pango = pkgsWasm.callPackage ./nix/pango {
          inherit fontconfig freetype fribidi glib harfbuzz;
        };
        pcre2 = pkgsWasm.callPackage ./nix/pcre2 {};
        zlib = pkgsWasm.callPackage ./nix/zlib {};
        guile = pkgsWasm.callPackage ./nix/guile {
          boehmgc = boehm-gc;
          inherit gmp libunistring;
          libffi = libffi;
        };
        default = guile;
      };
    in {
      inherit packages pkgs pkgsWasm;
    };
  in {
    packages = forAllSystems (system: (scopeForSystem system).packages);

    checks = forAllSystems (
      system: let
        scope = scopeForSystem system;
      in {
        expat-smoke = scope.pkgs.callPackage ./nix/expat/tests {
          expat = scope.packages.expat;
          stdenvWasi = scope.pkgsWasm.stdenv;
        };
        freetype-smoke = scope.pkgs.callPackage ./nix/freetype/tests {
          font = scope.pkgs.tex-gyre.cursor;
          freetype = scope.packages.freetype;
          stdenvWasi = scope.pkgsWasm.stdenv;
          zlib = scope.packages.zlib;
        };
        fribidi-smoke = scope.pkgs.callPackage ./nix/fribidi/tests {
          fribidi = scope.packages.fribidi;
          stdenvWasi = scope.pkgsWasm.stdenv;
        };
        fontconfig-smoke = scope.pkgs.callPackage ./nix/fontconfig/tests {
          expat = scope.packages.expat;
          font = scope.pkgs.tex-gyre.cursor;
          fontconfig = scope.packages.fontconfig;
          freetype = scope.packages.freetype;
          stdenvWasi = scope.pkgsWasm.stdenv;
          zlib = scope.packages.zlib;
        };
        glib-smoke = scope.pkgs.callPackage ./nix/glib/tests {
          binaryen = scope.pkgs.binaryen;
          glib = scope.packages.glib;
          libffi = scope.packages.libffi;
          pcre2 = scope.packages.pcre2;
          stdenvWasi = scope.pkgsWasm.stdenv;
        };
        guile-smoke = scope.pkgs.callPackage ./nix/guile/tests {
          guile = scope.packages.guile;
          stdenvWasi = scope.pkgsWasm.stdenv;
        };
        harfbuzz-smoke = scope.pkgs.callPackage ./nix/harfbuzz/tests {
          font = scope.pkgs.dejavu_fonts.minimal;
          freetype = scope.packages.freetype;
          harfbuzz = scope.packages.harfbuzz;
          stdenvWasi = scope.pkgsWasm.stdenv;
          zlib = scope.packages.zlib;
        };
        libpng-smoke = scope.pkgs.callPackage ./nix/libpng/tests {
          libpng = scope.packages.libpng;
          stdenvWasi = scope.pkgsWasm.stdenv;
          zlib = scope.packages.zlib;
        };
        lilypond-link-smoke = scope.pkgs.callPackage ./nix/lilypond/tests {
          lilypond = scope.packages.lilypond;
        };
        lilypond-svg-smoke = scope.pkgs.callPackage ./nix/lilypond/tests/render.nix {
          guile = scope.packages.guile;
          lilypond = scope.packages.lilypond;
          lilypondAssets = scope.packages.lilypond-assets;
          lilypondBytecode = scope.packages.lilypond-bytecode;
        };
        lilypond-npm-smoke = scope.pkgs.callPackage ./nix/lilypond/tests/npm.nix {
          lilypondAssets = scope.packages.lilypond-assets;
          lilypondNpmTarball = scope.packages.lilypond-npm-tarball;
        };
        lilypond-source-bundle-manifest = let
          bundle = scope.packages.lilypond-source-bundle;
          expectedNames = scope.pkgs.writeText "lilypond-source-names" (
            nixpkgs.lib.concatStringsSep "\n" bundle.requiredSourceNames
            + "\n"
          );
        in
          scope.pkgs.runCommand "lilypond-source-bundle-manifest-check"
          {
            nativeBuildInputs = [
              scope.pkgs.diffutils
              scope.pkgs.jq
            ];
            manifest = bundle.manifestFile;
            sourceInputs = bundle.sourceInputs;
          }
          ''
            for source in $sourceInputs; do
              test -e "$source"
            done

            jq -e \
              --arg archive ${nixpkgs.lib.escapeShellArg bundle.archiveName} \
              --arg version ${nixpkgs.lib.escapeShellArg bundle.version} \
              --argjson sourceCount ${toString (builtins.length bundle.requiredSourceNames)} \
              '
                .schemaVersion == 1
                and .package.name == "@hlolli/lilypond-wasm"
                and .package.version == $version
                and .archive.fileName == $archive
                and (.sources | length) == $sourceCount
                and (
                  [.sources[].path] | length
                ) == (
                  [.sources[].path] | unique | length
                )
                and all(
                  .sources[];
                  (.version | type) == "string"
                  and (.version | length) > 0
                  and (.path | startswith("sources/"))
                  and (.originalStorePath | startswith("/nix/store/"))
                  and (.restore.command | startswith("nix store add "))
                  and .restore.expectedStorePath == .originalStorePath
                )
                and (
                  [
                    .sources[]
                    | select(.name == "libcxx-libcxxabi")
                    | .components[]
                  ]
                  == ["libc++", "libc++abi"]
                )
              ' \
              "$manifest"

            jq -r ".sources[].name" "$manifest" > actual-names
            diff -u ${expectedNames} actual-names

            mkdir -p "$out"
            cp "$manifest" "$out/manifest.json"
          '';
        pango-smoke = scope.pkgs.callPackage ./nix/pango/tests {
          binaryen = scope.pkgs.binaryen;
          expat = scope.packages.expat;
          font = scope.pkgs.dejavu_fonts.minimal;
          fontconfig = scope.packages.fontconfig;
          freetype = scope.packages.freetype;
          fribidi = scope.packages.fribidi;
          glib = scope.packages.glib;
          harfbuzz = scope.packages.harfbuzz;
          libffi = scope.packages.libffi;
          pango = scope.packages.pango;
          pcre2 = scope.packages.pcre2;
          stdenvWasi = scope.pkgsWasm.stdenv;
          zlib = scope.packages.zlib;
        };
        pcre2-smoke = scope.pkgs.callPackage ./nix/pcre2/tests {
          pcre2 = scope.packages.pcre2;
          stdenvWasi = scope.pkgsWasm.stdenv;
        };
        zlib-smoke = scope.pkgs.callPackage ./nix/zlib/tests {
          stdenvWasi = scope.pkgsWasm.stdenv;
          zlib = scope.packages.zlib;
        };
      }
    );
  };
}
