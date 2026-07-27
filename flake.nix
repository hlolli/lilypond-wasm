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
    ...
  }: let
    systems = [
      "aarch64-darwin"
      "aarch64-linux"
      "x86_64-linux"
    ];
    forAllSystems = nixpkgs.lib.genAttrs systems;
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
