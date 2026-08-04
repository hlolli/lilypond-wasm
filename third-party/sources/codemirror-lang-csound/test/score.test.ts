import { describe, expect, test } from 'bun:test';

import { countNodes, parseClean } from './parser-test-utils.js';

describe('Csound score syntax', () => {
  test('parses expressions, macros, relative fields, and statement forms', () => {
    const source = `
// score comment
i1 0 .5 + np^3 pp^4 $MACRO(1'2)
i2 1 [0.25 + (p3 * 2)] [sin(0.5) + (~ * 0.1)]
f20 0 16 -2 .001
t 0 60 40 120
s
e
`;
    const tree = parseClean('ScoreFile', source);

    expect(countNodes(tree, 'ScoreStatementLine')).toBe(6);
    expect(countNodes(tree, 'ScoreOpcode')).toBe(6);
    expect(countNodes(tree, 'ScoreBracketExpr')).toBe(2);
    expect(countNodes(tree, 'ScoreFunctionCallExpr')).toBe(1);
    expect(countNodes(tree, 'ScoreRelativePField')).toBe(2);
    expect(countNodes(tree, 'ScoreCarry')).toBe(1);
  });

  test('parses carry, ramp, relative-time, continuation, and loop forms', () => {
    const source = `
i1 2 8 60.00 60
i1 ^+10 8 72.00 60
i2 + . >
i. + . . 448 <
f1 0 32 -2 6.00 6.02 6.04 6.05
   7.00 7.02 7.04 7.05
{ 4 CNT
  { 8 PARTIAL
    i3 1 2 3 4
  }
}
e
`;
    const tree = parseClean('ScoreFile', source);

    expect(countNodes(tree, 'ScoreRelativeTime')).toBe(1);
    expect(countNodes(tree, 'ScoreCarry')).toBeGreaterThanOrEqual(8);
    expect(countNodes(tree, 'ScoreContinuationLine')).toBe(1);
    expect(countNodes(tree, 'ScoreNestableLoop')).toBe(2);
  });

  test('accepts quoted Unicode instrument names in a CSD score', () => {
    const source = `
<CsoundSynthesizer>
<CsInstruments>
instr Hljóðfæri
endin
</CsInstruments>
<CsScore>
i "Hljóðfæri" 0 1
e
</CsScore>
</CsoundSynthesizer>
`;
    const tree = parseClean('CsdFile', source);

    expect(countNodes(tree, 'InstrumentDefinition')).toBe(1);
    expect(countNodes(tree, 'ScoreStatementLine')).toBe(2);
    expect(countNodes(tree, 'String')).toBe(1);
  });
});
