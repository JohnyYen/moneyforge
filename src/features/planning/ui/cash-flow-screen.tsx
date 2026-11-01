import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { useLedger } from '@/features/ledger/ui/ledger-context';
import { formatDisplay } from '@/features/ledger/domain/money';
import {
  Button,
  ChoiceChips,
  ListRow,
  Muted,
  Notice,
  QueryBoundary,
  Screen,
  SectionLabel,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { unwrapOrThrow } from '@/shared/ui/unwrap';

import type { HistoryPeriod } from '../application/cash-flow-use-cases';
import { bucketBalances, firstNegativeLabel, flowTotalsLabel, missingRatesLabel } from './plan-model';
import { BalanceBars } from './plan-visuals';
import { usePlanning } from './planning-context';

const HORIZONS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '6 months' },
  { value: '365', label: '1 year' },
] as const;

const HISTORY_OPTIONS: readonly { value: HistoryPeriod; label: string }[] = [
  { value: 'weekly', label: 'Weeks' },
  { value: 'monthly', label: 'Months' },
  { value: 'yearly', label: 'Years' },
];

const BUDGET_OPTIONS = [
  { value: 'off', label: 'Leave out' },
  { value: 'on', label: 'Reserve what remains' },
] as const;

const HISTORY_COUNT = 6;
const MAX_BARS = 60;

export function CashFlowScreen() {
  const planning = usePlanning();
  const ledger = useLedger();
  const router = useRouter();
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]['value']>('90');
  const [includeBudgets, setIncludeBudgets] = useState(false);
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>('monthly');

  const load = useCallback(async () => {
    const [projection, history, accounts, currencies, base, planned] = await Promise.all([
      planning.projectCashFlow({ horizonDays: Number(horizon), includeBudgets }),
      planning.cashFlowHistory(historyPeriod, HISTORY_COUNT),
      ledger.listAccounts(),
      ledger.listCurrencies(),
      ledger.getBaseCurrency(),
      planning.listPlannedItems(),
    ]);
    return {
      projection: unwrapOrThrow(projection),
      history: unwrapOrThrow(history),
      names: new Map(accounts.map(({ id, name }) => [id, name])),
      currencies: new Map(currencies.map((currency) => [currency.code, currency])),
      base,
      planned,
    };
  }, [horizon, historyPeriod, includeBudgets, ledger, planning]);
  const { state, reload } = useFocusQuery(load);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ projection, history, names, currencies, base, planned }) => {
        if (!base) return null;
        const { total } = projection;
        const lastTotal = total.balances[total.balances.length - 1];
        const missing = missingRatesLabel(total.missingRates);
        return (
          <Screen>
            <SectionLabel>Projection</SectionLabel>
            <ChoiceChips options={HORIZONS} value={horizon} onChange={setHorizon} />
            <ChoiceChips
              label="Budgets"
              options={BUDGET_OPTIONS}
              value={includeBudgets ? 'on' : 'off'}
              onChange={(value) => setIncludeBudgets(value === 'on')}
            />
            {includeBudgets ? (
              <Muted>What remains of each budget leaves the total when its period ends.</Muted>
            ) : null}
            <ListRow
              title={`Total in ${base.code}`}
              subtitle={firstNegativeLabel(total.firstNegativeOn)}
              trailing={formatDisplay(lastTotal, base)}
            />
            <BalanceBars
              values={bucketBalances(projection.days, total.balances, MAX_BARS).map(
                ({ balance }) => balance,
              )}
            />
            {total.firstNegativeOn ? (
              <Notice>{firstNegativeLabel(total.firstNegativeOn)}</Notice>
            ) : null}
            {missing ? <Notice>{missing}</Notice> : null}
            {projection.accounts.map(({ accountId, currency, balances, firstNegativeOn }) => {
              const details = currencies.get(currency);
              const last = balances[balances.length - 1];
              return (
                <View key={accountId}>
                  <ListRow
                    title={names.get(accountId) ?? accountId}
                    subtitle={firstNegativeLabel(firstNegativeOn)}
                    trailing={details ? formatDisplay(last, details) : currency}
                  />
                  <BalanceBars
                    values={bucketBalances(projection.days, balances, MAX_BARS).map(
                      ({ balance }) => balance,
                    )}
                  />
                </View>
              );
            })}

            <SectionLabel>Planned one-offs</SectionLabel>
            {planned.map((item) => {
              const account = names.get(item.accountId) ?? item.accountId;
              return (
                <ListRow
                  key={item.id}
                  title={item.description}
                  subtitle={`${item.plannedOn}, ${account}`}
                  trailing="Remove"
                  onPress={() => {
                    void planning.removePlannedItem(item.id).then(reload, reload);
                  }}
                />
              );
            })}
            <Button
              label="Add planned item"
              variant="secondary"
              onPress={() => router.push('/plan/cash-flow/planned')}
            />

            <SectionLabel>History</SectionLabel>
            <ChoiceChips options={HISTORY_OPTIONS} value={historyPeriod} onChange={setHistoryPeriod} />
            <BalanceBars values={history.map(({ base: totals }) => totals.net)} />
            {[...history].reverse().map(({ period, base: totals, byCurrency, missingRates }) => (
              <View key={period.startOn}>
                <ListRow
                  title={`${period.startOn} to ${period.endOn}`}
                  subtitle={flowTotalsLabel(totals, base)}
                />
                {byCurrency.length > 1
                  ? byCurrency.map(({ currency, ...flows }) => {
                      const details = currencies.get(currency);
                      return details ? (
                        <Muted key={currency}>{`${currency}: ${flowTotalsLabel(flows, details)}`}</Muted>
                      ) : null;
                    })
                  : null}
                {missingRates.length > 0 ? (
                  <Notice>{missingRatesLabel(missingRates)}</Notice>
                ) : null}
              </View>
            ))}
          </Screen>
        );
      }}
    </QueryBoundary>
  );
}
