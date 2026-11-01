import { useCallback } from 'react';

import { QueryBoundary } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import { toLocalDay } from '../../application/overview-use-cases';
import { useLedger } from '../ledger-context';
import { ExchangeRatesView, type RateValues } from './exchange-rates-view';

export function ExchangeRatesScreen() {
  const ledger = useLedger();
  const load = useCallback(async () => {
    const [rates, currencies, base] = await Promise.all([
      ledger.listRates(),
      ledger.listCurrencies(),
      ledger.getBaseCurrency(),
    ]);
    return { rates, currencies, baseCode: base?.code ?? null };
  }, [ledger]);
  const { state, reload } = useFocusQuery(load);
  const { submit, error, submitting } = useSubmit(
    (values: RateValues) => ledger.saveRate(values),
    reload,
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {(data) => (
        <ExchangeRatesView
          {...data}
          today={toLocalDay(new Date())}
          error={error}
          submitting={submitting}
          onSubmit={submit}
        />
      )}
    </QueryBoundary>
  );
}
