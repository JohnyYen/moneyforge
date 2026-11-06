import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

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

import type { Currency } from '../../domain/currency';
import { formatDisplay } from '../../domain/money';
import type { NetWorth } from '../../domain/net-worth';
import type { AccountsListEntry, AccountsListModel } from './accounts-list-model';

export type NetWorthSummary = { readonly netWorth: NetWorth; readonly base: Currency };

export function AccountsView({
  header,
  list,
  summary,
  summaryExtra,
  onOpenAccount,
  onOpenGroup,
  onAddAccount,
  onAddTransaction,
}: {
  header?: ReactNode;
  list: AccountsListModel;
  summary: NetWorthSummary | null;
  summaryExtra?: ReactNode;
  onOpenAccount: (id: string) => void;
  onOpenGroup: (id: string) => void;
  onAddAccount: () => void;
  onAddTransaction: () => void;
}) {
  const renderEntry = (entry: AccountsListEntry) =>
    entry.kind === 'account' ? (
      <ListRow
        key={entry.id}
        title={entry.title}
        subtitle={entry.subtitle}
        trailing={entry.trailing}
        onPress={() => onOpenAccount(entry.id)}
      />
    ) : (
      <View key={entry.id}>
        <ListRow
          title={entry.title}
          subtitle={entry.subtitle}
          trailing={entry.trailing ?? undefined}
          onPress={() => onOpenGroup(entry.id)}
        />
        {entry.note ? <Notice>{entry.note}</Notice> : null}
        <View style={styles.subAccounts}>
          {entry.accounts.map((account) => (
            <ListRow
              key={account.id}
              title={account.title}
              subtitle={account.subtitle}
              trailing={account.trailing}
              onPress={() => onOpenAccount(account.id)}
            />
          ))}
        </View>
      </View>
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
          {summaryExtra}
        </>
      ) : null}
      {list.hasActiveAccounts ? (
        <Button label="Add transaction" onPress={onAddTransaction} />
      ) : null}
      <SectionLabel>Accounts</SectionLabel>
      {list.active.length === 0 ? (
        <EmptyState title="No accounts yet" hint="Add your first account to start tracking." />
      ) : null}
      {list.active.map(renderEntry)}
      <Button label="Add account" variant="secondary" onPress={onAddAccount} />
      {list.archived.length > 0 ? <SectionLabel>Archived</SectionLabel> : null}
      {list.archived.map(renderEntry)}
    </Screen>
  );
}

const styles = StyleSheet.create({
  subAccounts: { paddingLeft: 24 },
});
