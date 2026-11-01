import { buildSystemAccounts, isSystemAccountId, validateAccountFields } from './account';
import { findsCycle, validateCategoryFields } from './category';
import { validateCurrency } from './currency';
import { isValidDate } from './exchange-rate';

describe('validateCurrency', () => {
  const input = { code: 'usdt', name: ' Tether ', decimals: 6, symbol: '₮', kind: 'stablecoin' as const };

  it('normalizes user data', () => {
    expect(validateCurrency(input)).toEqual({
      ok: true,
      value: { code: 'USDT', name: 'Tether', decimals: 6, symbol: '₮', kind: 'stablecoin' },
    });
  });

  it('falls back to the code when no symbol is given', () => {
    expect(validateCurrency({ ...input, symbol: ' ' })).toMatchObject({
      ok: true,
      value: { symbol: 'USDT' },
    });
  });

  it.each([{ decimals: 19 }, { decimals: -1 }, { decimals: 1.5 }, { code: '' }, { code: 'A B' }, { name: '' }])(
    'rejects %p',
    (override) => {
      expect(validateCurrency({ ...input, ...override }).ok).toBe(false);
    },
  );
});

describe('accounts', () => {
  it('builds one hidden system account per role', () => {
    const accounts = buildSystemAccounts('USD');

    expect(accounts.map((account) => account.systemRole)).toEqual([
      'income',
      'expense',
      'equity',
      'conversion',
    ]);
    expect(accounts.every((account) => isSystemAccountId(account.id))).toBe(true);
    expect(isSystemAccountId('some-user-account')).toBe(false);
  });

  it('requires a name and a type', () => {
    expect(validateAccountFields({ name: ' ', type: 'Bank' }).ok).toBe(false);
    expect(validateAccountFields({ name: 'Main', type: '' }).ok).toBe(false);
    expect(validateAccountFields({ name: ' Main ', type: ' Bank ' })).toEqual({
      ok: true,
      value: { name: 'Main', type: 'Bank' },
    });
  });
});

describe('categories', () => {
  const food = { id: 'food', name: 'Food', kind: 'expense' as const, parentId: null, archived: false };
  const lunch = { ...food, id: 'lunch', name: 'Lunch', parentId: 'food' };

  it('requires a name and rejects a parent of another kind', () => {
    expect(validateCategoryFields({ name: ' ', kind: 'income' }, null).ok).toBe(false);
    expect(validateCategoryFields({ name: 'Salary', kind: 'income' }, food).ok).toBe(false);
    expect(validateCategoryFields({ name: 'Snacks', kind: 'expense' }, food).ok).toBe(true);
  });

  it('detects a parent cycle', () => {
    expect(findsCycle([food, lunch], 'food', 'lunch')).toBe(true);
    expect(findsCycle([food, lunch], 'food', 'food')).toBe(true);
    expect(findsCycle([food, lunch], 'lunch', 'food')).toBe(false);
  });
});

describe('isValidDate', () => {
  it('accepts real calendar days only', () => {
    expect(isValidDate('2026-02-28')).toBe(true);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-2-3')).toBe(false);
  });
});
