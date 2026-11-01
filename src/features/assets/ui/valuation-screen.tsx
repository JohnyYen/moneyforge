import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { toLocalDay } from '@/features/ledger/application/overview-use-cases';
import { leaveScreen } from '@/shared/ui/leave-screen';
import { AmountField, Button, ErrorBanner, Muted, Screen, TextField } from '@/shared/ui/primitives';
import { useSubmit } from '@/shared/ui/use-submit';

import { useAssets } from './assets-context';

export function ValuationScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const assets = useAssets();
  const router = useRouter();
  const [valuedOn, setValuedOn] = useState(toLocalDay(new Date()));
  const [amount, setAmount] = useState('');
  const save = useSubmit(
    () => assets.addValuation(id, { valuedOn, amount }),
    () => leaveScreen(router),
    { exitsOnSuccess: true },
  );

  return (
    <Screen>
      <AmountField label="Value" value={amount} onChangeText={setAmount} />
      <TextField label="Date, YYYY-MM-DD" value={valuedOn} onChangeText={setValuedOn} />
      <Muted>A value is not cash, so no account changes. A second value on a date replaces it.</Muted>
      <ErrorBanner message={save.error} />
      <Button label="Save" disabled={save.submitting} onPress={() => void save.submit(undefined)} />
    </Screen>
  );
}
