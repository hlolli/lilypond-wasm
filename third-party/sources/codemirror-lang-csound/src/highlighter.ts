import { Decoration, EditorView } from '@codemirror/view';
import {
  HighlightStyle,
  syntaxTree,
  syntaxTreeAvailable,
  syntaxHighlighting,
} from '@codemirror/language';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Tag, styleTags, tags as t } from '@lezer/highlight';
import { builtinOpcodes, isGlobalConstant } from './parser-utils';

const commentCssClassName = 'cm-csound-comment';

const globalVarCssClassName = 'cm-csound-global-var';

const globalConstantCssClassName = 'cm-csound-global-constant';

const globalConstantDecoration = Decoration.mark({
  attributes: { class: globalConstantCssClassName },
});

const iRateVarCssClassName = 'cm-csound-i-rate-var';

const iRateVarDecoration = Decoration.mark({
  attributes: { class: iRateVarCssClassName },
});

const giRateVarDecoration = Decoration.mark({
  attributes: {
    class: [iRateVarCssClassName, globalVarCssClassName].join(' '),
  },
});

const opcodeCssClassName = 'cm-csound-opcode';

const opcodeDecoration = Decoration.mark({
  attributes: { class: opcodeCssClassName },
});

const aRateVarCssClassName = 'cm-csound-a-rate-var';

const aRateVarDecoration = Decoration.mark({
  attributes: { class: aRateVarCssClassName },
});

const gaRateVarDecoration = Decoration.mark({
  attributes: {
    class: [aRateVarCssClassName, globalVarCssClassName].join(' '),
  },
});

const kRateVarCssClassName = 'cm-csound-k-rate-var';

const kRateVarDecoration = Decoration.mark({
  attributes: { class: kRateVarCssClassName },
});

const gkRateVarDecoration = Decoration.mark({
  attributes: {
    class: [kRateVarCssClassName, globalVarCssClassName].join(' '),
  },
});

const sRateVarCssClassName = 'cm-csound-s-rate-var';

const sRateVarDecoration = Decoration.mark({
  attributes: { class: sRateVarCssClassName },
});

const gsRateVarDecoration = Decoration.mark({
  attributes: {
    class: [sRateVarCssClassName, globalVarCssClassName].join(' '),
  },
});

const fRateVarCssClassName = 'cm-csound-f-rate-var';

const fRateVarDecoration = Decoration.mark({
  attributes: { class: fRateVarCssClassName },
});

const gfRateVarDecoration = Decoration.mark({
  attributes: {
    class: [fRateVarCssClassName, globalVarCssClassName].join(' '),
  },
});

const pFieldVarCssClassName = 'cm-csound-p-field-var';

const pFieldVarDecoration = Decoration.mark({
  attributes: { class: pFieldVarCssClassName },
});

const xmlTagCssClassName = 'cm-csound-xml-tag';

const gotoTokenCssClassName = 'cm-csound-goto-token';

const gotoTokenDecoration = Decoration.mark({
  attributes: { class: gotoTokenCssClassName },
});

const macroTokenDecoration = Decoration.mark({
  attributes: { class: 'cm-csound-macro-token' },
});

const variableTag = Tag.define(); // acts as i-rate and fallback
const globalConstantTag = Tag.define();
const opcodeTag = Tag.define();
const xmlTag = Tag.define();
const bracketTag = Tag.define();
const defineOperatorTag = Tag.define();
const controlFlowTag = Tag.define();
const commentTag = Tag.define();
const macroTag = Tag.define();

export const csoundTags = styleTags({
  'instr endin opcode endop struct declare void': defineOperatorTag,
  String: t.string,
  RawString: t.string,
  Number: t.number,
  BooleanLiteral: t.bool,
  LineComment: commentTag,
  BlockComment: commentTag,
  LineContinuation: commentTag,
  FunctionCallee: opcodeTag,
  ScoreFunctionCallee: opcodeTag,
  ScoreOpcode: opcodeTag,
  'Identifier LegacyTypeIdentifier TypedIdentifier GlobalTypedIdentifier ArrayIdentifier TypedArrayIdentifier GlobalTypedArrayIdentifier':
    variableTag,
  HeaderIdentifier: [globalConstantTag, t.constant(t.variableName)],
  PField: variableTag,
  LabelName: t.labelName,
  'CsdOpenTag CsdCloseTag CsdLicenseOpen CsdLicenseClose CsdOptionsOpen CsdOptionsClose CsdInstrumentsOpen CsdInstrumentsClose CsdScoreOpen CsdScoreOpenCsbeats CsdScoreClose CsdCabbageOpen CsdCabbageClose':
    xmlTag,
  'if then ithen kthen elseif else endif fi while until do od enduntil for in switch case default endsw goto igoto kgoto rigoto reinit break continue return rireturn xin xout':
    controlFlowTag,
  'HashInclude HashIncludestr': t.moduleKeyword,
  'HashDefine HashUndef': defineOperatorTag,
  'HashIfdef HashIfndef HashElse HashEnd': controlFlowTag,
  'MacroUsage MacroUsageToken': macroTag,
  '(': bracketTag,
  ')': bracketTag,
  '[': bracketTag,
  ']': bracketTag,
  '{': bracketTag,
  '}': bracketTag,
});

