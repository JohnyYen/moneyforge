import { useState, type ReactNode } from 'react';

import {
  AmountField,
  Button,
  ChoiceChips,
  ErrorBanner,
  Muted,
  Screen,
  TextField,
} from '@/shared/ui/primitives';

import type { AccountGroup } from '../../domain/account-group';
import type { Currency } from '../../domain/currency';
import {
  groupIdFromPicker,
  groupPickerOptions,
  lockedGroupType,
  pickerValueFor,
} from '../account-groups/group-model';
import { amountPreview } from '../amount-preview';

export type AccountFormValues = {
  name: string;
  type: string;
  currencyCode: string;
  openingBalance: string;
  archived: boolean;
  groupId: string | null;
};

export function AccountForm({
  header,
  initial,
  currencies,
  groups,
  typeSuggestions,
  error,
  submitting,
  onSubmit,
}: {
  header?: ReactNode;
  initial?: AccountFormValues;
  currencies: readonly Currency[];
  groups: readonly AccountGroup[];
  typeSuggestions: readonly string[];
  error: string | null;
  submitting: boolean;
  onSubmit: (values: AccountFormValues) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? '');
  const [currencyCode, setCurrencyCode] = useState(initial?.currencyCode ?? null);
  const [openingBalance, setOpeningBalance] = useState(initial?.openingBalance ?? '');
  const [groupId, setGroupId] = useState(initial?.groupId ?? null);
  const archived = initial?.archived ?? false;
  // A sub-account mirrors its group's type.
  const groupType = lockedGroupType(groupId, groups);
  const pickerOptions = groupPickerOptions(groups, initial?.groupId ?? null);

  const submit = (nextArchived: boolean) => {
    if (currencyCode) {
      onSubmit({
        name,
        type: groupType ?? type,
        currencyCode,
        openingBalance,
        archived: nextArchived,
        groupId,
      });
    }
  };

  return (
    <Screen>
      {header}
      <TextField label="Name" value={name} onChangeText={setName} autoFocus={!initial} />
      {pickerOptions.length > 1 ? (
        <ChoiceChips
          label="Group"
          options={pickerOptions}
          value={pickerValueFor(groupId)}
          onChange={(value) => setGroupId(groupIdFromPicker(value))}
        />
      ) : null}
      {groupType ? (
        <Muted>Type: {groupType}, from its group</Muted>
      ) : (
        <>
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
        </>
      )}
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
        preview={amountPreview(
          openingBalance,
          currencies.find(({ code }) => code === currencyCode),
          'any',
        )}
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
