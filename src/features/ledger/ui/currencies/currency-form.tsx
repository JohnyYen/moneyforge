import { useState } from 'react';

import {
  Button,
  ChoiceChips,
  ErrorBanner,
  TextField,
} from '@/shared/ui/primitives';

import { CURRENCY_KINDS, type Currency, type CurrencyKind } from '../../domain/currency';

const KIND_OPTIONS = CURRENCY_KINDS.map((kind) => ({
  value: kind,
  label: { fiat: 'Fiat', stablecoin: 'Stablecoin', other: 'Other' }[kind],
}));

export function CurrencyForm({
  initial,
  error,
  submitting,
  submitLabel,
  onSubmit,
}: {
  initial?: Currency;
  error: string | null;
  submitting: boolean;
  submitLabel: string;
  onSubmit: (currency: Currency) => void;
}) {
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [symbol, setSymbol] = useState(initial?.symbol ?? '');
  const [decimals, setDecimals] = useState(String(initial?.decimals ?? 2));
  const [kind, setKind] = useState<CurrencyKind>(initial?.kind ?? 'fiat');

  return (
    <>
      <TextField
        label="Code"
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!initial}
      />
      <TextField label="Name" value={name} onChangeText={setName} />
      <TextField label="Symbol" value={symbol} onChangeText={setSymbol} autoCorrect={false} />
      <TextField
        label="Decimals (0 to 18)"
        value={decimals}
        onChangeText={setDecimals}
        keyboardType="number-pad"
      />
      <ChoiceChips label="Kind" options={KIND_OPTIONS} value={kind} onChange={setKind} />
      <ErrorBanner message={error} />
      <Button
        label={submitLabel}
        disabled={submitting}
        onPress={() => onSubmit({ code, name, symbol, kind, decimals: Number(decimals) })}
      />
    </>
  );
}
