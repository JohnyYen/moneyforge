import { Button, ChoiceChips, EmptyState, Screen } from '@/shared/ui/primitives';

import type { Account } from '../../domain/account';
import { TRANSACTION_KINDS, type TransactionKind } from '../../domain/journal';
import { KIND_LABELS, type TransactionRowModel } from '../transaction-row-model';
import { TransactionRow } from './transaction-row';

export const ALL = 'all';
export type KindFilter = TransactionKind | typeof ALL;

const KIND_OPTIONS: readonly { value: KindFilter; label: string }[] = [
  { value: ALL, label: 'All' },
  ...TRANSACTION_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] })),
];

export function TransactionsView({
  rows,
  accounts,
  kind,
  accountId,
  canLoadMore,
  onKindChange,
  onAccountChange,
  onLoadMore,
  onAdd,
  onOpen,
}: {
  rows: readonly TransactionRowModel[];
  accounts: readonly Account[];
  kind: KindFilter;
  accountId: string;
  canLoadMore: boolean;
  onKindChange: (kind: KindFilter) => void;
  onAccountChange: (accountId: string) => void;
  onLoadMore: () => void;
  onAdd: () => void;
  onOpen: (id: string) => void;
}) {
  const filtered = kind !== ALL || accountId !== ALL;
  return (
    <Screen>
      {accounts.length > 0 ? <Button label="Add transaction" onPress={onAdd} /> : null}
      <ChoiceChips options={KIND_OPTIONS} value={kind} onChange={onKindChange} />
      {accounts.length > 1 ? (
        <ChoiceChips
          options={[
            { value: ALL, label: 'All accounts' },
            ...accounts.map((account) => ({ value: account.id, label: account.name })),
          ]}
          value={accountId}
          onChange={onAccountChange}
        />
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? 'Nothing matches these filters' : 'No transactions yet'}
          hint={
            filtered || accounts.length > 0
              ? undefined
              : 'Add an account first, then record your first transaction.'
          }
        />
      ) : null}
      {rows.map((row) => (
        <TransactionRow key={row.id} row={row} onOpen={onOpen} />
      ))}
      {canLoadMore ? <Button label="Load more" variant="secondary" onPress={onLoadMore} /> : null}
    </Screen>
  );
}
