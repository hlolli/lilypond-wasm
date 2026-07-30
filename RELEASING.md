# Releasing

The target npm release is `@hlolli/lilypond-wasm@0.1.0-alpha.3` under the
`next` tag. Do not use `latest` for an alpha.

## Build and check

Start from the signed commit that the signed `v0.1.0-alpha.3` tag will name.

```sh
nix flake check --all-systems --no-build --no-update-lock-file
nix build .#checks.aarch64-darwin.lilypond-npm-smoke \
  --no-update-lock-file \
  --print-build-logs
nix build .#lilypond-source-bundle \
  --out-link release/source \
  --no-update-lock-file
nix build .#lilypond-npm-tarball \
  --out-link release/npm \
  --no-update-lock-file
```

The npm smoke check installs the exact release tarball offline, checks its
types and metadata, and renders a score through Wasmtime.

Build both outputs twice from clean checkouts and compare the source archive,
npm tarball, Wasm, and `SHA256SUMS` before publishing.

## Publish the matching source first

Create the signed `v0.1.0-alpha.3` tag and a GitHub release for it. Upload:

- `release/source/lilypond-wasm-v0.1.0-alpha.3-source.tar.zst`
- `release/npm/hlolli-lilypond-wasm-0.1.0-alpha.3.tgz`
- `release/npm/SHA256SUMS`

Check the uploaded source archive hash against `SHA256SUMS`. Keep the source
asset available while the npm version remains available.

## Publish the exact npm tarball

Publish only the tarball produced by `lilypond-npm-tarball`. Do not publish
the `npm/` source template, which has no generated Wasm or run-time files.

If publishing from a local login, turn off provenance for that command:

```sh
NPM_CONFIG_PROVENANCE=false npm publish \
  release/npm/hlolli-lilypond-wasm-0.1.0-alpha.3.tgz \
  --access public \
  --tag next
```

After the first version exists, configure a trusted GitHub publisher before
automating later releases. Check the installed package and its `next` tag
after every publish.
