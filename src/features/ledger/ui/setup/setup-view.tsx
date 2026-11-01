import { useState } from 'react';

import {
  Button,
  ChoiceChips,
  ErrorBanner,
  Muted,
  Screen,
  SectionLabel,
  Title,
} from '@/shared/ui/primitives';

import type { Currency } from '../../domain/currency';
import { CurrencyForm } from '../currencies/currency-form';

export function SetupView({
  currencies,
  error,
  submitting,
  currencyError,
  creatingCurrency,
  adding,
  onAddingChange,
  onCreateCurrency,
  onComplete,
}: {
  currencies: readonly Currency[];
  error: string | null;
  submitting: boolean;
  currencyError: string | null;
  creatingCurrency: boolean;
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
  onCreateCurrency: (currency: Currency) => void;
  onComplete: (code: string) => void;
}) {
  const [code, setCode] = useState<string | null>(null);

  return (
    <Screen>
      <Title>Welcome to MoneyForge</Title>
      <Muted>
        Choose the currency used to add up your net worth. Your data stays on this device. You can
        change this later.
      </Muted>
      <ChoiceChips
        label="Base currency"
        options={currencies.map((currency) => ({
          value: currency.code,
          label: `${currency.code} · ${currency.name}`,
        }))}
        value={code}
        onChange={setCode}
      />
      <ErrorBanner message={error} />
      <Button
        label="Continue"
        disabled={!code || submitting}
        onPress={() => {
          if (code) onComplete(code);
        }}
      />
      {adding ? (
        <>
          <SectionLabel>New currency</SectionLabel>
          <CurrencyForm
            error={currencyError}
            submitting={creatingCurrency}
            submitLabel="Add currency"
            onSubmit={onCreateCurrency}
          />
        </>
      ) : (
        <Button
          label="My currency is not listed"
          variant="secondary"
          onPress={() => onAddingChange(true)}
        />
      )}
    </Screen>
  );
}
