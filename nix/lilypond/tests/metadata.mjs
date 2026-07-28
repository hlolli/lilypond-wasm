import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const [wasmPath, expectedMetadataPath, sectionName] = process.argv.slice(2);

assert.ok(wasmPath, "missing Wasm path");
assert.ok(expectedMetadataPath, "missing expected metadata path");
assert.ok(sectionName, "missing custom section name");

const [wasmBytes, expectedMetadataBytes] = await Promise.all([
  readFile(wasmPath),
  readFile(expectedMetadataPath),
]);

const wasmModule = await WebAssembly.compile(wasmBytes);
const sections = WebAssembly.Module.customSections(wasmModule, sectionName);

assert.equal(sections.length, 1, `expected one ${sectionName} custom section`);
assert.deepEqual(Buffer.from(sections[0]), expectedMetadataBytes);

const metadata = JSON.parse(expectedMetadataBytes.toString("utf8"));

assert.equal(metadata.schemaVersion, 1);
assert.equal(metadata.name, "lilypond-wasm");
assert.equal(metadata.repository, "https://github.com/hlolli/lilypond-wasm");
assert.equal(metadata.projectAuthor, "Hlöðver Sigurðsson");
assert.equal(metadata.license, "GPL-3.0-or-later");
assert.equal(
  metadata.notices,
  "https://github.com/hlolli/lilypond-wasm/blob/main/THIRD_PARTY_NOTICES.md",
);
assert.equal(metadata.versions.lilypond, "2.27.2");
assert.equal(metadata.versions.guile, "3.0.11");
assert.equal(
  metadata.lilypondSource.repository,
  "https://gitlab.com/lilypond/lilypond",
);
assert.match(metadata.lilypondSource.revision, /^[0-9a-f]{40}$/);
assert.match(metadata.lilypondSource.narHash, /^sha256-/);
