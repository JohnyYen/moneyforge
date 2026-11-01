import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { AccountsScreen } from '@/features/ledger/ui/accounts/accounts-screen';
import { PendingMovesLink } from '@/features/split/ui/ledger-screens';
import { ListRow } from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';

import { useRules } from './rules-context';
import { inboxLabel } from './rules-model';

function InboxLink() {
  const rules = useRules();
  const router = useRouter();
  const load = useCallback(() => rules.countInbox(), [rules]);
  const { state } = useFocusQuery(load);

  if (state.status !== 'ready' || state.data === 0) return null;
  return <ListRow title={inboxLabel(state.data)} onPress={() => router.push('/inbox')} />;
}

/** The main tab with what needs attention on top, so the ledger never imports either feature. */
export function MainScreen() {
  return (
    <AccountsScreen
      header={
        <>
          <InboxLink />
          <PendingMovesLink />
        </>
      }
    />
  );
}
