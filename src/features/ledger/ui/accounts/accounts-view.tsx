import type { ReactNode } from 'react';

import {
  Button,
  EmptyState,
  ListRow,
  Muted,
  Notice,
  Screen,
  SectionLabel,
  Title,
} from '@/shared/ui/primitives';

import type { AccountBalance } from '../../application/overview-use-cases';
import type { Currency } from '../../domain/currency';
import { formatDisplay } from '../../domain/money';
import type { NetWorth } from '../../domain/net-worth';

export type NetWorthSummary = { readonly netWorth: NetWorth; readonly base: Currency };

export function AccountsView({
  header,
  balances,
  summary,
  onOpenAccount,
  onAddAccount,
  onAddTransaction,
}: {
  header?: ReactNode;
  balances: readonly AccountBalance[];
  summary: NetWorthSummary | null;
  onOpenAccount: (id: string) => void;
  onAddAccount: () => void;
  onAddTransaction: () => void;
}) {
  const active = balances.filter(({ account }) => !account.archived);
  const archived = balances.filter(({ account }) => account.archived);
  const renderRow = ({ account, currency, balance }: AccountBalance) => (
    <ListRow
      key={account.id}
      title={account.name}
      subtitle={`${account.type} · ${currency.code}`}
      trailing={formatDisplay(balance, currency)}
      onPress={() => onOpenAccount(account.id)}
    />
  );

  return (
    <Screen>
      {header}
      {summary ? (
        <>
          <Muted>Net worth</Muted>
          <Title>{formatDisplay(summary.netWorth.total.minor, summary.base)}</Title>
          {summary.netWorth.missingRates.length > 0 ? (
            <Notice>
              Not included, no exchange rate to {summary.base.code}:{' '}
              {summary.netWorth.missingRates.join(', ')}
            </Notice>
          ) : null}
        </>
      ) : null}
      {active.length > 0 ? <Button label="Add transaction" onPress={onAddTransaction} /> : null}
      <SectionLabel>Accounts</SectionLabel>
      {active.length === 0 ? (
        <EmptyState title="No accounts yet" hint="Add your first account to start tracking." />
      ) : null}
      {active.map(renderRow)}
      <Button label="Add account" variant="secondary" onPress={onAddAccount} />
      {archived.length > 0 ? <SectionLabel>Archived</SectionLabel> : null}
      {archived.map(renderRow)}
    </Screen>
  );
}
