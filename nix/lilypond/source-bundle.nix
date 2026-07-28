{
  compilerRt,
  coreutils,
  gnutar,
  libcxx,
  lib,
  lilypondAssets,
  lilypondPackage,
  lilypondSource,
  linkedSources,
  nixpkgsSource,
  projectSource,
  runCommand,
  sourcePins,
  wasiLibc,
  zstd,
  version,
}: let
  archiveName = "lilypond-wasm-v${version}-source.tar.zst";
  bundleRootName = "lilypond-wasm-v${version}-source";

  pinFor = name: sourcePins.${name} or {};

  mkSource = {
    components ? [],
    kind,
    name,
    source,
    version,
  }: let
    pin = pinFor name;
    originalStorePath =
      builtins.unsafeDiscardStringContext (builtins.toString source);
    storeBaseName = builtins.baseNameOf originalStorePath;
    storeNameMatch = builtins.match "[^-]+-(.*)" storeBaseName;
    storeName =
      if storeNameMatch == null
      then storeBaseName
      else builtins.head storeNameMatch;
    path = "sources/${name}/${storeBaseName}";
    sourceAttrs =
      if builtins.isAttrs source
      then source
      else {};
    storeMode =
      if kind == "file"
      then "flat"
      else "nar";
  in {
    inherit
      components
      kind
      name
      originalStorePath
      path
      source
      storeBaseName
      storeName
      version
      ;
    fixedOutputHash = sourceAttrs.outputHash or null;
    narHash = pin.narHash or (sourceAttrs.narHash or null);
    revision =
      pin.revision
      or (sourceAttrs.rev or (sourceAttrs.tag or null));
    restore = {
      command =
        "nix store add"
        + " --mode ${storeMode}"
        + " --hash-algo sha256"
        + " --name ${lib.escapeShellArg storeName}"
        + " ${lib.escapeShellArg path}";
      expectedStorePath = originalStorePath;
      inherit storeMode;
    };
  };

  linkedSourceEntries =
    map (
      linked:
        mkSource {
          inherit (linked) kind name;
          inherit (linked.package) version;
          source = linked.package.src;
        }
    )
    linkedSources;

  sourceEntries = lib.sort (left: right: left.name < right.name) (
    linkedSourceEntries
    ++ [
      (mkSource {
        kind = "directory";
        name = "compiler-rt";
        source = compilerRt.src;
        inherit (compilerRt) version;
      })
      (mkSource {
        kind = "directory";
        name = "dejavu-fonts";
        source = lilypondAssets.sourceInputs.dejavu.source;
        inherit (lilypondAssets.sourceInputs.dejavu) version;
      })
      (mkSource {
        components = [
          "libc++"
          "libc++abi"
        ];
        kind = "directory";
        name = "libcxx-libcxxabi";
        source = libcxx.src;
        inherit (libcxx) version;
      })
      (mkSource {
        kind = "directory";
        name = "lilypond";
        source = lilypondSource;
        version = lilypondPackage.version;
      })
      (mkSource {
        kind = "directory";
        name = "lilypond-wasm";
        source = projectSource;
        inherit version;
      })
      (mkSource {
        kind = "directory";
        name = "nixpkgs";
        source = nixpkgsSource;
        version = (pinFor "nixpkgs").revision;
      })
      (mkSource {
        kind = "directory";
        name = "urw-base35";
        source = lilypondAssets.sourceInputs.urw-base35.source;
        inherit (lilypondAssets.sourceInputs.urw-base35) version;
      })
      (mkSource {
        kind = "directory";
        name = "wasi-libc";
        source = wasiLibc.src;
        inherit (wasiLibc) version;
      })
    ]
  );

  entryFor = name:
    lib.findFirst
    (entry: entry.name == name)
    (throw "source bundle entry ${name} is missing")
    sourceEntries;

  projectArchivePath = (entryFor "lilypond-wasm").path;
  nixpkgsArchivePath = (entryFor "nixpkgs").path;
  lilypondArchivePath = (entryFor "lilypond").path;

  inputOverrides =
    "--override-input nixpkgs \"path:$PWD/${nixpkgsArchivePath}\""
    + " --override-input lilypond \"path:$PWD/${lilypondArchivePath}\"";

  manifest = {
    schemaVersion = 1;
    package = {
      name = "@hlolli/lilypond-wasm";
      inherit version;
    };
    archive = {
      fileName = archiveName;
      root = bundleRootName;
      compression = "zstd";
    };
    reproducibility = {
      archiveFormat = "gnu";
      entryOrder = "name";
      owner = 0;
      group = 0;
      mtime = 1;
      zstdLevel = 15;
      zstdThreads = 1;
    };
    sources = map (entry: removeAttrs entry ["source"]) sourceEntries;
    instructions = {
      restore = [
        "Run each sources[].restore.command from this directory."
        "Compare each command result with sources[].restore.expectedStorePath."
      ];
      relink = [
        (
          "nix build --print-build-logs "
          + inputOverrides
          + " \"path:$PWD/${projectArchivePath}#lilypond\""
        )
      ];
      rebuild = [
        (
          "nix build --print-build-logs "
          + inputOverrides
          + " \"path:$PWD/${projectArchivePath}#lilypond-npm\""
        )
      ];
    };
  };

  manifestFile =
    builtins.toFile
    "lilypond-wasm-v${version}-source-manifest.json"
    (builtins.toJSON manifest);

  copySources =
    lib.concatMapStringsSep "\n" (entry: ''
      install -d "$bundleRoot/sources/${entry.name}"
      cp -a --no-preserve=ownership \
        ${lib.escapeShellArg (builtins.toString entry.source)} \
        "$bundleRoot/${entry.path}"
    '')
    sourceEntries;
in
  runCommand "lilypond-wasm-source-bundle-${version}"
  {
    inherit version;
    nativeBuildInputs = [
      coreutils
      gnutar
      zstd
    ];

    passthru = {
      inherit
        archiveName
        bundleRootName
        manifest
        manifestFile
        ;
      requiredSourceNames = map (entry: entry.name) sourceEntries;
      sourceInputs = map (entry: entry.source) sourceEntries;
    };
  }
  ''
    bundleRoot="$TMPDIR/${bundleRootName}"
    install -d "$bundleRoot"

    ${copySources}

    cp ${manifestFile} "$bundleRoot/manifest.json"
    substitute ${./source-bundle-README.md} "$bundleRoot/README.md" \
      --subst-var-by archiveName ${lib.escapeShellArg archiveName} \
      --subst-var-by bundleRootName ${lib.escapeShellArg bundleRootName} \
      --subst-var-by version ${lib.escapeShellArg version}

    install -d "$out"
    cp "$bundleRoot/manifest.json" "$out/manifest.json"

    tar \
      --sort=name \
      --format=gnu \
      --mtime="@1" \
      --owner=0 \
      --group=0 \
      --numeric-owner \
      --mode="u+rwX,go+rX,go-w" \
      -C "$TMPDIR" \
      -cf - \
      ${lib.escapeShellArg bundleRootName} \
      | zstd \
          --compress \
          --stdout \
          --no-progress \
          --threads=1 \
          -15 \
          > "$out/${archiveName}"

    test -s "$out/${archiveName}"
  ''
