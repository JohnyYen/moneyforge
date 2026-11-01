import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { FailureState, LoadingState } from '@/shared/ui/primitives';
import { messageOf } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { LedgerService } from '../../application/ledger-service';
import type { Currency } from '../../domain/currency';
import { useLedger } from '../ledger-context';
import { SetupView } from './setup-view';

type GateState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'setup'; currencies: Currency[] }
  | { status: 'ready' };

async function resolveGate(ledger: LedgerService): Promise<GateState> {
  if (await ledger.getBaseCurrency()) return { status: 'ready' };
  return { status: 'setup', currencies: await ledger.listCurrencies() };
}

/** Shows first-run setup until a base currency exists. */
export function SetupGate({ children }: { children: ReactNode }) {
  const ledger = useLedger();
  const [state, setState] = useState<GateState>({ status: 'loading' });
  const [adding, setAdding] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const recheck = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    resolveGate(ledger).then(
      (next) => {
        if (active) setState(next);
      },
      (error: unknown) => {
        if (active) setState({ status: 'error', message: messageOf(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [ledger, attempt]);

  const complete = useSubmit(
    (code: string) => ledger.setBaseCurrency(code),
    () => setState({ status: 'ready' }),
  );
  const addCurrency = useSubmit(
    (currency: Currency) => ledger.createCurrency(currency),
    () => {
      setAdding(false);
      recheck();
    },
  );

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') return <FailureState message={state.message} onRetry={recheck} />;
  if (state.status === 'ready') return <>{children}</>;
  return (
    <SetupView
      currencies={state.currencies}
      error={complete.error}
      submitting={complete.submitting}
      currencyError={addCurrency.error}
      creatingCurrency={addCurrency.submitting}
      adding={adding}
      onAddingChange={setAdding}
      onCreateCurrency={addCurrency.submit}
      onComplete={complete.submit}
    />
  );
}
