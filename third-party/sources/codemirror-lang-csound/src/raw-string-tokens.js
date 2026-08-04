// Adapted from kunstmusik/codemirror-lang-csound under its declared MIT terms.
// See THIRD_PARTY_NOTICES.md.

import { ExternalTokenizer } from '@lezer/lr';

import { BlockComment, rawString } from './parser.terms.js';

const OPEN_BRACE = 123;
const CLOSE_BRACE = 125;
const LETTER_R = 82;
const SLASH = 47;
const ASTERISK = 42;

function isBraceRawStart(input) {
  return input.next === OPEN_BRACE && input.peek(1) === OPEN_BRACE;
}

function isRRawStart(input) {
  return input.next === LETTER_R && input.peek(1) === OPEN_BRACE;
}

function isBraceRawEnd(input) {
  return input.next === CLOSE_BRACE && input.peek(1) === CLOSE_BRACE;
}

function isRRawEnd(input) {
  return input.next === CLOSE_BRACE && input.peek(1) === LETTER_R;
}

function isBlockCommentStart(input) {
  return input.next === SLASH && input.peek(1) === ASTERISK;
}

function consumeBlockComment(input) {
  input.advance(2);

  while (input.next >= 0) {
    if (input.next === ASTERISK && input.peek(1) === SLASH) {
      input.advance(2);
      input.acceptToken(BlockComment);
      return;
    }

    input.advance();
  }
}

export const nestedRawStringTokenizer = new ExternalTokenizer(
  (input, stack) => {
    if (stack.canShift(BlockComment) && isBlockCommentStart(input)) {
      consumeBlockComment(input);
      return;
    }

    if (!stack.canShift(rawString)) return;

    const delimiters = [];
    if (isBraceRawStart(input)) delimiters.push('brace');
    else if (isRRawStart(input)) delimiters.push('r');
    else return;

    input.advance(2);

    while (delimiters.length > 0) {
      if (input.next < 0) return;

      if (isBraceRawStart(input)) {
        delimiters.push('brace');
        input.advance(2);
        continue;
      }

      if (isRRawStart(input)) {
        delimiters.push('r');
        input.advance(2);
        continue;
      }

      const current = delimiters[delimiters.length - 1];
      if (current === 'brace' && isBraceRawEnd(input)) {
        delimiters.pop();
        input.advance(2);
        if (delimiters.length === 0) {
          input.acceptToken(rawString);
          return;
        }
        continue;
      }

      if (current === 'r' && isRRawEnd(input)) {
        delimiters.pop();
        input.advance(2);
        if (delimiters.length === 0) {
          input.acceptToken(rawString);
          return;
        }
        continue;
      }

      input.advance();
    }
  },
);
