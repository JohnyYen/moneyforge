import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { toLocalDay } from '@/features/ledger/application/overview-use-cases';
import { useLedger } from '@/features/ledger/ui/ledger-context';
import { leaveScreen } from '@/shared/ui/leave-screen';
import {
  AmountField,
  Button,
  ChoiceChips,
  EmptyState,
  ErrorBanner,
  QueryBoundary,
  Screen,
  TextField,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { PlannedInput } from '../application/cash-flow-use-cases';
import type { PlannedItem } from '../domain/recurring';
import { usePlanning } from './planning-context';

const KIND_OPTIONS: readonly { value: PlannedItem['kind']; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
];

export function PlannedItemScreen() {
  const planning = usePlanning();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(
    async () => (await ledger.listAccountsForDisplay()).filter(({ archived }) => !archived),
    [ledger],
  );
  const { state, reload } = useFocusQuery(load);
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<PlannedItem['kind']>('expense');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [plannedOn, setPlannedOn] = useState(() => toLocalDay(new Date()));
  const save = useSubmit(
    (input: PlannedInput) => planning.addPlannedItem(input),
    () => leaveScreen(router),
    { exitsOnSuccess: true },
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {(accounts) => {
        if (accounts.length === 0) {
          return (
            <Screen>
              <EmptyState title="No accounts yet" hint="Add an account first." />
            </Screen>
          );
        }
        const chosen = accountId ?? accounts[0].id;
        return (
          <Screen>
            <TextField label="Description" value={description} onChangeText={setDescription} />
            <ChoiceChips label="Type" options={KIND_OPTIONS} value={kind} onChange={setKind} />
            <ChoiceChips
              label="Account"
              options={accounts.map(({ id, name, currencyCode }) => ({
                value: id,
                label: `${name} (${currencyCode})`,
              }))}
              value={chosen}
              onChange={setAccountId}
            />
            <AmountField label="Amount" value={amount} onChangeText={setAmount} />
            <TextField label="Date, YYYY-MM-DD" value={plannedOn} onChangeText={setPlannedOn} />
            <ErrorBanner message={save.error} />
            <Button
              label="Save"
              disabled={save.submitting}
              onPress={() =>
                void save.submit({
                  description,
                  kind,
                  accountId: chosen,
                  amount,
                  plannedOn: plannedOn.trim(),
                })
              }
            />
          </Screen>
        );
      }}
    </QueryBoundary>
  );
}
