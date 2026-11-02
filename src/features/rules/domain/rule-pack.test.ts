import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAX_PACK_CHARS,
  MAX_PACK_RULES,
  MAX_PACK_SOURCES,
  packSlots,
  parseRulePack,
  type RulePack,
} from './rule-pack';

const rule = (change: object = {}) => ({
  name: 'Purchase',
  priority: 0,
  template: 'Purchase of {amount} at {counterparty}.',
  format: { decimal: '.', thousands: ',' },
  kind: 'expense',
  account: 'Card',
  category: 'Shopping',
  ...change,
});

const source = (change: object = {}) => ({
  name: 'Example bank',
  channel: 'sms',
  sender: 'EXAMPLE',
  rules: [rule()],
  ...change,
});

const pack = (change: object = {}) => ({
  format: 'moneyforge-rule-pack',
  version: 1,
  name: 'Example',
  sources: [source()],
  ...change,
});

const parse = (value: unknown) => parseRulePack(JSON.stringify(value));
const refused = { ok: false, error: { code: 'invalid-pack' } };

describe('parseRulePack', () => {
  it('reads a valid pack', () => {
    const parsed = parse(pack({ description: 'Generic.' }));
    expect(parsed).toMatchObject({
      ok: true,
      value: { name: 'Example', sources: [{ sender: 'example', rules: [{ account: 'Card' }] }] },
    });
  });

  it('accepts the example pack in the repository', () => {
    const text = readFileSync(join(process.cwd(), 'rule-packs/example-bank.json'), 'utf8');
    expect(parseRulePack(text)).toMatchObject({ ok: true });
  });

  it.each([
    ['text that is not JSON', '{'],
    ['a list', '[]'],
    ['null', 'null'],
    ['a number', '1'],
  ])('refuses %s', (_, text) => {
    expect(parseRulePack(text)).toMatchObject(refused);
  });

  it('refuses text over the size cap before parsing it', () => {
    expect(parseRulePack(' '.repeat(MAX_PACK_CHARS + 1))).toMatchObject(refused);
  });

  it.each([
    ['another format', pack({ format: 'other' })],
    ['a later version', pack({ version: 2 })],
    ['a version as text', pack({ version: '1' })],
    ['no name', pack({ name: '' })],
    ['a long name', pack({ name: 'n'.repeat(65) })],
    ['a control character in a name', pack({ name: 'a\nb' })],
    ['a direction override in a name', pack({ name: `a${String.fromCharCode(0x202e)}b` })],
    ['no sources', pack({ sources: [] })],
    ['sources that are not a list', pack({ sources: {} })],
    ['too many sources', pack({
      sources: Array.from({ length: MAX_PACK_SOURCES + 1 }, (_, index) =>
        source({ sender: `S${index}` })),
    })],
    ['too many rules', pack({
      sources: [source({
        rules: Array.from({ length: MAX_PACK_RULES + 1 }, (_, index) =>
          rule({ template: `Paid ${index} {amount}` })),
      })],
    })],
  ])('refuses %s', (_, value) => {
    expect(parse(value)).toMatchObject(refused);
  });

  it.each([
    ['autoPost on a rule', pack({ sources: [source({ rules: [rule({ autoPost: true })] })] })],
    ['splitMode on a rule', pack({ sources: [source({ rules: [rule({ splitMode: 'auto' })] })] })],
    ['samples', pack({ sources: [source({ rules: [rule({ samples: ['x'] })] })] })],
    ['an account id', pack({ sources: [source({ rules: [rule({ accountId: 'a' })] })] })],
    ['inbox items', pack({ items: [] })],
    ['accounts', pack({ accounts: [] })],
    ['categories', pack({ categories: [] })],
    ['a field on a source', pack({ sources: [source({ enabled: true })] })],
    ['a field on a format', pack({
      sources: [source({ rules: [rule({ format: { decimal: '.', thousands: ',', x: 1 } })] })],
    })],
  ])('refuses the unknown field in %s', (_, value) => {
    expect(parse(value)).toMatchObject(refused);
  });

  it('refuses a __proto__ key instead of merging it', () => {
    const text = JSON.stringify(pack()).replace('{', '{"__proto__":{"autoPost":true},');
    expect(parseRulePack(text)).toMatchObject(refused);
    expect(({} as Record<string, unknown>).autoPost).toBeUndefined();
  });

  const withRule = (change: object) => pack({ sources: [source({ rules: [rule(change)] })] });

  it.each([
    ['no amount', withRule({ template: 'Purchase at {counterparty}.' })],
    ['too little fixed text', withRule({ template: '{amount}' })],
    ['an unknown placeholder', withRule({ template: 'Paid {amount} {constructor}' })],
    ['a one-time code template', withRule({ template: 'Your OTP is {amount} for login' })],
    ['a template over the cap', withRule({ template: `Paid {amount} ${'x'.repeat(500)}` })],
    ['a priority as text', withRule({ priority: '1' })],
    ['a fractional priority', withRule({ priority: 1.5 })],
    ['a priority out of range', withRule({ priority: 1_000_001 })],
    ['an unknown kind', withRule({ kind: 'steal' })],
    ['one separator twice', withRule({ format: { decimal: '.', thousands: '.' } })],
    ['a format that is not text', withRule({ format: { decimal: 1, thousands: 2 } })],
    ['a transfer with no counterpart', withRule({ kind: 'transfer_out', category: null })],
    ['a transfer to itself', withRule({
      kind: 'transfer_out', category: null, counterpart: 'Card',
    })],
    ['a transfer with a category', withRule({ kind: 'transfer_in', counterpart: 'Other' })],
    ['a counterpart on an expense', withRule({ counterpart: 'Other' })],
    ['an account that is not a slot name', withRule({ account: 7 })],
    ['a channel it does not know', pack({ sources: [source({ channel: 'email' })] })],
    ['an empty sender', pack({ sources: [source({ sender: ' - ' })] })],
    ['the same sender twice', pack({
      sources: [source({ sender: 'A-B' }), source({ sender: 'ab' })],
    })],
    ['the same rule twice', pack({ sources: [source({ rules: [rule(), rule()] })] })],
    ['a category slot of both kinds', pack({
      sources: [source({ rules: [rule(), rule({
        kind: 'income', template: 'Received {amount} now',
      })] })],
    })],
  ])('refuses %s', (_, value) => {
    expect(parse(value)).toMatchObject(refused);
  });
});

describe('packSlots', () => {
  it('lists each slot once, with what a category slot must be', () => {
    const parsed = parse(
      pack({
        sources: [
          source({
            rules: [
              rule(),
              rule({
                kind: 'transfer_out',
                template: 'Sent {amount} away',
                category: null,
                counterpart: 'Savings',
              }),
            ],
          }),
        ],
      }),
    );
    expect(parsed.ok && packSlots(parsed.value as RulePack)).toEqual({
      accounts: ['Card', 'Savings'],
      categories: [{ name: 'Shopping', kind: 'expense' }],
    });
  });
});
