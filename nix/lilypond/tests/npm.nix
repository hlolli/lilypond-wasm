{
  diffutils,
  gnutar,
  lilypondAssets,
  lilypondNpmTarball,
  lib,
  nodejs,
  runCommand,
  typescript,
  wasmtime,
}:
runCommand "lilypond-wasm-npm-smoke-${lilypondNpmTarball.version}"
{
  nativeBuildInputs = [
    diffutils
    gnutar
    nodejs
    typescript
    wasmtime
  ];
}
''
  export HOME="$PWD/home"
  export npm_config_cache="$PWD/npm-cache"
  export npm_config_offline=true
  export npm_config_ignore_scripts=true
  export npm_config_audit=false
  export npm_config_fund=false
  export npm_config_update_notifier=false

  mkdir -p \
    consumer \
    "$HOME" \
    "$npm_config_cache" \
    pack \
    unpack \
    work/cache/fontconfig \
    work/home \
    work/lily-lib \
    work/tmp

  tarball=${lib.escapeShellArg lilypondNpmTarball.tarballName}
  cp "${lilypondNpmTarball}/$tarball" "pack/$tarball"

  test -s "pack/$tarball"
  grep -F "  $tarball" "${lilypondNpmTarball}/SHA256SUMS"
  tar -xzf "pack/$tarball" -C unpack

  unpacked_package_dir="$PWD/unpack/package"

  check_release_manifest() {
    node --input-type=module --eval '
      import {readFileSync} from "node:fs";

      const manifest = JSON.parse(readFileSync(process.argv[1], "utf8"));

      if (Object.hasOwn(manifest, "private")) {
        throw new Error("the release package must not contain a private field");
      }
      if (manifest.author !== "Hlöðver Sigurðsson") {
        throw new Error("the release package has the wrong author");
      }
      if (manifest.publishConfig?.access !== "public") {
        throw new Error("the release package must use public access");
      }
      if (manifest.publishConfig?.provenance !== true) {
        throw new Error("the release package must request provenance");
      }
      if (manifest.publishConfig?.tag !== "next") {
        throw new Error("the release package must use the next dist-tag");
      }
    ' "$1"
  }

  check_release_manifest "$unpacked_package_dir/package.json"

  test -s "$unpacked_package_dir/dist/lilypond.wasm"
  test -s "$unpacked_package_dir/runtime/lilypond/2.27.2/ly/init.ly"
  test -s "$unpacked_package_dir/runtime/guile-ccache/ice-9/boot-9.go"
  test -s \
    "$unpacked_package_dir/runtime/lilypond-lib/ccache/lily/lily.go"
  test "$(
    find "$unpacked_package_dir/runtime/lilypond-lib/ccache/lily" \
      -type f \
      -name '*.go' \
      | wc -l
  )" -ge 66
  test -s "$unpacked_package_dir/COPYING"
  test -s "$unpacked_package_dir/LICENSE"
  test -s "$unpacked_package_dir/SOURCE.md"
  test -s "$unpacked_package_dir/THIRD_PARTY_NOTICES.md"
  test -s "$unpacked_package_dir/licenses/lilypond-wasm/COPYING"
  test -s \
    "$unpacked_package_dir/licenses/lilypond-wasm/THIRD_PARTY_NOTICES.md"
  test -s \
    "$unpacked_package_dir/licenses/lilypond-wasm/third-party/licenses/lilypond/LICENSE"
  test -s \
    "$unpacked_package_dir/licenses/lilypond-assets/URW-Base35-LICENSE"
  test -z "$(find "$unpacked_package_dir" -type l -print -quit)"

  diff -r \
    ${../../../third-party/licenses} \
    "$unpacked_package_dir/licenses/lilypond-wasm/third-party/licenses"
  diff -r \
    ${lilypondAssets}/share/licenses/lilypond-assets \
    "$unpacked_package_dir/licenses/lilypond-assets"
  grep -F \
    '(licenses/lilypond-wasm/third-party/licenses/lilypond)' \
    "$unpacked_package_dir/THIRD_PARTY_NOTICES.md"
  grep -F \
    '(third-party/licenses/lilypond)' \
    "$unpacked_package_dir/licenses/lilypond-wasm/THIRD_PARTY_NOTICES.md"
  grep -F \
    'licenses/lilypond-wasm/third-party/licenses/' \
    "$unpacked_package_dir/LICENSE"
  grep -F \
    "(https://github.com/hlolli/lilypond-wasm/blob/v${lilypondNpmTarball.version}/flake.lock)" \
    "$unpacked_package_dir/THIRD_PARTY_NOTICES.md"
  grep -F \
    "(https://github.com/hlolli/lilypond-wasm/tree/v${lilypondNpmTarball.version}/nix/" \
    "$unpacked_package_dir/THIRD_PARTY_NOTICES.md"

  node --input-type=module --eval '
    import {access, readFile} from "node:fs/promises";
    import {dirname, resolve} from "node:path";

    for (const file of process.argv.slice(1)) {
      const markdown = await readFile(file, "utf8");

      for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1];
        if (/^https?:\/\//.test(target)) {
          continue;
        }

        await access(resolve(dirname(file), target));
      }
    }
  ' \
    "$unpacked_package_dir/README.md" \
    "$unpacked_package_dir/SOURCE.md" \
    "$unpacked_package_dir/THIRD_PARTY_NOTICES.md"

  node --input-type=module --eval '
    import assert from "node:assert/strict";
    import {readFile} from "node:fs/promises";

    const source = await readFile(process.argv[1], "utf8");
    const hashes = [...source.matchAll(/SHA-256: `([a-f0-9]{64})`/g)];

    assert.equal(hashes.length, 2);
    assert.doesNotMatch(source, /@[A-Z_]+@/);
  ' "$unpacked_package_dir/SOURCE.md"
  grep -F \
    "releases/download/v${lilypondNpmTarball.version}/lilypond-wasm-v${lilypondNpmTarball.version}-source.tar.zst" \
    "$unpacked_package_dir/SOURCE.md"

  printf '%s\n' '{"private":true,"type":"module"}' > consumer/package.json
  cp ${../../../npm/test/render.mjs} consumer/render.mjs
  cp ${../../../npm/test/smoke.mjs} consumer/smoke.mjs
  cp ${../../../npm/test/typecheck.ts} consumer/typecheck.ts

  npm install \
    --offline \
    --ignore-scripts \
    --no-audit \
    --no-fund \
    --prefix "$PWD/consumer" \
    "$PWD/pack/$tarball"

  pushd consumer
  node smoke.mjs
  tsc \
    --noEmit \
    --module NodeNext \
    --moduleResolution NodeNext \
    --strict \
    --target ES2022 \
    typecheck.ts
  popd

  package_dir="$PWD/consumer/node_modules/@hlolli/lilypond-wasm"
  check_release_manifest "$package_dir/package.json"

  # Make source fallback fail, while keeping source times valid for the
  # matching bytecode. The render must load the packaged cache to pass.
  for bytecode in \
    "$package_dir/runtime/lilypond-lib/ccache/lily/"*.go
  do
    module_name="$(basename "$bytecode" .go)"
    source_file="$package_dir/runtime/lilypond/2.27.2/scm/lily/$module_name.scm"
    printf '%s\n' \
      '(error "packaged LilyPond bytecode cache was not used")' \
      > "$source_file"
    touch -r "$bytecode" "$source_file"
  done

  cp ${./smoke.ly} work/smoke.ly

  WASMTIME_BIN="${wasmtime}/bin/wasmtime" \
    LILYPOND_WASM_TEST_WORK="$PWD/work" \
    LILYPOND_WASM_TEST_INPUT="$PWD/work/smoke.ly" \
    node consumer/render.mjs

  test -s work/smoke.svg
  grep -F "<svg" work/smoke.svg
  grep -F "<path" work/smoke.svg
  grep -F "<text" work/smoke.svg
  grep -F 'font-family="C059"' work/smoke.svg
  grep -F ">WASI Text</tspan>" work/smoke.svg
  grep -F ">Bun</tspan>" work/smoke.svg
  grep -F ">dled</tspan>" work/smoke.svg
  grep -F ">text</tspan>" work/smoke.svg
  grep -F ">works.</tspan>" work/smoke.svg

  mkdir -p "$out"
  cp "pack/$tarball" "$out/"
  cp work/smoke.svg "$out/"
''
