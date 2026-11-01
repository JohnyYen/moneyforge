import {
  Button,
  EmptyState,
  Muted,
  Screen,
  SectionLabel,
  Title,
  useColors,
} from '@/shared/ui/primitives';

import type { Account } from '../../domain/account';
import type { Currency } from '../../domain/currency';
import { formatDisplay } from '../../domain/money';
import { TransactionRow } from '../transactions/transaction-row';
import type { TransactionRowModel } from '../transaction-row-model';

export function AccountDetailView({
  account,
  currency,
  balance,
  rows,
  canLoadMore,
  onLoadMore,
  onAddTransaction,
  onReconcile,
  onEdit,
}: {
  account: Account;
  currency: Currency;
  balance: bigint;
  rows: readonly TransactionRowModel[];
  canLoadMore: boolean;
  onLoadMore: () => void;
  onAddTransaction: () => void;
  onReconcile: () => void;
  onEdit: () => void;
}) {
  useColors();
  return (
    <Screen>
      <Muted>
        {account.name} · {account.type} · {currency.code}
        {account.archived ? ' · Archived' : ''}
      </Muted>
      <Title>{formatDisplay(balance, currency)}</Title>
      {account.archived ? null : (
        <>
          <Button label="Add transaction" onPress={onAddTransaction} />
          <Button label="Reconcile" variant="secondary" onPress={onReconcile} />
        </>
      )}
      <Button label="Edit account" variant="secondary" onPress={onEdit} />
      <SectionLabel>Transactions</SectionLabel>
      {rows.length === 0 ? <EmptyState title="No transactions yet" /> : null}
      {rows.map((row) => (
        <TransactionRow key={row.id} row={row} />
      ))}
      {canLoadMore ? <Button label="Load more" variant="secondary" onPress={onLoadMore} /> : null}
    </Screen>
  );
}
