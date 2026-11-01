import { useEffect, useState, type ReactNode } from 'react';

import { LedgerContext } from '@/features/ledger/ui/ledger-context';
import { CaptureContext } from '@/features/rules/ui/capture-context';
import { RulesContext } from '@/features/rules/ui/rules-context';
import { SplitContext } from '@/features/split/ui/split-context';
import { FailureState, LoadingState } from '@/shared/ui/primitives';
import { messageOf } from '@/shared/ui/use-focus-query';

import type { AppServices } from './create-app-services';
import { openAppServices } from './open-app-services';

type OpenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; services: AppServices };

export function AppServicesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpenState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    openAppServices().then(
      (services) => {
        if (active) setState({ status: 'ready', services });
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
  return (
    <LedgerContext.Provider value={state.services.ledger}>
      <SplitContext.Provider value={state.services.split}>
        <RulesContext.Provider value={state.services.rules}>
          <CaptureContext.Provider value={state.services.capture}>
            {children}
          </CaptureContext.Provider>
        </RulesContext.Provider>
      </SplitContext.Provider>
    </LedgerContext.Provider>
  );
}
