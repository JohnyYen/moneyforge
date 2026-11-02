import type { Account } from '@/features/ledger/domain/account';
import type { Category } from '@/features/ledger/domain/category';
import type { Currency } from '@/features/ledger/domain/currency';
import type { Transaction } from '@/features/ledger/domain/journal';
import { formatDecimal } from '@/features/ledger/domain/money';

import { neutralizeFormula } from './csv';

export const CSV_HEADER = [
  'date',
  'kind',
  'description',
  'category',
  'account',
  'currency',
  'amount',
] as const;

export type ExportLookups = {
  readonly accounts: readonly Account[];
  readonly categories: readonly Category[];
  readonly currencies: readonly Currency[];
  readonly dayOf: (occurredAt: string) => string;
};

/**
 * One row per posting on a person's account, so each account's rows add up to its movement and a
 * transfer reads as both sides. System accounts stay hidden, as everywhere else. Amounts are
 * written from minor units with a point and never pass through a number. They are the only cells
 * that may start with a minus, and they hold digits alone, so they need no neutralizing.
 */
export function exportRows(
  transactions: readonly Transaction[],
  onlyAccountId: string | null,
  { accounts, categories, currencies, dayOf }: ExportLookups,
): string[][] {
  return transactions.flatMap((transaction) => {
    const category = categories.find(({ id }) => id === transaction.categoryId)?.name ?? '';
    return transaction.postings.flatMap(({ accountId, amount, currency: code }) => {
      const account = accounts.find(({ id }) => id === accountId);
      const currency = currencies.find((item) => item.code === code);
      if (!account || !currency) return [];
      if (onlyAccountId !== null && accountId !== onlyAccountId) return [];
      return [
        [
          dayOf(transaction.occurredAt),
          transaction.kind,
          neutralizeFormula(transaction.description),
          neutralizeFormula(category),
          neutralizeFormula(account.name),
          neutralizeFormula(code),
          formatDecimal(amount, currency.decimals),
        ],
      ];
    });
  });
}
