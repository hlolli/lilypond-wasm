{
  guile,
  lib,
  lilypond,
  lilypondAssets,
  lilypondSourceBundle,
  nodejs,
  stdenvNoCC,
}: let
  packageMetadata = builtins.fromJSON (builtins.readFile ../../npm/package.json);
  releasePackageMetadata =
    (builtins.removeAttrs packageMetadata ["private"])
    // {
      author = packageMetadata.author or "Hlöðver Sigurðsson";
      publishConfig =
        (packageMetadata.publishConfig or {})
        // {
          tag = "next";
        };
    };
  releasePackageJson = builtins.toFile "lilypond-wasm-package.json" (builtins.toJSON releasePackageMetadata);
  releaseTag = "v${packageMetadata.version}";
  releaseBlobUrl = "https://github.com/hlolli/lilypond-wasm/blob/${releaseTag}";
  releaseTreeUrl = "https://github.com/hlolli/lilypond-wasm/tree/${releaseTag}";
  sourceArchive = "${lilypondSourceBundle}/${lilypondSourceBundle.archiveName}";
  sourceArchiveUrl =
    "https://github.com/hlolli/lilypond-wasm/releases/download/"
    + "${releaseTag}/${lilypondSourceBundle.archiveName}";
in
  assert packageMetadata.private;
    stdenvNoCC.mkDerivation {
      pname = "lilypond-wasm-npm";
      inherit (packageMetadata) version;

      src = ../../npm;

      strictDeps = true;
      nativeBuildInputs = [nodejs];

      dontConfigure = true;
      dontBuild = true;
      dontFixup = true;

      installPhase = ''
          runHook preInstall

          mkdir -p \
            "$out/dist" \
            "$out/licenses" \
            "$out/runtime"

          cp \
            README.md \
            index.d.ts \
            index.js \
            runtime-manifest.json \
            "$out/"
        install -m 0644 ${releasePackageJson} "$out/package.json"

        cp ${../../COPYING} "$out/COPYING"
        substitute \
          ${../../LICENSE} \
          "$out/LICENSE" \
          --replace-fail \
          "third-party/licenses/" \
          "licenses/lilypond-wasm/third-party/licenses/"
        substitute \
          ${../../THIRD_PARTY_NOTICES.md} \
          "$out/THIRD_PARTY_NOTICES.md" \
          --replace-fail \
          "(third-party/licenses)" \
          "(licenses/lilypond-wasm/third-party/licenses)" \
          --replace-fail \
          "(third-party/licenses/" \
          "(licenses/lilypond-wasm/third-party/licenses/" \
          --replace-fail \
          "(flake.lock)" \
          "(${releaseBlobUrl}/flake.lock)" \
          --replace-fail \
          "(nix)" \
          "(${releaseTreeUrl}/nix)" \
          --replace-fail \
          "(nix/" \
          "(${releaseTreeUrl}/nix/"

          cp ${lilypond}/bin/lilypond.wasm "$out/dist/lilypond.wasm"
          cp -R ${lilypondAssets}/share/lilypond "$out/runtime/lilypond"
          cp -R ${guile}/lib/guile/3.0/ccache "$out/runtime/guile-ccache"

          source_sha256="$(sha256sum ${sourceArchive} | cut -d ' ' -f 1)"
          wasm_sha256="$(
            sha256sum "$out/dist/lilypond.wasm" \
              | cut -d ' ' -f 1
          )"
          substitute \
            SOURCE.md \
            "$out/SOURCE.md" \
            --replace-fail \
            "@RELEASE_TAG@" \
            ${lib.escapeShellArg releaseTag} \
            --replace-fail \
            "@SOURCE_ARCHIVE_URL@" \
            ${lib.escapeShellArg sourceArchiveUrl} \
            --replace-fail \
            "@SOURCE_ARCHIVE_SHA256@" \
            "$source_sha256" \
            --replace-fail \
            "@WASM_SHA256@" \
            "$wasm_sha256"

          cp -R \
            ${lilypond}/share/licenses/lilypond-wasm \
            "$out/licenses/lilypond-wasm"
          cp -R \
            ${lilypondAssets}/share/licenses/lilypond-assets \
            "$out/licenses/lilypond-assets"

          test -s "$out/dist/lilypond.wasm"
          test -s "$out/runtime/lilypond/${lilypond.version}/ly/init.ly"
          test -s "$out/runtime/guile-ccache/ice-9/boot-9.go"
          test -s "$out/licenses/lilypond-wasm/THIRD_PARTY_NOTICES.md"
          test -s "$out/licenses/lilypond-assets/URW-Base35-LICENSE"

          node --check "$out/index.js"

          export HOME="$TMPDIR/home"
          export npm_config_cache="$TMPDIR/npm-cache"
          mkdir -p "$HOME" "$npm_config_cache" "$TMPDIR/npm-pack"
          npm pack \
            --dry-run \
            --ignore-scripts \
            --pack-destination "$TMPDIR/npm-pack" \
            --silent \
            "$out"

          runHook postInstall
      '';

      passthru = {
        packageName = packageMetadata.name;
        guileVersion = guile.version;
        lilypondVersion = lilypond.version;
      };

      meta = {
        description = "npm package payload for the SVG-only LilyPond WASI runtime";
        homepage = "https://github.com/hlolli/lilypond-wasm";
        license = with lib.licenses; [
          agpl3Only
          free
          gpl3Only
          gpl3Plus
          ofl
        ];
        platforms = lib.platforms.all;
      };
    }
