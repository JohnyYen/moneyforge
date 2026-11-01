import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { useLedger } from '@/features/ledger/ui/ledger-context';
import { missingRatesLabel } from '@/features/planning/ui/plan-model';
import {
  Button,
  EmptyState,
  ListRow,
  Muted,
  Notice,
  QueryBoundary,
  Screen,
  SectionLabel,
  Title,
} from '@/shared/ui/primitives';
import { unwrapOrThrow } from '@/shared/ui/unwrap';
import { useFocusQuery } from '@/shared/ui/use-focus-query';

import { assetRow, showMoney } from './asset-model';
import { useAssets } from './assets-context';

export function AssetsScreen() {
  const assets = useAssets();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    const [portfolio, types, currencies] = await Promise.all([
      assets.portfolio(),
      assets.listTypes(),
      ledger.listCurrencies(),
    ]);
    return {
      portfolio: unwrapOrThrow(portfolio),
      types,
      currencies: new Map(currencies.map((item) => [item.code, item])),
    };
  }, [assets, ledger]);
  const { state, reload } = useFocusQuery(load);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ portfolio, types, currencies }) => {
        const { rows, totalValue, monthlyNet, missingRates } = portfolio;
        const missing = missingRatesLabel(missingRates);
        return (
          <Screen>
            <Muted>Portfolio value</Muted>
            <Title>{showMoney(totalValue.minor, totalValue.currency, currencies)}</Title>
            <Muted>
              Net cash flow this month: {showMoney(monthlyNet.minor, monthlyNet.currency, currencies)}
            </Muted>
            {missing ? <Notice>{missing}</Notice> : null}
            <SectionLabel>Assets</SectionLabel>
            {rows.length === 0 ? (
              <EmptyState title="No assets yet" hint="Add one to track its value and cash flow." />
            ) : null}
            {rows.map((row) => {
              const { key, title, subtitle, trailing } = assetRow(row, types, currencies);
              return (
                <ListRow
                  key={key}
                  title={title}
                  subtitle={subtitle}
                  trailing={trailing}
                  onPress={() => router.push({ pathname: '/assets/[id]', params: { id: key } })}
                />
              );
            })}
            <Button label="Add asset" onPress={() => router.push('/assets/new')} />
            <ListRow title="Asset types" onPress={() => router.push('/assets/types')} />
          </Screen>
        );
      }}
    </QueryBoundary>
  );
}
