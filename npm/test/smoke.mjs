import assert from "node:assert/strict";
import {readFile, stat} from "node:fs/promises";
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

const manifest = JSON.parse(await readFile(runtimeManifestUrl, "utf8"));

assert.equal(lilypondVersion, "2.27.2");
assert.equal(guileVersion, "3.0.11");
assert.equal(manifest.lilypondVersion, lilypondVersion);
assert.equal(manifest.guileVersion, guileVersion);
assert.equal(manifest.wasm, "dist/lilypond.wasm");
assert.equal(manifest.metadataSection, wasmMetadataSection);

assert.deepEqual(manifest.environment, runtimeEnvironment);
assert.deepEqual(manifest.mountOrder, runtimeMountOrder);
assert.deepEqual(Object.keys(runtimeMounts), runtimeMountOrder);
assert.deepEqual(
  {
    argv0: manifest.argv0,
    wasi: manifest.wasi,
    wasmExceptions: manifest.wasmExceptions,
    writableDirectory: manifest.writableDirectory,
  },
  runtimeRequirements,
);

for (const [guestPath, hostUrl] of Object.entries(runtimeMounts)) {
  assert.equal(hostUrl.protocol, "file:");
  assert.equal(
    hostUrl.href,
    new URL(`${manifest.mounts[guestPath]}/`, runtimeManifestUrl).href,
  );
}

await Promise.all([
  stat(lilypondWasmUrl),
  stat(new URL("ly/init.ly", lilypondDataUrl)),
  stat(new URL("ccache/lily/lily.go", lilypondCompiledUrl)),
  stat(new URL("ice-9/boot-9.go", guileCompiledUrl)),
]);

const wasmModule = await WebAssembly.compile(await readFile(lilypondWasmUrl));
const metadataSections = WebAssembly.Module.customSections(
  wasmModule,
  wasmMetadataSection,
);

assert.equal(metadataSections.length, 1);

const metadata = JSON.parse(
  new TextDecoder().decode(metadataSections[0]),
);

assert.equal(metadata.name, "lilypond-wasm");
assert.equal(metadata.repository, "https://github.com/hlolli/lilypond-wasm");
assert.equal(metadata.projectAuthor, "Hlöðver Sigurðsson");
assert.equal(metadata.license, "GPL-3.0-or-later");
assert.equal(metadata.versions.lilypond, lilypondVersion);
assert.equal(metadata.versions.guile, guileVersion);
