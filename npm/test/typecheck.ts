import {
  guileCompiledUrl,
  guileVersion,
  lilypondDataUrl,
  lilypondVersion,
  lilypondWasmUrl,
  runtimeEnvironment,
  runtimeManifestUrl,
  runtimeMounts,
  runtimeRequirements,
  wasmMetadataSection,
} from "@hlolli/lilypond-wasm";

const assetUrls: URL[] = [
  guileCompiledUrl,
  lilypondDataUrl,
  lilypondWasmUrl,
  runtimeManifestUrl,
  ...Object.values(runtimeMounts),
];

const versions: readonly string[] = [guileVersion, lilypondVersion];
const metadataSection: string = wasmMetadataSection;
const preview: "preview1" = runtimeRequirements.wasi;
const fontconfigFile: string = runtimeEnvironment.FONTCONFIG_FILE;

void assetUrls;
void versions;
void metadataSection;
void preview;
void fontconfigFile;
