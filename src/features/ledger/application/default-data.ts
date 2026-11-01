import type { CategoryKind } from '../domain/category';
import type { Currency } from '../domain/currency';

export const DEFAULT_CURRENCIES: readonly Currency[] = [
  { code: 'USD', name: 'US Dollar', decimals: 2, symbol: '$', kind: 'fiat' },
  { code: 'EUR', name: 'Euro', decimals: 2, symbol: '€', kind: 'fiat' },
  { code: 'GBP', name: 'Pound Sterling', decimals: 2, symbol: '£', kind: 'fiat' },
  { code: 'MXN', name: 'Mexican Peso', decimals: 2, symbol: 'MX$', kind: 'fiat' },
  { code: 'COP', name: 'Colombian Peso', decimals: 2, symbol: 'COL$', kind: 'fiat' },
  { code: 'ARS', name: 'Argentine Peso', decimals: 2, symbol: 'AR$', kind: 'fiat' },
  { code: 'BRL', name: 'Brazilian Real', decimals: 2, symbol: 'R$', kind: 'fiat' },
  { code: 'USDT', name: 'Tether USD', decimals: 6, symbol: 'USDT', kind: 'stablecoin' },
  { code: 'USDC', name: 'USD Coin', decimals: 6, symbol: 'USDC', kind: 'stablecoin' },
  { code: 'DAI', name: 'Dai', decimals: 18, symbol: 'DAI', kind: 'stablecoin' },
];

export const DEFAULT_CATEGORIES: readonly { name: string; kind: CategoryKind }[] = [
  { name: 'Salary', kind: 'income' },
  { name: 'Freelance', kind: 'income' },
  { name: 'Other income', kind: 'income' },
  { name: 'Food', kind: 'expense' },
  { name: 'Housing', kind: 'expense' },
  { name: 'Transport', kind: 'expense' },
  { name: 'Utilities', kind: 'expense' },
  { name: 'Health', kind: 'expense' },
  { name: 'Entertainment', kind: 'expense' },
  { name: 'Fees', kind: 'expense' },
  { name: 'Other expense', kind: 'expense' },
];
