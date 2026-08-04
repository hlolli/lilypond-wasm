import { describe, expect, test } from 'bun:test';

import { countNodes, parseClean } from './parser-test-utils.js';

describe('Csound 7 orchestra syntax', () => {
  test('parses structs, declare, modern UDOs, and explicit global types', () => {
    const source = `
<CsoundSynthesizer>
<CsOptions>
-n
</CsOptions>
<CsInstruments>
struct Point x:i, y:i
struct Rectangle topLeft:Point, width:i, height:i

origin@global:Point init 0, 0
dimensions@global:i[] fillarray 640, 480

declare makePoint(arg1:Point):(Point)

opcode makePoint(arg1:Point):Point
  result:Point init arg1.x + 1, arg1.y + 1
  xout(result)
endop

instr 1
  points:Point[] init 2
  points[0].x = origin.x
  point2:Point = makePoint(origin)
  print(point2.y)
endin
</CsInstruments>
<CsScore>
i1 0 1
</CsScore>
</CsoundSynthesizer>
`;
    const tree = parseClean('CsdFile', source);

    expect(countNodes(tree, 'StructDefinition')).toBe(2);
    expect(countNodes(tree, 'GlobalTypedIdentifier')).toBe(1);
    expect(countNodes(tree, 'GlobalTypedArrayIdentifier')).toBe(1);
    expect(countNodes(tree, 'ModernUdo')).toBe(1);
    expect(countNodes(tree, 'MemberAccessExpr')).toBeGreaterThanOrEqual(1);
  });

  test('parses typed arrays, ranges, and slices on any expression', () => {
    const source = `
instr 1
  source:k[] = [phasor:k(0.3) * 360, 0.0]
  gains:k[] = dbapgains:k[](1, source, [0, 0, 45, 0], 3, 24.0)
  span:i[] = [0 ... lenarray(source) - 1]
  middle:k[] = source[0 : 4, 2]
  tail:k[] = source[2:]
  firstFive:i[] = ([1, 2, 3, 4, 5, 6, 7, 8, 9])[:5]
  value:k = matrix[1, 2]
endin
`;
    const tree = parseClean('OrchestraFile', source);

    expect(countNodes(tree, 'TypedArrayIdentifier')).toBeGreaterThanOrEqual(6);
    expect(countNodes(tree, 'ArrayLiteralExpr')).toBeGreaterThanOrEqual(3);
    expect(countNodes(tree, 'ArrayRangeExpr')).toBe(1);
    expect(countNodes(tree, 'ArraySliceExpr')).toBeGreaterThanOrEqual(3);
    expect(countNodes(tree, 'ArrayAccessExpr')).toBeGreaterThanOrEqual(4);
  });

  test('parses for loops and switch blocks', () => {
    const source = `
instr 1
  for value:S, index:k in ["one", "two", "three"] do
    print(index)
  od

  for index in [0 ... 3] do
    switch index
      case 0
        print(index)
      case 1
        print(index + 1)
      default
        print(-1)
    endsw
  od
endin
`;
    const tree = parseClean('OrchestraFile', source);

    expect(countNodes(tree, 'ForLoop')).toBe(2);
    expect(countNodes(tree, 'SwitchStatement')).toBe(1);
    expect(countNodes(tree, 'CaseBlock')).toBe(2);
    expect(countNodes(tree, 'DefaultBlock')).toBe(1);
  });

  test('parses nested R and brace raw strings', () => {
    const source = `
instr 1
  prints R{ "style": {
    "on": {"backgroundColor": "#ffa71e"},
    "template": R{ %s }R
  } \\n}R, "nested"

  iresult compilestr {{
    prints {{inner raw string
}}
  }}
endin
`;
    const tree = parseClean('OrchestraFile', source);

    expect(countNodes(tree, 'RawString')).toBeGreaterThanOrEqual(2);
  });

  test('parses boolean, exponent, hex, and unary literals', () => {
    const source = `
instr 1
  enabled:b = true
  running:k = truek
  stopped:k = falsek
  mask:i = 0xff
  tiny:i = 1e-30
  if !false && ~(mask == 0) then
    print(tiny)
  endif
endin
`;
    const tree = parseClean('OrchestraFile', source);

    expect(countNodes(tree, 'BooleanLiteral')).toBe(4);
    expect(countNodes(tree, 'Number')).toBeGreaterThanOrEqual(3);
    expect(countNodes(tree, 'OrcUnaryExpr')).toBeGreaterThanOrEqual(2);
  });

  test('parses multiline modern UDO declarations and calls', () => {
    const source = `
declare RecursiveLowpassByReference(
  signal:a,
  coefficient1:k,
  coefficient2:k,
  depth:p,
  count:p
):(a)

opcode RecursiveLowpassByReference(
    signal:a,
    coefficient1:k,
    coefficient2:k,
    depth:p,
    count:p
):a
  if (count < depth) then
    signal = RecursiveLowpassByReference(
      signal,
      coefficient1,
      coefficient2,
      depth,
      count + 1
    )
  endif
  xout LowpassByReference(signal, coefficient1, coefficient2)
endop

instr 1
  output:a = RecursiveLowpassByReference(
    inch(1),
    0.5,
    0.25,
    4,
    0
  )
  out(output)
endin
`;
    const tree = parseClean('OrchestraFile', source);

    expect(countNodes(tree, 'ModernUdo')).toBe(1);
    expect(countNodes(tree, 'FunctionCallExpr')).toBeGreaterThanOrEqual(2);
    expect(countNodes(tree, 'OrcCallExprList')).toBeGreaterThanOrEqual(2);
  });

  test('parses orchestra and score preprocessor branches', () => {
    const orchestra = `
#include "shared.orc"
#define SCALE(x) #x + 1#
#ifdef USE_ONE
instr 1
endin
#else
instr 2
endin
#end
`;
    const orcTree = parseClean('OrchestraFile', orchestra);

    expect(countNodes(orcTree, 'IncludeDirective')).toBe(1);
    expect(countNodes(orcTree, 'DefineDirective')).toBe(1);
    expect(countNodes(orcTree, 'DefineBody')).toBe(1);
    expect(countNodes(orcTree, 'OrcIfdefDirective')).toBe(1);

    const score = `
#define PLAY #1#
#ifdef PLAY
i1 0 1
#else
e
#end
`;
    const scoreTree = parseClean('ScoreFile', score);

    expect(countNodes(scoreTree, 'DefineDirective')).toBe(1);
    expect(countNodes(scoreTree, 'ScoreIfdefDirective')).toBe(1);
    expect(countNodes(scoreTree, 'ScoreStatementLine')).toBe(2);
  });

  test('keeps Unicode identifiers intact', () => {
    const source = `
struct Punktur hæð:i, breidd:i
staða@global:Punktur init 0, 0

declare tvöfalda(gildi:i):(i)

opcode tvöfalda(gildi:i):i
  niðurstaða:i = gildi * 2
  xout(niðurstaða)
endop

instr Hljóðfæri
  tíðni:k = 440
  svar:i = tvöfalda(21)
  print(svar, staða.hæð)
endin
`;
    const tree = parseClean('OrchestraFile', source);

    expect(countNodes(tree, 'StructDefinition')).toBe(1);
    expect(countNodes(tree, 'ModernUdo')).toBe(1);
    expect(countNodes(tree, 'InstrumentDefinition')).toBe(1);
    expect(countNodes(tree, 'Identifier')).toBeGreaterThanOrEqual(8);
  });
});
