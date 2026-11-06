import { useRef, useState, type ReactNode } from 'react';

import {
  AmountField,
  Button,
  ChoiceChips,
  ErrorBanner,
  Screen,
  SectionLabel,
  TextField,
} from '@/shared/ui/primitives';

import type { SubAccountInput } from '../../application/account-group-use-cases';
import type { Currency } from '../../domain/currency';
import { amountPreview } from '../amount-preview';
import { validateGroupForm, type GroupCurrencyRow } from './group-model';

export type GroupFormSubmit = { name: string; type: string; currencies: SubAccountInput[] };

/**
 * Creates a multi-currency account, or, with `initial`, renames and retypes one. Currencies are
 * only chosen on creation; later ones are added from the group's screen.
 */
export function GroupForm({
  header,
  initial,
  currencies,
  typeSuggestions,
  error,
  submitting,
  onSubmit,
}: {
  header?: ReactNode;
  initial?: { name: string; type: string };
  currencies: readonly Currency[];
  typeSuggestions: readonly string[];
  error: string | null;
  submitting: boolean;
  onSubmit: (values: GroupFormSubmit) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? '');
  const nextKey = useRef(1);
  const [rows, setRows] = useState<GroupCurrencyRow[]>([
    { key: '0', currencyCode: null, openingBalance: '' },
  ]);
  const [formError, setFormError] = useState<string | null>(null);

  const updateRow = (key: string, change: Partial<GroupCurrencyRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const addRow = () =>
    setRows((current) => [
      ...current,
      { key: String(nextKey.current++), currencyCode: null, openingBalance: '' },
    ]);
  const removeRow = (key: string) => setRows((current) => current.filter((row) => row.key !== key));

  const submit = () => {
    if (initial) {
      setFormError(null);
      onSubmit({ name, type, currencies: [] });
      return;
    }
    const checked = validateGroupForm({ name, type, rows });
    setFormError(checked.ok ? null : checked.error);
    if (checked.ok) onSubmit(checked.value);
  };

  return (
    <Screen>
      {header}
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Bank X"
        autoFocus={!initial}
      />
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
        <>
          <SectionLabel>Currencies</SectionLabel>
          {rows.map((row, index) => (
            <CurrencyRowFields
              key={row.key}
              index={index}
              row={row}
              currencies={currencies}
              canRemove={rows.length > 1}
              onChange={(change) => updateRow(row.key, change)}
              onRemove={() => removeRow(row.key)}
            />
          ))}
          <Button label="Add another currency" variant="secondary" onPress={addRow} />
        </>
      )}
      <ErrorBanner message={formError ?? error} />
      <Button
        label={initial ? 'Save group' : 'Save account'}
        disabled={submitting}
        onPress={submit}
      />
    </Screen>
  );
}

function CurrencyRowFields({
  index,
  row,
  currencies,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  row: GroupCurrencyRow;
  currencies: readonly Currency[];
  canRemove: boolean;
  onChange: (change: Partial<GroupCurrencyRow>) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <ChoiceChips
        label={`Currency ${index + 1}`}
        options={currencies.map(({ code }) => ({ value: code, label: code }))}
        value={row.currencyCode}
        onChange={(currencyCode) => onChange({ currencyCode })}
      />
      <AmountField
        label="Opening balance"
        value={row.openingBalance}
        onChangeText={(openingBalance) => onChange({ openingBalance })}
        preview={amountPreview(
          row.openingBalance,
          currencies.find(({ code }) => code === row.currencyCode),
          'any',
        )}
        placeholder="0"
      />
      {canRemove ? (
        <Button label={`Remove currency ${index + 1}`} variant="secondary" onPress={onRemove} />
      ) : null}
    </>
  );
}
