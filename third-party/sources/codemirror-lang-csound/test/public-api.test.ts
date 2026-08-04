import { describe, expect, test } from 'bun:test';

import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { highlightTree, tagHighlighter, tags as t } from '@lezer/highlight';

import {
  csound,
  csoundMode,
  csoundOrcLanguage,
  orcLanguage,
} from '../src/index';

describe('public API', () => {
  test('loads without a browser document', () => {
    expect(typeof csoundMode).toBe('function');
    expect(typeof csound).toBe('function');
    expect(csoundOrcLanguage).toBe(orcLanguage);
  });

  test('exposes a working Csound 7 orchestra language', () => {
    const state = EditorState.create({
      doc: `
struct Point x:i, y:i
opcode offset(point:Point):Point
  result:Point init point.x + 1, point.y + 1
  xout(result)
endop
`,
      extensions: [csoundOrcLanguage],
    });
    let errors = 0;

    syntaxTree(state).iterate({
      enter(node) {
        if (node.type.isError) errors += 1;
      },
    });

    expect(errors).toBe(0);
    expect(
      csound({
        mode: 'orc',
        enableCompletion: false,
        enableDefaultTheme: false,
        enableSynopsis: false,
      }).language,
    ).toBe(csoundOrcLanguage);
  });

  test('highlights 0dbfs as one global constant', () => {
    const doc = '0dbfs = 1\n';
    const state = EditorState.create({
      doc,
      extensions: [csoundOrcLanguage],
    });
    const spans: Array<{ from: number; to: number; classes: string }> = [];

    highlightTree(
      syntaxTree(state),
      tagHighlighter([
        {
          tag: t.constant(t.variableName),
          class: 'csound-global-constant',
        },
      ]),
      (from, to, classes) => spans.push({ from, to, classes }),
    );

    expect(spans).toEqual([
      { from: 0, to: 5, classes: 'csound-global-constant' },
    ]);
  });
});
