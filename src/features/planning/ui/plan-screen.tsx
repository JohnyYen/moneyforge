import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';

import { useLedger } from '@/features/ledger/ui/ledger-context';
import {
  Button,
  EmptyState,
  ListRow,
  Muted,
  Notice,
  QueryBoundary,
  Screen,
  SectionLabel,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';

import { budgetRow, occurrenceRow, occurrencesLabel } from './plan-model';
import { ProgressBar } from './plan-visuals';
import { usePlanning } from './planning-context';

export function PlanScreen() {
  const planning = usePlanning();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    // Covers an app left open across midnight. A failure runs again on the next visit.
    await planning.materializeDue().catch(() => undefined);
    const [statuses, pending, currencies] = await Promise.all([
      planning.budgetStatuses(),
      planning.listPendingOccurrences(),
      ledger.listCurrencies(),
    ]);
    return { statuses, pending, currencies: new Map(currencies.map((item) => [item.code, item])) };
  }, [ledger, planning]);
  const { state, reload } = useFocusQuery(load);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ statuses, pending, currencies }) => (
        <Screen>
          <SectionLabel>Budgets</SectionLabel>
          {statuses.length === 0 ? (
            <EmptyState title="No budgets yet" hint="Add one to compare plans with spending." />
          ) : null}
          {statuses.map((status) => {
            const row = budgetRow(status, currencies);
            return (
              <View key={row.key}>
                <ListRow
                  title={row.title}
                  subtitle={row.subtitle}
                  trailing={row.amount}
                  onPress={() =>
                    router.push({ pathname: '/plan/budgets/[id]', params: { id: row.key } })
                  }
                />
                <ProgressBar fraction={row.fraction} alert={row.overspent} />
                {row.warning ? <Notice>{row.warning}</Notice> : null}
              </View>
            );
          })}
          <Button label="Add budget" onPress={() => router.push('/plan/budgets/new')} />

          <SectionLabel>Recurring</SectionLabel>
          {pending.length > 0 ? <Muted>{occurrencesLabel(pending.length)}</Muted> : null}
          {pending.map((occurrence) => {
            const row = occurrenceRow(occurrence, currencies);
            return (
              <ListRow
                key={row.key}
                title={row.title}
                subtitle={row.subtitle}
                trailing={row.amount}
                onPress={() =>
                  router.push({ pathname: '/plan/occurrences/[id]', params: { id: row.key } })
                }
              />
            );
          })}
          <ListRow title="Recurring items" onPress={() => router.push('/plan/recurring')} />
          <ListRow title="Cash flow" onPress={() => router.push('/plan/cash-flow')} />
        </Screen>
      )}
    </QueryBoundary>
  );
}
