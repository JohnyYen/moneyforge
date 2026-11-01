import { err, ok, type Result } from '@/shared/result';

import { foldCase, looksLikeOneTimeCode, normalizeBody } from './message';
import type { NumberFormat } from './number-format';
import { ruleError, type RuleError } from './rule-error';

export const MAX_TEMPLATE_LENGTH = 500;
const MIN_LITERAL_CHARACTERS = 3;
/** The longest value a field can read: anything longer is not what the rule expects. */
export const MAX_FIELD_LENGTH = 64;

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

const literalsOf = (tokens: readonly Token[]) =>
  tokens.flatMap((token) => (token.type === 'literal' ? [token.text] : []));

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
  const literals = literalsOf(tokens);
  if (literals.join('').replace(/ /g, '').length < MIN_LITERAL_CHARACTERS) {
    return invalid('Add some fixed text from the message, so the rule cannot match everything.');
  }
  if (looksLikeOneTimeCode(literals.join(' '))) {
    return invalid('This reads like a one-time code, and those are never kept.');
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

/** The fixed text of a template, even one that does not compile yet. */
export function templateLiterals(text: string): string[] {
  const tokens = tokenize(normalizeBody(text));
  return tokens.ok ? literalsOf(tokens.value) : [];
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

function fractionEnd(text: string, end: number, { decimal }: NumberFormat): number {
  if (text[end] !== decimal || !isDigit(text[end + 1])) return end;
  let index = end + 1;
  while (isDigit(text[index])) index += 1;
  return index;
}

const isSpacedGroup = (text: string, at: number) =>
  text[at] === ' ' &&
  isDigit(text[at + 1]) &&
  isDigit(text[at + 2]) &&
  isDigit(text[at + 3]) &&
  !isDigit(text[at + 4]);

/**
 * Every place a number with space thousands may end, shortest first. A space also separates
 * words, so `500 300 days` could be one number or two, and only the template can tell.
 */
function spacedNumberEnds(text: string, start: number, format: NumberFormat): number[] {
  let end = start;
  while (isDigit(text[end])) end += 1;
  if (end === start) return [];
  const ends = [fractionEnd(text, end, format)];
  if (end - start > 3) return ends;
  while (
    ends[ends.length - 1] === end &&
    end - start <= MAX_FIELD_LENGTH &&
    isSpacedGroup(text, end)
  ) {
    end += 4;
    ends.push(fractionEnd(text, end, format));
  }
  return ends;
}

function numberEnds(text: string, start: number, format: NumberFormat): number[] {
  if (format.thousands === ' ') return spacedNumberEnds(text, start, format);
  const end = scanNumber(text, start, format);
  return end === start ? [] : [end];
}

/** A separator of another format followed by a digit means only part of the number was read. */
const runsIntoNumber = (text: string, end: number) =>
  (text[end] === '.' || text[end] === ',' || text[end] === "'") && isDigit(text[end + 1]);

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
 * Walks the template from left to right and never revisits a character, except that a number
 * with space thousands tries each reading the text allows. Those readings are capped by the
 * field length, and a free field ends at the first occurrence of the text after it, or at the
 * closing text when that is the last thing in the template. Search work is bounded by the
 * template and message caps.
 */
export function matchTemplate(
  { tokens }: CompiledTemplate,
  text: string,
  format: NumberFormat,
): Match {
  const folded = foldCase(text);

  const walk = (start: number, from: number, found: TemplateMatch): Match => {
    const fields: Partial<Record<TemplateField, string>> = { ...found };
    let position = from;

    const closingLiteralStart = (literal: string) => {
      const literalStart = folded.length - literal.length;
      return literalStart >= position && folded.endsWith(literal) ? literalStart : -1;
    };

    for (let index = start; index < tokens.length; index += 1) {
      const token = tokens[index];
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
        const ends = numberEnds(text, position + signed, format);
        if (ends.length === 0) {
          return noMatch(`Expected ${field === 'amount' ? 'an amount' : 'a balance'} at position ${position}.`);
        }
        const readings = ends.map((end): Match => {
          if (runsIntoNumber(text, end)) {
            return noMatch(`The number at position ${position} goes on in another format.`);
          }
          if (field === 'balance' && end - position > MAX_FIELD_LENGTH) {
            return noMatch(`The balance is over ${MAX_FIELD_LENGTH} characters.`);
          }
          return walk(index + 1, end, { ...fields, [field]: text.slice(position, end) });
        });
        const fitting = readings.filter(({ ok }) => ok);
        if (fitting.length > 1) {
          return noMatch(`The number at position ${position} is ambiguous.`);
        }
        return fitting[0] ?? readings[0];
      }

      if (field === 'currency') {
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
          if (cleaned.length > MAX_FIELD_LENGTH) {
            return noMatch(`The ${field} is over ${MAX_FIELD_LENGTH} characters.`);
          }
          fields[field] = cleaned;
        }
        position = end;
      }
    }

    if (position !== text.length) return noMatch(`Unexpected text after position ${position}.`);
    return { ok: true, value: fields };
  };

  return walk(0, 0, {});
}

/** A starting point for a rule: the message itself, safe to compile as plain text. */
export function templateFromMessage(body: string): string {
  return body.replace(/[{}]/g, (brace) => brace + brace);
}
