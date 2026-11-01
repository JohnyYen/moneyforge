import {
  Button,
  EmptyState,
  ListRow,
  Muted,
  Screen,
  SectionLabel,
} from '@/shared/ui/primitives';

import type { Currency } from '../../domain/currency';
import { CurrencyForm } from './currency-form';

export type CurrencyEditing = { mode: 'closed' } | { mode: 'new' } | { mode: 'edit'; currency: Currency };

export function CurrenciesView({
  currencies,
  baseCode,
  editing,
  error,
  submitting,
  onEdit,
  onAdd,
  onSubmit,
  onSetBase,
}: {
  currencies: readonly Currency[];
  baseCode: string | null;
  editing: CurrencyEditing;
  error: string | null;
  submitting: boolean;
  onEdit: (currency: Currency) => void;
  onAdd: () => void;
  onSubmit: (currency: Currency) => void;
  onSetBase: (code: string) => void;
}) {
  const editingCurrency = editing.mode === 'edit' ? editing.currency : undefined;
  return (
    <Screen>
      {editing.mode === 'closed' ? (
        <Button label="Add currency" onPress={onAdd} />
      ) : (
        <>
          <SectionLabel>{editingCurrency ? `Edit ${editingCurrency.code}` : 'New currency'}</SectionLabel>
          <CurrencyForm
            key={editingCurrency?.code ?? 'new'}
            initial={editingCurrency}
            error={error}
            submitting={submitting}
            submitLabel="Save currency"
            onSubmit={onSubmit}
          />
          {editingCurrency && editingCurrency.code !== baseCode ? (
            <Button
              label="Use as base currency"
              variant="secondary"
              onPress={() => onSetBase(editingCurrency.code)}
            />
          ) : null}
        </>
      )}
      <SectionLabel>Currencies</SectionLabel>
      {currencies.length === 0 ? <EmptyState title="No currencies yet" /> : null}
      {currencies.map((currency) => (
        <ListRow
          key={currency.code}
          title={currency.code === baseCode ? `${currency.code} (base)` : currency.code}
          subtitle={`${currency.name} · ${currency.decimals} decimals`}
          trailing={currency.symbol}
          onPress={() => onEdit(currency)}
        />
      ))}
      <Muted>Decimals are locked once a currency has entries.</Muted>
    </Screen>
  );
}
