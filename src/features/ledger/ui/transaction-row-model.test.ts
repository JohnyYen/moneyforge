import { systemAccountId, type Account } from '../domain/account';
import type { Category } from '../domain/category';
import type { Currency } from '../domain/currency';
import type { Transaction } from '../domain/journal';
import { toTransactionRow } from './transaction-row-model';

const usd: Currency = { code: 'USD', name: 'Dollar', decimals: 2, symbol: '$', kind: 'fiat' };
const eur: Currency = { code: 'EUR', name: 'Euro', decimals: 2, symbol: '€', kind: 'fiat' };
const account = (id: string, name: string, currencyCode: string): Account => ({
  id,
  name,
  type: 'Bank',
  currencyCode,
  openingBalance: 0n,
  archived: false,
  systemRole: null,
});
const food: Category = { id: 'food', name: 'Food', kind: 'expense', parentId: null, archived: false };
const lookups = {
  accounts: [account('main', 'Main', 'USD'), account('euros', 'Euros', 'EUR')],
  categories: [food],
  currencies: [usd, eur],
};
const base = {
  id: 't1',
  occurredAt: new Date(2026, 2, 1, 12).toISOString(),
  metadata: null,
};

const expense: Transaction = {
  ...base,
  kind: 'expense',
  description: '',
  categoryId: 'food',
  postings: [
    { accountId: 'main', amount: -1250n, currency: 'USD' },
    { accountId: systemAccountId('USD', 'expense'), amount: 1250n, currency: 'USD' },
  ],
};

const conversion: Transaction = {
  ...base,
  kind: 'conversion',
  description: 'To euros',
  categoryId: null,
  postings: [
    { accountId: 'main', amount: -1000n, currency: 'USD' },
    { accountId: systemAccountId('USD', 'conversion'), amount: 1000n, currency: 'USD' },
    { accountId: systemAccountId('EUR', 'conversion'), amount: -920n, currency: 'EUR' },
    { accountId: 'euros', amount: 920n, currency: 'EUR' },
  ],
};

describe('toTransactionRow', () => {
  it('falls back to the category name and hides system accounts', () => {
    expect(toTransactionRow(expense, lookups)).toEqual({
      id: 't1',
      title: 'Food',
      subtitle: 'Expense · Main · 2026-03-01',
      amount: '-$12.50',
      direction: 'out',
    });
  });

  it('shows both sides of a conversion', () => {
    expect(toTransactionRow(conversion, lookups)).toMatchObject({
      title: 'To euros',
      subtitle: 'Conversion · Main → Euros · 2026-03-01',
      amount: '-$10.00 → €9.20',
      direction: 'neutral',
    });
  });

  it('shows only the focused account side', () => {
    expect(toTransactionRow(conversion, lookups, 'euros')).toMatchObject({
      amount: '€9.20',
      direction: 'in',
    });
  });
});
