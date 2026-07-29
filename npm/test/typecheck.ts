import {
  guileCompiledUrl,
  guileVersion,
  lilypondCompiledUrl,
  lilypondDataUrl,
  lilypondVersion,
  lilypondWasmUrl,
  runtimeEnvironment,
  runtimeManifestUrl,
  runtimeMountOrder,
  runtimeMounts,
  runtimeRequirements,
  wasmMetadataSection,
} from "@hlolli/lilypond-wasm";

const assetUrls: URL[] = [
  guileCompiledUrl,
  lilypondCompiledUrl,
  lilypondDataUrl,
  lilypondWasmUrl,
  runtimeManifestUrl,
  ...Object.values(runtimeMounts),
];

const versions: readonly string[] = [guileVersion, lilypondVersion];
const metadataSection: string = wasmMetadataSection;
const preview: "preview1" = runtimeRequirements.wasi;
const fontconfigFile: string = runtimeEnvironment.FONTCONFIG_FILE;
const mountOrder: readonly string[] = runtimeMountOrder;

void assetUrls;
void versions;
void metadataSection;
void preview;
void fontconfigFile;
void mountOrder;
