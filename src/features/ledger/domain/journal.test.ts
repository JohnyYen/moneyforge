import {
  createAdjustment,
  createConversion,
  createExpense,
  createIncome,
  createTransaction,
  createTransfer,
  isBalanced,
  type Transaction,
} from './journal';
import { systemAccountId } from './account';
import type { Result } from '@/shared/result';
import type { LedgerError } from './ledger-error';

const base = { id: 't1', occurredAt: '2026-01-15T10:00:00.000Z', description: 'Entry' };
const usdA = { id: 'usd-a', currencyCode: 'USD' };
const usdB = { id: 'usd-b', currencyCode: 'USD' };
const cop = { id: 'cop', currencyCode: 'COP' };

function unwrap(result: Result<Transaction, LedgerError>) {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function sumByCurrency(transaction: Transaction) {
  const totals = new Map<string, bigint>();
  for (const posting of transaction.postings) {
    totals.set(posting.currency, (totals.get(posting.currency) ?? 0n) + posting.amount);
  }
  return Object.fromEntries(totals);
}

function amountOf(transaction: Transaction, accountId: string) {
  return transaction.postings.find((posting) => posting.accountId === accountId)?.amount;
}

describe('createTransaction', () => {
  const posting = (accountId: string, amount: bigint, currency = 'USD') => ({
    accountId,
    amount,
    currency,
  });

  it('accepts postings that sum to zero', () => {
    const result = createTransaction({
      ...base,
      kind: 'adjustment',
      postings: [posting('a', 5n), posting('b', -5n)],
    });

    expect(result.ok).toBe(true);
  });

  it('rejects an unbalanced entry', () => {
    const result = createTransaction({
      ...base,
      kind: 'adjustment',
      postings: [posting('a', 5n), posting('b', -4n)],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'unbalanced' } });
  });

  it('rejects an entry balanced in total but not per currency', () => {
    const result = createTransaction({
      ...base,
      kind: 'conversion',
      postings: [posting('a', 5n, 'USD'), posting('b', -5n, 'COP')],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'unbalanced' } });
    expect(
      isBalanced([posting('a', 5n, 'USD'), posting('b', -5n, 'COP')]),
    ).toBe(false);
  });

  it('rejects fewer than two postings and zero postings', () => {
    expect(createTransaction({ ...base, kind: 'adjustment', postings: [] })).toMatchObject({
      ok: false,
      error: { code: 'too-few-postings' },
    });
    expect(
      createTransaction({
        ...base,
        kind: 'adjustment',
        postings: [posting('a', 0n), posting('b', 0n)],
      }),
    ).toMatchObject({ ok: false, error: { code: 'zero-posting' } });
  });

  it('rejects an invalid date', () => {
    const result = createTransaction({
      ...base,
      occurredAt: 'yesterday',
      kind: 'adjustment',
      postings: [posting('a', 5n), posting('b', -5n)],
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-date' } });
  });
});

describe('income and expense', () => {
  it('credits the account against the system income account', () => {
    const transaction = unwrap(createIncome({ ...base, account: usdA, amount: 1000n }));

    expect(transaction.kind).toBe('income');
    expect(amountOf(transaction, 'usd-a')).toBe(1000n);
    expect(amountOf(transaction, systemAccountId('USD', 'income'))).toBe(-1000n);
  });

  it('debits the account against the system expense account', () => {
    const transaction = unwrap(
      createExpense({ ...base, account: usdA, amount: 250n, categoryId: 'food' }),
    );

    expect(transaction.categoryId).toBe('food');
    expect(amountOf(transaction, 'usd-a')).toBe(-250n);
    expect(amountOf(transaction, systemAccountId('USD', 'expense'))).toBe(250n);
  });

  it.each([0n, -1n])('rejects a non-positive amount of %p', (amount) => {
    expect(createIncome({ ...base, account: usdA, amount })).toMatchObject({
      ok: false,
      error: { code: 'non-positive-amount' },
    });
    expect(createExpense({ ...base, account: usdA, amount })).toMatchObject({
      ok: false,
      error: { code: 'non-positive-amount' },
    });
  });
});

describe('transfer', () => {
  it('balances without a fee', () => {
    const transaction = unwrap(createTransfer({ ...base, from: usdA, to: usdB, amount: 500n }));

    expect(transaction.postings).toHaveLength(2);
    expect(sumByCurrency(transaction)).toEqual({ USD: 0n });
    expect(amountOf(transaction, 'usd-a')).toBe(-500n);
    expect(amountOf(transaction, 'usd-b')).toBe(500n);
  });

  it('charges the fee to the source and balances against expense', () => {
    const transaction = unwrap(
      createTransfer({ ...base, from: usdA, to: usdB, amount: 500n, fee: 7n }),
    );

    expect(sumByCurrency(transaction)).toEqual({ USD: 0n });
    expect(amountOf(transaction, 'usd-a')).toBe(-507n);
    expect(amountOf(transaction, 'usd-b')).toBe(500n);
    expect(amountOf(transaction, systemAccountId('USD', 'expense'))).toBe(7n);
  });

  it('rejects the same account, mixed currencies, and a negative fee', () => {
    expect(createTransfer({ ...base, from: usdA, to: usdA, amount: 1n })).toMatchObject({
      ok: false,
      error: { code: 'same-account' },
    });
    expect(createTransfer({ ...base, from: usdA, to: cop, amount: 1n })).toMatchObject({
      ok: false,
      error: { code: 'currency-mismatch' },
    });
    expect(createTransfer({ ...base, from: usdA, to: usdB, amount: 1n, fee: -1n })).toMatchObject({
      ok: false,
      error: { code: 'non-positive-amount' },
    });
  });
});

describe('conversion', () => {
  const conversion = {
    ...base,
    from: usdA,
    to: cop,
    sourceAmount: 10000n,
    targetAmount: 40127500n,
    rate: '4012.75',
  };

  it('balances each currency through the clearing accounts', () => {
    const transaction = unwrap(createConversion(conversion));

    expect(sumByCurrency(transaction)).toEqual({ USD: 0n, COP: 0n });
    expect(amountOf(transaction, 'usd-a')).toBe(-10000n);
    expect(amountOf(transaction, systemAccountId('USD', 'conversion'))).toBe(10000n);
    expect(amountOf(transaction, systemAccountId('COP', 'conversion'))).toBe(-40127500n);
    expect(amountOf(transaction, 'cop')).toBe(40127500n);
  });

  it('keeps the rate as the exact decimal string', () => {
    const transaction = unwrap(createConversion({ ...conversion, rate: '4012.7500' }));

    expect(transaction.metadata).toEqual({ rate: '4012.7500', rateFrom: 'USD', rateTo: 'COP' });
  });

  it('charges a fee in the source currency on top of the amount', () => {
    const transaction = unwrap(
      createConversion({ ...conversion, fee: { minor: 100n, currency: 'USD' } }),
    );

    expect(sumByCurrency(transaction)).toEqual({ USD: 0n, COP: 0n });
    expect(amountOf(transaction, 'usd-a')).toBe(-10100n);
    expect(amountOf(transaction, systemAccountId('USD', 'expense'))).toBe(100n);
    expect(amountOf(transaction, systemAccountId('USD', 'conversion'))).toBe(10000n);
  });

  it('deducts a fee in the target currency from the received amount', () => {
    const transaction = unwrap(
      createConversion({ ...conversion, fee: { minor: 500n, currency: 'COP' } }),
    );

    expect(sumByCurrency(transaction)).toEqual({ USD: 0n, COP: 0n });
    expect(amountOf(transaction, 'cop')).toBe(40127000n);
    expect(amountOf(transaction, systemAccountId('COP', 'expense'))).toBe(500n);
  });

  it('rejects a fee in a third currency or larger than what is received', () => {
    expect(
      createConversion({ ...conversion, fee: { minor: 1n, currency: 'EUR' } }),
    ).toMatchObject({ ok: false, error: { code: 'currency-mismatch' } });
    expect(
      createConversion({ ...conversion, fee: { minor: 40127500n, currency: 'COP' } }),
    ).toMatchObject({ ok: false, error: { code: 'non-positive-amount' } });
  });

  it('rejects same-currency conversions and invalid rates', () => {
    expect(createConversion({ ...conversion, to: usdB })).toMatchObject({
      ok: false,
      error: { code: 'currency-mismatch' },
    });
    expect(createConversion({ ...conversion, rate: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-rate' },
    });
  });
});

describe('adjustment', () => {
  it('posts a positive difference against equity', () => {
    const transaction = unwrap(createAdjustment({ ...base, account: usdA, difference: 300n }));

    expect(transaction.kind).toBe('adjustment');
    expect(sumByCurrency(transaction)).toEqual({ USD: 0n });
    expect(amountOf(transaction, 'usd-a')).toBe(300n);
    expect(amountOf(transaction, systemAccountId('USD', 'equity'))).toBe(-300n);
  });

  it('posts a negative difference against equity', () => {
    const transaction = unwrap(createAdjustment({ ...base, account: usdA, difference: -300n }));

    expect(sumByCurrency(transaction)).toEqual({ USD: 0n });
    expect(amountOf(transaction, 'usd-a')).toBe(-300n);
  });

  it('rejects a zero difference', () => {
    expect(createAdjustment({ ...base, account: usdA, difference: 0n })).toMatchObject({
      ok: false,
      error: { code: 'zero-posting' },
    });
  });
});
