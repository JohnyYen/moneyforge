import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { FailureState, LoadingState } from '@/shared/ui/primitives';
import { messageOf } from '@/shared/ui/use-focus-query';

import type { LedgerService } from '../application/ledger-service';
import { openLedger } from '../infrastructure/open-ledger';

const LedgerContext = createContext<LedgerService | null>(null);

export function useLedger(): LedgerService {
  const ledger = useContext(LedgerContext);
  if (!ledger) throw new Error('useLedger needs a LedgerProvider');
  return ledger;
}

type OpenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; ledger: LedgerService };

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpenState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    openLedger().then(
      (ledger) => {
        if (active) setState({ status: 'ready', ledger });
      },
      (error: unknown) => {
        if (active) setState({ status: 'error', message: messageOf(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') {
    return (
      <FailureState
        message={state.message}
        onRetry={() => {
          setState({ status: 'loading' });
          setAttempt((value) => value + 1);
        }}
      />
    );
  }
  return <LedgerContext.Provider value={state.ledger}>{children}</LedgerContext.Provider>;
}
