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
        gmp = pkgsWasm.callPackage ./nix/gmp.nix {};
        libffi = pkgsWasm.callPackage ./nix/libffi.nix {};
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
        zlib-smoke = scope.pkgs.callPackage ./nix/zlib/tests {
          stdenvWasi = scope.pkgsWasm.stdenv;
          zlib = scope.packages.zlib;
        };
      }
    );
  };
}
