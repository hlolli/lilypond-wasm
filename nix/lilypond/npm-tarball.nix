{
  lilypondNpm,
  lilypondSourceBundle,
  nodejs,
  stdenvNoCC,
}: let
  packageMetadata = builtins.fromJSON (builtins.readFile ../../npm/package.json);
  sourceArchiveName = lilypondSourceBundle.archiveName;
in
  stdenvNoCC.mkDerivation {
    pname = "lilypond-wasm-npm-tarball";
    inherit (packageMetadata) version;

    strictDeps = true;
    nativeBuildInputs = [nodejs];

    dontUnpack = true;
    dontConfigure = true;
    dontBuild = true;
    dontFixup = true;

    installPhase = ''
      runHook preInstall

      mkdir -p "$out"

      export HOME="$TMPDIR/home"
      export npm_config_cache="$TMPDIR/npm-cache"
      mkdir -p "$HOME" "$npm_config_cache"

      tarball="$(
        npm pack \
          --ignore-scripts \
          --pack-destination "$out" \
          --silent \
          ${lilypondNpm}
      )"

      test -s "$out/$tarball"
      test -s "${lilypondSourceBundle}/${sourceArchiveName}"

      npm_sha256="$(sha256sum "$out/$tarball" | cut -d ' ' -f 1)"
      source_sha256="$(
        sha256sum "${lilypondSourceBundle}/${sourceArchiveName}" \
          | cut -d ' ' -f 1
      )"
      wasm_sha256="$(
        sha256sum "${lilypondNpm}/dist/lilypond.wasm" \
          | cut -d ' ' -f 1
      )"

      grep -F "$source_sha256" "${lilypondNpm}/SOURCE.md"
      grep -F "$wasm_sha256" "${lilypondNpm}/SOURCE.md"

      printf '%s  %s\n' \
        "$npm_sha256" \
        "$tarball" \
        "$source_sha256" \
        "${sourceArchiveName}" \
        > "$out/SHA256SUMS"

      runHook postInstall
    '';

    passthru = {
      packageName = packageMetadata.name;
      sourceArchive = lilypondSourceBundle;
      inherit sourceArchiveName;
      tarballName = "hlolli-lilypond-wasm-${packageMetadata.version}.tgz";
    };
  }
