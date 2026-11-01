import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import type { Currency } from '@/features/ledger/domain/currency';
import { formatDecimal } from '@/features/ledger/domain/money';
import { useLedger } from '@/features/ledger/ui/ledger-context';
import { leaveScreen } from '@/shared/ui/leave-screen';
import {
  AmountField,
  Button,
  EmptyState,
  ErrorBanner,
  Notice,
  QueryBoundary,
  Screen,
  TextField,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { ConfirmEdits } from '../application/recurring-use-cases';
import type { Occurrence } from '../domain/recurring';
import { usePlanning } from './planning-context';

function OccurrenceForm({
  occurrence,
  currency,
  error,
  submitting,
  onConfirm,
  onSkip,
}: {
  occurrence: Occurrence;
  currency: Currency;
  error: string | null;
  submitting: boolean;
  onConfirm: (edits: ConfirmEdits) => void;
  onSkip: () => void;
}) {
  const [amount, setAmount] = useState(formatDecimal(occurrence.amount, currency.decimals));
  const [description, setDescription] = useState(occurrence.description);
  const [occurredOn, setOccurredOn] = useState(occurrence.dueOn);

  return (
    <Screen>
      {occurrence.note ? <Notice>{occurrence.note}</Notice> : null}
      <AmountField label={`Amount in ${currency.code}`} value={amount} onChangeText={setAmount} />
      <TextField label="Description" value={description} onChangeText={setDescription} />
      <TextField label="Date, YYYY-MM-DD" value={occurredOn} onChangeText={setOccurredOn} />
      <ErrorBanner message={error} />
      <Button
        label="Confirm"
        disabled={submitting}
        onPress={() => onConfirm({ amount, description, occurredOn })}
      />
      <Button label="Skip this date" variant="secondary" disabled={submitting} onPress={onSkip} />
    </Screen>
  );
}

export function OccurrenceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const planning = usePlanning();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    const [occurrence, currencies] = await Promise.all([
      planning.getOccurrence(id),
      ledger.listCurrencies(),
    ]);
    const currency = currencies.find(({ code }) => code === occurrence?.currencyCode);
    return { occurrence, currency };
  }, [id, ledger, planning]);
  const { state, reload } = useFocusQuery(load);

  const exit = () => leaveScreen(router);
  const confirm = useSubmit((edits: ConfirmEdits) => planning.confirmOccurrence(id, edits), exit, {
    exitsOnSuccess: true,
  });
  const skip = useSubmit(() => planning.skipOccurrence(id), exit, { exitsOnSuccess: true });

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ occurrence, currency }) => {
        if (occurrence?.status !== 'pending' || !currency) {
          return (
            <Screen>
              <EmptyState title="This occurrence is no longer pending" />
            </Screen>
          );
        }
        return (
          <OccurrenceForm
            occurrence={occurrence}
            currency={currency}
            error={confirm.error ?? skip.error}
            submitting={confirm.submitting || skip.submitting}
            onConfirm={(edits) => void confirm.submit(edits)}
            onSkip={() => void skip.submit(undefined)}
          />
        );
      }}
    </QueryBoundary>
  );
}
