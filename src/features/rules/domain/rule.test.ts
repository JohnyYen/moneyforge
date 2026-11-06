import type { Account } from '@/features/ledger/domain/account';
import type { Currency } from '@/features/ledger/domain/currency';

import { evaluateRule, rankRules, selectRule, type Rule } from './rule';

const currency = (code: string, decimals = 2): Currency => ({
  code,
  name: code,
  decimals,
  symbol: code,
  kind: 'fiat',
});

const account = (id: string, currencyCode: string): Account => ({
  id,
  name: id,
  type: 'Bank',
  currencyCode,
  openingBalance: 0n,
  archived: false,
  systemRole: null,
  groupId: null,
});

const lookups = {
  accounts: [account('usd', 'USD'), account('eur', 'EUR'), account('cop', 'COP')],
  currencies: [currency('USD'), currency('EUR'), currency('COP', 0), currency('DAI', 18)],
};

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  sourceId: 's1',
  name: 'Income',
  priority: 0,
  template: 'Got {amount} {currency} ref {reference}',
  format: { decimal: '.', thousands: ',' },
  kind: 'income',
  accountId: 'usd',
  categoryId: null,
  counterpartAccountId: null,
  currencyCode: null,
  autoPost: false,
  splitMode: 'none',
  splitStructureId: null,
  samples: [],
  ...over,
});

describe('evaluateRule', () => {
  it('turns the text into an exact amount in minor units', () => {
    expect(evaluateRule(rule(), 'Got 1,500.25 USD ref A1', lookups)).toEqual({
      status: 'matched',
      fields: {
        amountMinor: 150025n,
        currencyCode: 'USD',
        reference: 'A1',
        counterparty: null,
        balance: null,
      },
    });
  });

  it('reads both number formats into the same money', () => {
    const comma = rule({ format: { decimal: ',', thousands: '.' } });
    expect(evaluateRule(comma, 'Got 1.500,25 USD ref A1', lookups)).toMatchObject({
      fields: { amountMinor: 150025n },
    });
  });

  it('keeps 18 decimals exact', () => {
    const dai = rule({ accountId: 'dai', template: 'Got {amount} DAI' });
    const withDai = {
      ...lookups,
      accounts: [...lookups.accounts, account('dai', 'DAI')],
    };
    expect(evaluateRule(dai, 'Got 0.123456789012345678 DAI', withDai)).toMatchObject({
      fields: { amountMinor: 123456789012345678n },
    });
  });

  it('falls back to the rule currency, then the account currency', () => {
    const plain = { template: 'Got {amount} today' };
    expect(evaluateRule(rule(plain), 'Got 5 today', lookups)).toMatchObject({
      fields: { currencyCode: 'USD' },
    });
    expect(
      evaluateRule(rule({ ...plain, currencyCode: 'USD' }), 'Got 5 today', lookups),
    ).toMatchObject({ fields: { currencyCode: 'USD' } });
  });

  it.each([
    ['an amount in the wrong format', 'Got 1.500,25 USD ref A1', 'amount'],
    ['more decimals than the currency allows', 'Got 1.555 USD ref A1', 'amount'],
    ['a zero amount', 'Got 0.00 USD ref A1', 'amount'],
    ['an unknown currency', 'Got 5 XXX ref A1', 'XXX'],
    ['a currency other than the account', 'Got 5 EUR ref A1', 'EUR'],
  ])('fails, and never guesses, on %s', (_label, message, mention) => {
    const result = evaluateRule(rule(), message, lookups);
    expect(result.status).toBe('failed');
    expect(result).toMatchObject({ reason: expect.stringContaining(mention) });
  });

  it('reports a shape that does not fit as no match, with the reason', () => {
    expect(evaluateRule(rule(), 'Hello there', lookups)).toEqual({
      status: 'no-match',
      reason: 'Expected "Got " at the start.',
    });
  });

  it('reports a broken stored template as no match', () => {
    expect(evaluateRule(rule({ template: 'broken {' }), 'broken {', lookups).status).toBe('no-match');
  });
});

describe('rankRules', () => {
  it('puts higher priority first and breaks ties by id', () => {
    const ranked = rankRules([
      rule({ id: 'b', priority: 1 }),
      rule({ id: 'c', priority: 5 }),
      rule({ id: 'a', priority: 1 }),
    ]);
    expect(ranked.map(({ id }) => id)).toEqual(['c', 'a', 'b']);
  });
});

describe('selectRule', () => {
  const low = rule({ id: 'low', priority: 1, template: 'Got {amount} {*}' });
  const high = rule({ id: 'high', priority: 9, template: 'Got {amount} USD' });

  it('picks the highest priority among several matches', () => {
    expect(selectRule([low, high], 'Got 5 USD', lookups)?.rule.id).toBe('high');
  });

  it('is the same whatever order the rules arrive in', () => {
    const first = rule({ id: 'a', template: 'Got {amount} {*}' });
    const second = rule({ id: 'b', template: 'Got {amount} USD' });
    expect(selectRule([first, second], 'Got 5 USD', lookups)?.rule.id).toBe('a');
    expect(selectRule([second, first], 'Got 5 USD', lookups)?.rule.id).toBe('a');
  });

  it('skips rules that do not fit', () => {
    expect(selectRule([low, high], 'Got 5 EUR', lookups)).toMatchObject({
      rule: { id: 'low' },
      evaluation: { status: 'matched' },
    });
  });

  const strict = rule({
    id: 'strict',
    priority: 9,
    template: 'Got {amount} USD',
    format: { decimal: ',', thousands: '.' },
  });

  it('keeps trying after a fitting rule fails, so a failure hides no working rule', () => {
    expect(selectRule([strict, low], 'Got 1,500.25 USD', lookups)).toMatchObject({
      rule: { id: 'low' },
      evaluation: { status: 'matched' },
    });
  });

  it('reports the first failure when no rule works', () => {
    const lower = rule({ ...strict, id: 'lower', priority: 1 });
    expect(selectRule([lower, strict], 'Got 1,500.25 USD', lookups)).toMatchObject({
      rule: { id: 'strict' },
      evaluation: { status: 'failed' },
    });
  });

  it('returns null with no match', () => {
    expect(selectRule([low, high], 'Nothing here', lookups)).toBeNull();
  });
});

describe('amount length', () => {
  const lookups = {
    accounts: [{ id: 'a', currencyCode: 'USD' }],
    currencies: [{ code: 'USD', decimals: 2 }],
  };
  const capped: Rule = {
    id: 'r',
    sourceId: 's',
    name: 'Rule',
    priority: 0,
    template: 'Paid {amount} ok',
    format: { decimal: '.', thousands: '' },
    kind: 'expense',
    accountId: 'a',
    categoryId: null,
    counterpartAccountId: null,
    currencyCode: null,
    autoPost: false,
    splitMode: 'none',
    splitStructureId: null,
    samples: [],
  };

  it('refuses an amount over the cap, without repeating it', () => {
    const amount = '1'.repeat(65);
    const evaluation = evaluateRule(capped, `Paid ${amount} ok`, lookups);
    expect(evaluation.status).toBe('failed');
    expect(JSON.stringify(evaluation)).not.toContain(amount);
  });

  it('reads an amount at the cap', () => {
    expect(evaluateRule(capped, `Paid ${'1'.repeat(64)} ok`, lookups).status).toBe('matched');
  });
});
