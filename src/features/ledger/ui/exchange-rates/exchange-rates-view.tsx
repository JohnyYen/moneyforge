import { useState } from 'react';

import {
  AmountField,
  Button,
  ChoiceChips,
  EmptyState,
  ErrorBanner,
  ListRow,
  Muted,
  Screen,
  SectionLabel,
  TextField,
} from '@/shared/ui/primitives';

import type { Currency } from '../../domain/currency';
import type { ExchangeRate } from '../../domain/exchange-rate';
import { ratePreview } from '../amount-preview';

export type RateValues = { fromCode: string; toCode: string; rate: string; effectiveOn: string };

export function ExchangeRatesView({
  rates,
  currencies,
  baseCode,
  today,
  error,
  submitting,
  onSubmit,
}: {
  rates: readonly ExchangeRate[];
  currencies: readonly Currency[];
  baseCode: string | null;
  today: string;
  error: string | null;
  submitting: boolean;
  onSubmit: (values: RateValues) => void;
}) {
  const [fromCode, setFromCode] = useState<string | null>(null);
  const [toCode, setToCode] = useState(baseCode);
  const [rate, setRate] = useState('');
  const [effectiveOn, setEffectiveOn] = useState(today);
  const options = currencies.map(({ code }) => ({ value: code, label: code }));

  return (
    <Screen>
      <Muted>Rates are entered by you. Each pair keeps one rate per day.</Muted>
      <ChoiceChips label="From" options={options} value={fromCode} onChange={setFromCode} />
      <ChoiceChips label="To" options={options} value={toCode} onChange={setToCode} />
      <AmountField
        label={fromCode && toCode ? `${toCode} per 1 ${fromCode}` : 'Rate'}
        value={rate}
        onChangeText={setRate}
        preview={ratePreview(rate, fromCode, toCode)}
      />
      <TextField
        label="Date"
        value={effectiveOn}
        onChangeText={setEffectiveOn}
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
      />
      <ErrorBanner message={error} />
      <Button
        label="Save rate"
        disabled={!fromCode || !toCode || !rate || submitting}
        onPress={() => {
          if (fromCode && toCode) onSubmit({ fromCode, toCode, rate, effectiveOn });
        }}
      />
      <SectionLabel>Saved rates</SectionLabel>
      {rates.length === 0 ? (
        <EmptyState
          title="No rates yet"
          hint="Add a rate to include other currencies in your net worth."
        />
      ) : null}
      {rates.map((item) => (
        <ListRow
          key={item.id}
          title={`1 ${item.fromCode} = ${item.rate} ${item.toCode}`}
          subtitle={item.effectiveOn}
        />
      ))}
    </Screen>
  );
}
