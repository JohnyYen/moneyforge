import { useState } from 'react';

import {
  AmountField,
  Button,
  ChoiceChips,
  ErrorBanner,
  Screen,
  TextField,
} from '@/shared/ui/primitives';

import type { Currency } from '../../domain/currency';

export type AccountFormValues = {
  name: string;
  type: string;
  currencyCode: string;
  openingBalance: string;
  archived: boolean;
};

export function AccountForm({
  initial,
  currencies,
  typeSuggestions,
  error,
  submitting,
  onSubmit,
}: {
  initial?: AccountFormValues;
  currencies: readonly Currency[];
  typeSuggestions: readonly string[];
  error: string | null;
  submitting: boolean;
  onSubmit: (values: AccountFormValues) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? '');
  const [currencyCode, setCurrencyCode] = useState(initial?.currencyCode ?? null);
  const [openingBalance, setOpeningBalance] = useState(initial?.openingBalance ?? '');
  const archived = initial?.archived ?? false;

  const submit = (nextArchived: boolean) => {
    if (currencyCode) {
      onSubmit({ name, type, currencyCode, openingBalance, archived: nextArchived });
    }
  };

  return (
    <Screen>
      <TextField label="Name" value={name} onChangeText={setName} autoFocus={!initial} />
      <TextField
        label="Type"
        value={type}
        onChangeText={setType}
        placeholder="Bank, cash, wallet, exchange"
      />
      {typeSuggestions.length > 0 ? (
        <ChoiceChips
          options={typeSuggestions.map((value) => ({ value, label: value }))}
          value={type}
          onChange={setType}
        />
      ) : null}
      {initial ? null : (
        <ChoiceChips
          label="Currency"
          options={currencies.map(({ code }) => ({ value: code, label: code }))}
          value={currencyCode}
          onChange={setCurrencyCode}
        />
      )}
      <AmountField
        label="Opening balance"
        value={openingBalance}
        onChangeText={setOpeningBalance}
        placeholder="0"
      />
      <ErrorBanner message={error} />
      <Button
        label="Save account"
        disabled={!currencyCode || submitting}
        onPress={() => submit(archived)}
      />
      {initial ? (
        <Button
          label={archived ? 'Restore account' : 'Archive account'}
          variant="secondary"
          disabled={submitting}
          onPress={() => submit(!archived)}
        />
      ) : null}
    </Screen>
  );
}
