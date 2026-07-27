{
  description = "Static LilyPond dependencies for WebAssembly";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    lilypond = {
      url = "gitlab:lilypond/lilypond/master";
      flake = false;
    };
  };

  outputs = {nixpkgs, ...}: let
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
      packages = rec {
        boehm-gc = pkgsWasm.callPackage ./nix/boehm-gc.nix {};
        expat = pkgsWasm.callPackage ./nix/expat {};
        freetype = pkgsWasm.callPackage ./nix/freetype {
          inherit zlib;
        };
        gmp = pkgsWasm.callPackage ./nix/gmp.nix {};
        libffi = pkgsWasm.callPackage ./nix/libffi.nix {};
        libpng = pkgsWasm.callPackage ./nix/libpng {
          inherit zlib;
        };
        libunistring = pkgsWasm.callPackage ./nix/libunistring.nix {};
        zlib = pkgsWasm.callPackage ./nix/zlib {};
        guile = pkgsWasm.callPackage ./nix/guile.nix {
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
        libpng-smoke = scope.pkgs.callPackage ./nix/libpng/tests {
          libpng = scope.packages.libpng;
          stdenvWasi = scope.pkgsWasm.stdenv;
          zlib = scope.packages.zlib;
        };
        zlib-smoke = scope.pkgs.callPackage ./nix/zlib/tests {
          stdenvWasi = scope.pkgsWasm.stdenv;
          zlib = scope.packages.zlib;
        };
      }
    );
  };
}
