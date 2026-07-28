# Corresponding source

This package contains a statically linked LilyPond WebAssembly binary and its
run-time data.

The signed `@RELEASE_TAG@` tag identifies this release. Its complete matching
source is:

<@SOURCE_ARCHIVE_URL@>

Source archive SHA-256: `@SOURCE_ARCHIVE_SHA256@`

Wasm SHA-256: `@WASM_SHA256@`

That archive must contain this repository, every local patch and build file,
the pinned LilyPond and dependency sources, and the linked WASI and LLVM
run-time sources. It must include the instructions needed to rebuild and
relink the Wasm file with changed LGPL libraries.

The release `SHA256SUMS` asset records the source archive and npm tarball
hashes. The npm tarball hash cannot appear inside that same tarball.

Do not publish this npm package until the source asset exists. Keep the source
asset available for as long as this package version remains available.
