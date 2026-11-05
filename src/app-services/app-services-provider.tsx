import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { AssetsContext } from '@/features/assets/ui/assets-context';
import { BackupContext } from '@/features/backup/ui/backup-context';
import { LedgerContext } from '@/features/ledger/ui/ledger-context';
import { OnChainContext } from '@/features/onchain/ui/onchain-context';
import { PlanningContext } from '@/features/planning/ui/planning-context';
import { CaptureContext } from '@/features/rules/ui/capture-context';
import { RulesContext } from '@/features/rules/ui/rules-context';
import { SplitContext } from '@/features/split/ui/split-context';
import { TransferContext } from '@/features/transfer/ui/transfer-context';
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

  /** Starts over from the database, as a launch would; the screens below remount. */
  const reopen = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);
  const services = state.status === 'ready' ? state.services : null;
  const backup = useMemo(
    () => (services ? { backup: services.backup, reopen } : null),
    [services, reopen],
  );

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
      <FailureState message={state.message} onRetry={reopen} />
    );
  }
  return (
    <LedgerContext.Provider value={state.services.ledger}>
      <SplitContext.Provider value={state.services.split}>
        <RulesContext.Provider value={state.services.rules}>
          <CaptureContext.Provider value={state.services.capture}>
            <PlanningContext.Provider value={state.services.planning}>
              <AssetsContext.Provider value={state.services.assets}>
                <OnChainContext.Provider value={state.services.onchain}>
                  <TransferContext.Provider value={state.services.transfer}>
                    <BackupContext.Provider value={backup}>{children}</BackupContext.Provider>
                  </TransferContext.Provider>
                </OnChainContext.Provider>
              </AssetsContext.Provider>
            </PlanningContext.Provider>
          </CaptureContext.Provider>
        </RulesContext.Provider>
      </SplitContext.Provider>
    </LedgerContext.Provider>
  );
}