const dynamicIdentifierNodes = new Set([
  'Identifier',
  'LegacyTypeIdentifier',
  'TypedIdentifier',
  'GlobalTypedIdentifier',
  'ArrayIdentifier',
  'TypedArrayIdentifier',
  'GlobalTypedArrayIdentifier',
  'HeaderIdentifier',
  'PField',
  'MacroUsageToken',
]);

function rateDecoration(rate: string, isGlobal: boolean) {
  switch (rate) {
    case 'a':
      return isGlobal ? gaRateVarDecoration : aRateVarDecoration;
    case 'k':
      return isGlobal ? gkRateVarDecoration : kRateVarDecoration;
    case 'S':
      return isGlobal ? gsRateVarDecoration : sRateVarDecoration;
    case 'f':
      return isGlobal ? gfRateVarDecoration : fRateVarDecoration;
    default:
      return isGlobal ? giRateVarDecoration : iRateVarDecoration;
  }
}

function explicitTypeRate(token: string) {
  const explicitType = token.includes('@global:')
    ? token.split('@global:').at(-1)
    : token.includes(':')
      ? token.split(':').at(-1)
      : undefined;
  const typeName = explicitType?.replaceAll('[]', '');
  return typeName && ['a', 'k', 'i', 'S', 'f'].includes(typeName)
    ? typeName
    : undefined;
}

function decorateIdentifier(token: string, parentToken: string) {
  const opcodeName = token
    .replace(/@global:.*/, '')
    .replace(/:.*/, '')
    .replace(/\[\]+$/, '');

  if (isGlobalConstant(token)) {
    return globalConstantDecoration;
  } else if (
    ['FunctionCallee', 'ScoreFunctionCallee', 'UdoName'].includes(
      parentToken,
    ) ||
    builtinOpcodes[opcodeName]
  ) {
    return opcodeDecoration;
  } else if (/^p\d+$/.test(token)) {
    return pFieldVarDecoration;
  } else if (/^\$.+/.test(token)) {
    return macroTokenDecoration;
  } else if (parentToken === 'LabelName') {
    return gotoTokenDecoration;
  }

  const typedRate = explicitTypeRate(token);
  const isExplicitGlobal = token.includes('@global:');
  if (typedRate || isExplicitGlobal) {
    return rateDecoration(typedRate ?? 'i', isExplicitGlobal);
  }

  const legacyRate = /^(?:g)?([akiSf])/.exec(token)?.[1] ?? 'i';
  return rateDecoration(legacyRate, /^g[akiSf]/.test(token));
}

export function variableHighlighter(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    if (syntaxTreeAvailable(view.state, to)) {
      syntaxTree(view.state).iterate({
        from,
        to,
        enter: (cursor) => {
          if (dynamicIdentifierNodes.has(cursor.name)) {
            const token = view.state.sliceDoc(cursor.from, cursor.to);
            const parentName = cursor.node.parent?.name;
            if (parentName === 'MemberAccessSegment') return;

            if (parentName) {
              builder.add(
                cursor.from,
                cursor.to,
                decorateIdentifier(token, parentName),
              );
            }
          }
        },
      });
    }
  }
  return builder.finish();
}

const defaultCsoundBaseTheme = EditorView.baseTheme({
  [`.${globalVarCssClassName}`]: {
    fontWeight: 600,
  },
  [`.${iRateVarCssClassName}`]: {
    color: '#29A8FF',
  },
  [`.${opcodeCssClassName}`]: {
    color: '#005cc5',
  },
  [`.${globalConstantCssClassName}`]: {
    color: '#22863a',
  },
  [`.${aRateVarCssClassName}`]: {
    color: '#6237FF',
  },
  [`.${kRateVarCssClassName}`]: {
    color: '#6C82AB',
  },
  [`.${sRateVarCssClassName}`]: {
    color: '#a11',
  },
  [`.${fRateVarCssClassName}`]: {
    color: '#004761',
  },
  [`.${pFieldVarCssClassName}`]: {
    color: '#FF9D0C',
    fontWeight: 600,
  },
  [`.${xmlTagCssClassName}`]: {
    color: '#22863a',
  },
  [`.${gotoTokenCssClassName}`]: {
    color: '#59648B',
    fontWeight: 600,
  },
  [`.${commentCssClassName}`]: {
    color: 'gray',
  },
});

