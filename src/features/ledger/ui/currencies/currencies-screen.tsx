import { useCallback, useState } from 'react';

import { QueryBoundary } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { Currency } from '../../domain/currency';
import { useLedger } from '../ledger-context';
import { CurrenciesView, type CurrencyEditing } from './currencies-view';

export function CurrenciesScreen() {
  const ledger = useLedger();
  const [editing, setEditing] = useState<CurrencyEditing>({ mode: 'closed' });
  const load = useCallback(async () => {
    const [currencies, base] = await Promise.all([ledger.listCurrencies(), ledger.getBaseCurrency()]);
    return { currencies, baseCode: base?.code ?? null };
  }, [ledger]);
  const { state, reload } = useFocusQuery(load);

  const finish = () => {
    setEditing({ mode: 'closed' });
    reload();
  };
  const save = useSubmit(
    (currency: Currency) =>
      editing.mode === 'edit' ? ledger.updateCurrency(currency) : ledger.createCurrency(currency),
    finish,
  );
  const setBase = useSubmit((code: string) => ledger.setBaseCurrency(code), finish);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ currencies, baseCode }) => (
        <CurrenciesView
          currencies={currencies}
          baseCode={baseCode}
          editing={editing}
          error={save.error ?? setBase.error}
          submitting={save.submitting || setBase.submitting}
          onAdd={() => setEditing({ mode: 'new' })}
          onEdit={(currency) => setEditing({ mode: 'edit', currency })}
          onSubmit={save.submit}
          onSetBase={setBase.submit}
        />
      )}
    </QueryBoundary>
  );
}
