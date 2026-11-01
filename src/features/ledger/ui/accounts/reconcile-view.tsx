import { useState } from 'react';

import {
  AmountField,
  Button,
  ErrorBanner,
  Muted,
  Screen,
  Title,
} from '@/shared/ui/primitives';

import type { Currency } from '../../domain/currency';
import { formatDisplay, parseDecimal } from '../../domain/money';
import { amountPreview } from '../amount-preview';

export function ReconcileView({
  accountName,
  currency,
  balance,
  error,
  submitting,
  onSubmit,
}: {
  accountName: string;
  currency: Currency;
  balance: bigint;
  error: string | null;
  submitting: boolean;
  onSubmit: (countedBalance: string) => void;
}) {
  const [counted, setCounted] = useState('');
  const parsed = counted ? parseDecimal(counted, currency.decimals) : null;
  const difference = parsed?.ok ? parsed.value - balance : null;

  return (
    <Screen>
      <Muted>{accountName}, balance in MoneyForge</Muted>
      <Title>{formatDisplay(balance, currency)}</Title>
      <AmountField
        label="Actual balance"
        value={counted}
        onChangeText={setCounted}
        preview={amountPreview(counted, currency)}
        autoFocus
      />
      {difference !== null ? (
        <Muted>
          {difference === 0n
            ? 'Already matches. Nothing will be recorded.'
            : `An adjustment of ${formatDisplay(difference, currency)} will be recorded.`}
        </Muted>
      ) : null}
      <ErrorBanner message={error} />
      <Button
        label="Reconcile"
        disabled={!counted || submitting}
        onPress={() => onSubmit(counted)}
      />
    </Screen>
  );
}
