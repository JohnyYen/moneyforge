import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { useLedger } from '@/features/ledger/ui/ledger-context';
import { formatDisplay } from '@/features/ledger/domain/money';
import {
  Button,
  EmptyState,
  ListRow,
  Muted,
  QueryBoundary,
  Screen,
  SectionLabel,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';

import type { RecurringItem } from '../domain/recurring';
import { scheduleLabel } from './plan-model';
import { usePlanning } from './planning-context';

export function RecurringListScreen() {
  const planning = usePlanning();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    const [items, currencies] = await Promise.all([planning.listItems(), ledger.listCurrencies()]);
    return { items, currencies: new Map(currencies.map((item) => [item.code, item])) };
  }, [ledger, planning]);
  const { state, reload } = useFocusQuery(load);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ items, currencies }) => {
        const renderRow = (item: RecurringItem) => {
          const currency = currencies.get(item.currencyCode);
          return (
            <ListRow
              key={item.id}
              title={item.name}
              subtitle={scheduleLabel(item.schedule)}
              trailing={currency ? formatDisplay(item.amount, currency) : item.currencyCode}
              onPress={() =>
                router.push({ pathname: '/plan/recurring/[id]', params: { id: item.id } })
              }
            />
          );
        };
        const active = items.filter((item) => item.active);
        const archived = items.filter((item) => !item.active);
        return (
          <Screen>
            <Muted>
              Each date becomes one occurrence when the app starts. Editing an item only changes
              dates still to come.
            </Muted>
            {active.length === 0 ? (
              <EmptyState title="No recurring items" hint="Add income, bills, or regular moves." />
            ) : null}
            {active.map(renderRow)}
            <Button label="Add recurring item" onPress={() => router.push('/plan/recurring/new')} />
            {archived.length > 0 ? <SectionLabel>Archived</SectionLabel> : null}
            {archived.map(renderRow)}
          </Screen>
        );
      }}
    </QueryBoundary>
  );
}
