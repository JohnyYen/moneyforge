import { err, ok, type Result } from '@/shared/result';

import { foldCase, normalizeBody } from './message';
import type { NumberFormat } from './number-format';
import { ruleError, type RuleError } from './rule-error';

export const MAX_TEMPLATE_LENGTH = 500;
const MIN_LITERAL_CHARACTERS = 3;

export type TemplateField = 'amount' | 'currency' | 'reference' | 'counterparty' | 'balance';
type Placeholder = TemplateField | 'any';

type Token =
  | { readonly type: 'literal'; readonly text: string; readonly folded: string }
  | { readonly type: 'field'; readonly field: Placeholder };

export type CompiledTemplate = { readonly tokens: readonly Token[] };

export type TemplateMatch = Readonly<Partial<Record<TemplateField, string>>>;

type Match = { readonly ok: true; readonly value: TemplateMatch } | {
  readonly ok: false;
  readonly error: string;
};

// A Map, so a name like {constructor} from an imported rule finds nothing.
const PLACEHOLDERS: ReadonlyMap<string, Placeholder> = new Map([
  ['amount', 'amount'],
  ['currency', 'currency'],
  ['reference', 'reference'],
  ['counterparty', 'counterparty'],
  ['balance', 'balance'],
  ['*', 'any'],
]);

/** These fields end where the characters they accept end, so they need no text after them. */
const SELF_DELIMITED: readonly Placeholder[] = ['amount', 'balance', 'currency'];

const invalid = (message: string) => err(ruleError('invalid-template', message));

function tokenize(template: string): Result<Token[], RuleError> {
  const tokens: Token[] = [];
  let literal = '';
  const flushLiteral = () => {
    if (literal) tokens.push({ type: 'literal', text: literal, folded: foldCase(literal) });
    literal = '';
  };

  let index = 0;
  while (index < template.length) {
    const character = template[index];
    if ((character === '{' || character === '}') && template[index + 1] === character) {
      literal += character;
      index += 2;
    } else if (character === '}') {
      return invalid('Write a closing brace as }}.');
    } else if (character === '{') {
      const close = template.indexOf('}', index);
      if (close < 0) return invalid('A placeholder is missing its closing brace.');
      const name = template.slice(index + 1, close);
      const field = PLACEHOLDERS.get(name);
      if (!field) return invalid(`Unknown placeholder {${name}}.`);
      flushLiteral();
      tokens.push({ type: 'field', field });
      index = close + 1;
    } else {
      literal += character;
      index += 1;
    }
  }
  flushLiteral();
  return ok(tokens);
}

function checkTokens(tokens: readonly Token[]): Result<void, RuleError> {
  const seen = new Set<Placeholder>();
  for (const [index, token] of tokens.entries()) {
    if (token.type !== 'field') continue;
    if (token.field !== 'any' && seen.has(token.field)) {
      return invalid(`Use {${token.field}} only once.`);
    }
    seen.add(token.field);
    const next = tokens[index + 1];
    if (next?.type === 'field' && !SELF_DELIMITED.includes(token.field)) {
      return invalid('Put some text after {counterparty}, {reference}, and {*}.');
    }
  }
  if (!seen.has('amount')) return invalid('A template needs {amount}.');
  const literals = tokens.flatMap((token) => (token.type === 'literal' ? [token.text] : []));
  if (literals.join('').replace(/ /g, '').length < MIN_LITERAL_CHARACTERS) {
    return invalid('Add some fixed text from the message, so the rule cannot match everything.');
  }
  return ok(undefined);
}

export function compileTemplate(text: string): Result<CompiledTemplate, RuleError> {
  if (text.length > MAX_TEMPLATE_LENGTH) {
    return invalid(`A template can have up to ${MAX_TEMPLATE_LENGTH} characters.`);
  }
  const tokens = tokenize(normalizeBody(text));
  if (!tokens.ok) return tokens;
  const checked = checkTokens(tokens.value);
  return checked.ok ? ok({ tokens: tokens.value }) : checked;
}

const isDigit = (character: string | undefined) =>
  character !== undefined && character >= '0' && character <= '9';

const isLetter = (character: string | undefined) =>
  character !== undefined &&
  ((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z'));

/** Where a number starting at `start` ends. Separators after the last digit are not part of it. */
function scanNumber(text: string, start: number, format: NumberFormat): number {
  if (!isDigit(text[start])) return start;
  let end = start;
  let lastDigit = start;
  while (end < text.length) {
    const character = text[end];
    if (isDigit(character)) lastDigit = end;
    else if (character !== format.decimal && character !== format.thousands) break;
    end += 1;
  }
  return lastDigit + 1;
}

function scanLetters(text: string, start: number): number {
  let end = start;
  while (isLetter(text[end])) end += 1;
  return end;
}

function trimEndPunctuation(text: string): string {
  let end = text.length;
  while (end > 0 && '.,;:'.includes(text[end - 1])) end -= 1;
  return text.slice(0, end);
}

const where = (position: number) => (position === 0 ? 'at the start' : `after position ${position}`);

const noMatch = (error: string): Match => ({ ok: false, error });

/**
 * Walks the template once from left to right and never revisits a character. A free field
 * ends at the first occurrence of the text after it, or at the closing text when that is the
 * last thing in the template. Search work is bounded by the template and message caps.
 */
export function matchTemplate(
  { tokens }: CompiledTemplate,
  text: string,
  format: NumberFormat,
): Match {
  const folded = foldCase(text);
  const fields: Partial<Record<TemplateField, string>> = {};
  let position = 0;

  const closingLiteralStart = (literal: string) => {
    const start = folded.length - literal.length;
    return start >= position && folded.endsWith(literal) ? start : -1;
  };

  for (const [index, token] of tokens.entries()) {
    const isLast = index === tokens.length - 1;

    if (token.type === 'literal') {
      const fits = isLast
        ? closingLiteralStart(token.folded) === position
        : folded.startsWith(token.folded, position);
      if (!fits) return noMatch(`Expected "${token.text}" ${where(position)}.`);
      position += token.text.length;
      continue;
    }

    const { field } = token;
    if (field === 'amount' || field === 'balance') {
      const signed = field === 'balance' && text[position] === '-' ? 1 : 0;
      const end = scanNumber(text, position + signed, format);
      if (end === position + signed) {
        return noMatch(`Expected ${field === 'amount' ? 'an amount' : 'a balance'} at position ${position}.`);
      }
      fields[field] = text.slice(position, end);
      position = end;
    } else if (field === 'currency') {
      const end = scanLetters(text, position);
      if (end === position) return noMatch(`Expected a currency code at position ${position}.`);
      fields.currency = text.slice(position, end).toUpperCase();
      position = end;
    } else {
      const next = tokens[index + 1];
      let end = text.length;
      if (next?.type === 'literal') {
        end =
          index + 1 === tokens.length - 1
            ? closingLiteralStart(next.folded)
            : folded.indexOf(next.folded, position);
        if (end < 0) return noMatch(`Expected "${next.text}" ${where(position)}.`);
      }
      const value = text.slice(position, end).trim();
      if (field !== 'any') {
        const cleaned = field === 'reference' ? trimEndPunctuation(value) : value;
        if (!cleaned) return noMatch(`Expected a ${field} at position ${position}.`);
        fields[field] = cleaned;
      }
      position = end;
    }
  }

  if (position !== text.length) return noMatch(`Unexpected text after position ${position}.`);
  return { ok: true, value: fields };
}

/** A starting point for a rule: the message itself, safe to compile as plain text. */
export function templateFromMessage(body: string): string {
  return body.replace(/[{}]/g, (brace) => brace + brace);
}
