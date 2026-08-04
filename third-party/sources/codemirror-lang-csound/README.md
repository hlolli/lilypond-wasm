# codemirror-lang-csound

CodeMirror 6 language support for Csound CSD, ORC, and SCO files.

The parser supports classic Csound syntax and Csound 7 forms such as typed
names, structs, modern UDO signatures, array ranges and slices, `for` loops,
`switch` blocks, raw strings, preprocessors, and typed opcode calls.

## Install

```sh
npm install @hlolli/codemirror-lang-csound codemirror
```

Or with Bun:

```sh
bun add @hlolli/codemirror-lang-csound codemirror
```

## Use

```ts
import { basicSetup, EditorView } from 'codemirror';
import { csoundMode } from '@hlolli/codemirror-lang-csound';

new EditorView({
  extensions: [basicSetup, csoundMode({ fileType: 'csd' })],
  parent: document.querySelector('#editor')!,
});
```

Set `fileType` to `csd`, `orc`, or `sco`. `csound({ mode: 'orc' })` is a short
alias. The package also exports `csdLanguage`, `orcLanguage`, and `scoLanguage`.

## Develop

```sh
bun install
bun run check
bun run build
```

Run the parser against a Csound source checkout:

```sh
bun run test:csound -- ../csound/tests
```

The scan also reads `CSOUND_TESTS_DIR` and otherwise uses
`../csound/tests`.

The unified grammar and its raw-string tokenizer draw on work from
[kunstmusik/codemirror-lang-csound](https://github.com/kunstmusik/codemirror-lang-csound).
See `THIRD_PARTY_NOTICES.md`.