const defaultCsoundLightThemeTagStyles = HighlightStyle.define(
  [
    {
      tag: globalConstantTag,
      color: '#22863a',
      class: globalConstantCssClassName,
    },
    { tag: opcodeTag, color: '#005cc5', class: `${opcodeCssClassName}` },
    { tag: defineOperatorTag, color: '#6f42c1', class: 'cm-csound-define' },
    { tag: bracketTag, color: '#22863a', class: 'cm-csound-bracket' },
    { tag: controlFlowTag, color: '#22863a', class: 'cm-csound-control-flow' },
    { tag: xmlTag, color: '#22863a', class: xmlTagCssClassName },
    { tag: commentTag, color: 'gray', class: commentCssClassName },
    { tag: t.string, color: '#a11', class: sRateVarCssClassName },
    { tag: t.number, color: '#0550ae', class: 'cm-csound-number' },
    { tag: t.bool, color: '#cf222e', class: 'cm-csound-boolean' },
    { tag: t.labelName, color: '#59648B', class: gotoTokenCssClassName },
    { tag: macroTag, color: 'red', class: 'cm-csound-macro' },
  ],
  { themeType: 'light' },
);

export const defaultCsoundLightTheme: Extension = [
  defaultCsoundBaseTheme,
  syntaxHighlighting(defaultCsoundLightThemeTagStyles),
];

const commaHtml = `<span style="margin-right: 5px;">, </span>`;

const makeComment = (commentText: string) =>
  `<span class="${commentCssClassName}">// ${commentText}</span>`;

const removeLastComma = (htmlString: string) =>
  htmlString.replace(/, <\/span>.?$/, ' </span>').replace(/,$/, '');

const removeLastCommaAndSpace = (htmlString: string) =>
  htmlString.replace(/, <\/span>.?$/, '</span>').replace(/,$/, '');

export const htmlizeSynopsis = (
  synopString: string,
  operatorName: string,
  isFunctionSyntax: boolean,
): string => {
  let body = '';
  const maybeCommentPos = synopString.indexOf(')');
  const needsFunctionalSyntaxRewrite = isFunctionSyntax && maybeCommentPos < 0;
  let maybeReturnTypeComment = '';
  const synopStringClean =
    maybeCommentPos > 0
      ? synopString.substring(0, maybeCommentPos + 1)
      : synopString;
  const splitSynopString = synopStringClean
    .replaceAll('[]', ';ARRAY;')
    .replace(/[,\[\]\.]/g, ' ')
    .replaceAll('(', ' (')
    .replace(/\s\s+/g, ' ')
    .replaceAll(';ARRAY;', '[]')
    .split(' ');
  for (const token of splitSynopString) {
    if (token) {
      if (token === operatorName) {
        if (needsFunctionalSyntaxRewrite) {
          maybeReturnTypeComment =
            `<span style="margin: 0 6px"></span>` +
            makeComment(`returns ${removeLastCommaAndSpace(body)}`);
          body = `<span class="${opcodeCssClassName}" style="font-weight: 700;">${token}</span>(`;
        } else {
          body = `${removeLastComma(
            body,
          )} <span class="${opcodeCssClassName}" style="font-weight: 700; margin-right: 3px;">${token}</span>`;
        }
      } else if (token.startsWith('a')) {
        body = `${body} <span class="${aRateVarCssClassName}">${token}</span>${commaHtml}`;
      } else if (token.startsWith('k')) {
        body = `${body} <span class="${kRateVarCssClassName}">${token}</span>${commaHtml}`;
      } else if (token.startsWith('"') || token.startsWith('S')) {
        body = `${body} <span class="${sRateVarCssClassName}">${token}</span>${commaHtml}`;
      } else if (token.startsWith('i')) {
        body = `${body} <span class="${iRateVarCssClassName}">${token}</span>${commaHtml}`;
      } else {
        body = `${body} ${token}${commaHtml}`;
      }
    }
  }

  const maybeComment =
    maybeCommentPos > 0 && synopString.substring(maybeCommentPos + 1);

  return `<p style="margin: 0; padding: 0; margin-left: 2px;">${removeLastCommaAndSpace(
    body,
  )}${needsFunctionalSyntaxRewrite ? ')' : ''}${
    maybeComment ? makeComment(maybeComment) : ''
  }${maybeReturnTypeComment}</p>`;
};
