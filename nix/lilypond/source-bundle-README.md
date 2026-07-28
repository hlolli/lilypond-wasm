# LilyPond WASM complete source bundle

This archive contains the exact project and upstream source inputs for
`@hlolli/lilypond-wasm` @version@.

`manifest.json` lists every source, its version, its path in this archive, its
original Nix store path, and the commands used to restore, relink, and rebuild
the package.

To unpack the archive:

```sh
zstd -dc @archiveName@ | tar -xf -
cd @bundleRootName@
```

Review the restore commands before running them:

```sh
jq -r '.sources[].restore.command' manifest.json
```

After restoring the source paths, use the commands in
`instructions.relink` or `instructions.rebuild`. Nix may still download build
tools from the binary caches in your Nix setup; every source linked into the
WebAssembly binary is present here.
