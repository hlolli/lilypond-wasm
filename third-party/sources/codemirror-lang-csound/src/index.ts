import {
  continuedIndent,
  LRLanguage,
  LanguageSupport,
  foldNodeProp,
  foldInside,
  indentUnit,
  indentNodeProp,
  syntaxTree,
} from '@codemirror/language';
import { completeFromList, ifIn } from '@codemirror/autocomplete';
import type { SyntaxNode, TreeCursor } from '@lezer/common';
import { ViewPlugin, showPanel, EditorView } from '@codemirror/view';
import type { PanelConstructor } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import {
  csoundTags,
  defaultCsoundLightTheme,
  htmlizeSynopsis,
  variableHighlighter,
} from './highlighter';
import { parser } from './parser.js';
import { builtinOpcodes } from './parser-utils';

const csoundModePlugin: Extension = ViewPlugin.fromClass(
  class {
    constructor(public view: EditorView) {}

    get decorations() {
      return variableHighlighter(this.view);
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

const findOperatorName = (view: EditorView, tree: TreeCursor) => {
  let node: SyntaxNode | null = tree.node;

  while (node) {
    if (node.name === 'FunctionCallExpr') {
      const callee = node.getChild('FunctionCallee');
      if (callee) {
        const tokenFull = view.state.sliceDoc(callee.from, callee.to);
        return {
          token: tokenFull.replace(/:.*/, ''),
          explicitRate: tokenFull.includes(':')
            ? tokenFull.split(':').at(-1)?.replaceAll('[]', '')
            : undefined,
          isFunctionSyntax: true,
        };
      }
    }

    if (node.name === 'OrcGenericLine') {
      const statement = view.state.sliceDoc(node.from, node.to);
      const candidates =
        statement.match(
          /[\p{L}_][\p{L}\p{N}_]*(?::[\p{L}_][\p{L}\p{N}_]*(?:\[\])*)?/gu,
        ) ?? [];
      const tokenFull = candidates.find(
        (candidate) => builtinOpcodes[candidate.replace(/:.*/, '')],
      );

      return tokenFull
        ? {
            token: tokenFull.replace(/:.*/, ''),
            explicitRate: tokenFull.includes(':')
              ? tokenFull.split(':').at(-1)?.replaceAll('[]', '')
              : undefined,
            isFunctionSyntax: false,
          }
        : {};
    }

    node = node.parent;
  }

  return {};
};

const csoundInfoPanel: PanelConstructor = (view: EditorView) => {
  const dom = document.createElement('div');

  return {
    dom,
    destroy() {
      dom.remove();
    },
    update(update) {
      if (update.heightChanged || update.selectionSet) {
        const isEmptyLine =
          view.lineBlockAt(view.state.selection.main.to).length < 2;
        if (isEmptyLine) {
          dom.innerHTML = '';
          return;
        }
        const treeRoot = syntaxTree(view.state).cursorAt(
          view.state.selection.main.head,
        );
        const {
          token: operatorName,
          explicitRate,
          isFunctionSyntax = false,
        } = findOperatorName(view, treeRoot);
        const synopsis = operatorName
          ? builtinOpcodes[operatorName]
          : undefined;
        if (operatorName && synopsis && synopsis.synopsis.length > 0) {
          let resolvedSynopsis = synopsis.synopsis[0];
          if (explicitRate) {
            for (const synop of synopsis.synopsis) {
              if (synop.startsWith(explicitRate)) {
                resolvedSynopsis = synop;
              }
            }
          }

          dom.innerHTML = htmlizeSynopsis(
            resolvedSynopsis,
            operatorName,
            isFunctionSyntax,
          );
        } else {
          dom.innerHTML = '';
        }
      }
    },
  };
};

const csoundInfo = () => {
  return showPanel.of(csoundInfoPanel);
};

const parserWithProps = parser.configure({
  props: [
    csoundTags,
    indentNodeProp.add({
      InstrumentDefinition: continuedIndent({ except: /^\s*endin/ }),
      LegacyUdo: continuedIndent({ except: /^\s*endop/ }),
      ModernUdo: continuedIndent({ except: /^\s*endop/ }),
      IfStatement: continuedIndent({
        except: /^\s*(endif|fi|else|elseif)/,
      }),
      WhileLoop: continuedIndent({ except: /^\s*od/ }),
      UntilLoop: continuedIndent({ except: /^\s*(od|enduntil)/ }),
      ForLoop: continuedIndent({ except: /^\s*od/ }),
      SwitchStatement: continuedIndent({
        except: /^\s*(case|default|endsw)/,
      }),
    }),
    foldNodeProp.add({
      InstrumentDefinition: foldInside,
      LegacyUdo: foldInside,
      ModernUdo: foldInside,
      IfStatement: foldInside,
      WhileLoop: foldInside,
      UntilLoop: foldInside,
      ForLoop: foldInside,
      SwitchStatement: foldInside,
      ScoreNestableLoop: foldInside,
      OptionsBlock: foldInside,
      InstrumentsBlock: foldInside,
      ScoreBlock: foldInside,
      CabbageBlock: foldInside,
    }),
  ],
});

function makeLanguage(name: string, top: string) {
  return LRLanguage.define({
    name,
    parser: parserWithProps.configure({ top }),
    languageData: {
      closeBrackets: { brackets: ['(', '[', '{', '"'] },
      commentTokens: { line: ';', block: { open: '/*', close: '*/' } },
    },
  });
}

export const csdLanguage = makeLanguage('csound-csd', 'CsdFile');
export const orcLanguage = makeLanguage('csound-orc', 'OrchestraFile');
export const scoLanguage = makeLanguage('csound-sco', 'ScoreFile');

export const csoundCsdLanguage = csdLanguage;
export const csoundOrcLanguage = orcLanguage;
export const csoundScoLanguage = scoLanguage;

const opcodeCompletion = ifIn(
  [
    'OrcStatements',
    'OrcGenericLine',
    'AssignmentStatement',
    'FunctionCallExpr',
  ],
  completeFromList(Object.keys(builtinOpcodes)),
);

export interface CsoundModeOptions {
  enableCompletion?: boolean;
  enableSynopsis?: boolean;
  enableDefaultTheme?: boolean;
  fileType?: 'csd' | 'orc' | 'sco';
}

export function csoundMode(options?: CsoundModeOptions) {
  const {
    fileType = 'csd',
    enableSynopsis = true,
    enableCompletion = true,
    enableDefaultTheme = true,
  } = options || {};
  const selectedLanguageVariant =
    fileType === 'orc'
      ? orcLanguage
      : fileType === 'sco'
        ? scoLanguage
        : csdLanguage;
  const features: Extension[] = [csoundModePlugin, indentUnit.of('  ')];

  if (enableSynopsis) {
    features.push(csoundInfo());
  }

  if (enableCompletion) {
    features.push(
      selectedLanguageVariant.data.of({ autocomplete: opcodeCompletion }),
    );
  }

  if (enableDefaultTheme) {
    features.push(defaultCsoundLightTheme);
  }

  return new LanguageSupport(selectedLanguageVariant, features);
}

export interface CsoundLanguageConfig extends Omit<
  CsoundModeOptions,
  'fileType'
> {
  mode?: 'csd' | 'orc' | 'sco';
}

export function csound(config?: CsoundLanguageConfig) {
  const { mode, ...options } = config ?? {};
  return csoundMode({ ...options, fileType: mode });
}
