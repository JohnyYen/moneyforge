import type { NumberFormat } from './number-format';
import {
  compileTemplate,
  matchTemplate,
  templateFromMessage,
  type CompiledTemplate,
} from './template';

const DOT_DECIMAL = { decimal: '.', thousands: ',' } as const;
const COMMA_DECIMAL = { decimal: ',', thousands: '.' } as const;

function compiled(text: string): CompiledTemplate {
  const result = compileTemplate(text);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const match = (template: string, message: string, format: NumberFormat = DOT_DECIMAL) =>
  matchTemplate(compiled(template), message, format);

describe('compileTemplate', () => {
  it.each([
    ['no amount', 'You received money'],
    ['two amounts', 'Got {amount} and {amount} today'],
    ['a repeated field', 'Ref {reference} and {reference} amount {amount}'],
    ['an unknown placeholder', 'Paid {amount} to {payee}'],
    ['an object property as a placeholder', 'Paid {amount} to {constructor}'],
    ['an unclosed brace', 'Paid {amount'],
    ['a stray closing brace', 'Paid } {amount}'],
    ['free text next to a field', 'Paid to {counterparty}{amount}'],
    ['a wildcard next to a field', 'Paid {*}{amount}'],
    ['almost no literal text', '{*} {amount} {*}'],
    ['too long', `Paid {amount} ${'x'.repeat(600)}`],
  ])('rejects %s', (_label, text) => {
    expect(compileTemplate(text)).toMatchObject({ ok: false, error: { code: 'invalid-template' } });
  });

  it('accepts typed fields written next to each other', () => {
    expect(compileTemplate('Paid {currency}{amount} today').ok).toBe(true);
    expect(compileTemplate('Paid {amount}{currency} today').ok).toBe(true);
  });

  it('treats doubled braces as literal braces', () => {
    expect(match('Paid {{ok}} {amount}', 'Paid {ok} 10')).toMatchObject({
      ok: true,
      value: { amount: '10' },
    });
  });
});

describe('matchTemplate', () => {
  const template = 'You received {amount} {currency} from {counterparty}. Ref {reference}';

  it('extracts every field', () => {
    expect(match(template, 'You received 1,500.25 usd from Acme Inc. Ref AB-77.')).toEqual({
      ok: true,
      value: {
        amount: '1,500.25',
        currency: 'USD',
        counterparty: 'Acme Inc',
        reference: 'AB-77',
      },
    });
  });

  it('is case insensitive on literals and keeps the original field text', () => {
    expect(match('PAID {amount} AT {counterparty}', 'paid 10 at Café Ñandú')).toMatchObject({
      value: { counterparty: 'Café Ñandú' },
    });
  });

  it('stays aligned when lowercasing would change the length of the text', () => {
    expect(match('Paid {amount} to {counterparty} ok', 'Paid 10 to İİİ Corp ok')).toMatchObject({
      value: { amount: '10', counterparty: 'İİİ Corp' },
    });
  });

  it('is anchored at both ends', () => {
    expect(match('Paid {amount} today', 'Paid 10 today, thanks').ok).toBe(false);
    expect(match('Paid {amount} today', 'Note: Paid 10 today').ok).toBe(false);
  });

  it('takes the first occurrence of a middle literal and the last of a closing one', () => {
    expect(match('At {counterparty}. Paid {amount} by {*}.', 'At A.B. Paid 5 by x.y.')).toMatchObject({
      value: { counterparty: 'A.B', amount: '5' },
    });
  });

  it('lets a wildcard be empty but not a named field', () => {
    expect(match('Paid {amount}{*}', 'Paid 10').ok).toBe(true);
    expect(match('Paid {amount} to {counterparty}', 'Paid 10 to ').ok).toBe(false);
    expect(match('Paid {amount} ref {reference}', 'Paid 10 ref ...').ok).toBe(false);
  });

  it('reads an amount stuck to a currency code on either side', () => {
    expect(match('Paid {currency}{amount} ok', 'Paid COP150,000 ok')).toMatchObject({
      value: { currency: 'COP', amount: '150,000' },
    });
    expect(match('Paid {amount}{currency} ok', 'Paid 150,000COP ok')).toMatchObject({
      value: { currency: 'COP', amount: '150,000' },
    });
  });

  it('leaves punctuation after an amount to the literal that follows', () => {
    expect(match('Paid {amount}. Ref {reference}', 'Paid 1,500.25. Ref 9')).toMatchObject({
      value: { amount: '1,500.25', reference: '9' },
    });
  });

  it('uses the separators of the rule to find where an amount ends', () => {
    const format = { decimal: ',', thousands: ' ' } as const;
    expect(match('Paid {amount} EUR', 'Paid 1 500,25 EUR', format)).toMatchObject({
      value: { amount: '1 500,25' },
    });
    expect(match('Paid {amount}', 'Paid 1,500.25', COMMA_DECIMAL)).toMatchObject({
      value: { amount: '1,500.25' },
    });
  });

  it('accepts a negative balance', () => {
    expect(match('Paid {amount} balance {balance}', 'Paid 5 balance -1,200.50')).toMatchObject({
      value: { balance: '-1,200.50' },
    });
  });

  it('explains why a message did not match', () => {
    const missing = match('Paid {amount} at {counterparty}', 'Paid 10 in Rome');
    expect(missing).toEqual({ ok: false, error: 'Expected " at " after position 7.' });
    const noAmount = match('Paid {amount}', 'Paid nothing');
    expect(noAmount).toEqual({ ok: false, error: 'Expected an amount at position 5.' });
  });

  it('stays fast on input built to make a backtracking matcher explode', () => {
    const hostile = compiled(`${'{*}a '.repeat(30)}{amount} end`);
    const text = 'a '.repeat(1000);
    const started = Date.now();
    expect(matchTemplate(hostile, text, DOT_DECIMAL).ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(250);
  });
});

describe('templateFromMessage', () => {
  it('escapes braces so a message compiles as plain text', () => {
    const text = templateFromMessage('Ref {1} paid');
    expect(text).toBe('Ref {{1}} paid');
  });
});
