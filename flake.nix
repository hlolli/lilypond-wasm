{
  description = "Static LilyPond dependencies for WebAssembly";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    lilypond = {
      url = "gitlab:lilypond/lilypond/master";
      flake = false;
    };
  };

  outputs =
    {
      nixpkgs,
      ...
    }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
            config.allowUnsupportedSystem = true;
          };
          pkgsWasm = pkgs.pkgsCross.wasi32;
        in
        rec {
          boehm-gc = pkgsWasm.callPackage ./nix/boehm-gc.nix { };
          gmp = pkgsWasm.callPackage ./nix/gmp.nix { };
          libffi = pkgsWasm.callPackage ./nix/libffi.nix { };
          libunistring = pkgsWasm.callPackage ./nix/libunistring.nix { };
          guile = pkgsWasm.callPackage ./nix/guile.nix {
            boehmgc = boehm-gc;
            inherit gmp libunistring;
            libffi = libffi;
          };
          default = guile;
        }
      );
    };
}
