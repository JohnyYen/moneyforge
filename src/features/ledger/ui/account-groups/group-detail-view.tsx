import { useState } from 'react';

import {
  AmountField,
  Button,
  ChoiceChips,
  EmptyState,
  ErrorBanner,
  ListRow,
  Muted,
  Notice,
  Screen,
  SectionLabel,
  Title,
} from '@/shared/ui/primitives';

import type { SubAccountInput } from '../../application/account-group-use-cases';
import type { Currency } from '../../domain/currency';
import type { AccountRowModel } from '../accounts/accounts-list-model';
import { amountPreview } from '../amount-preview';
import type { GroupDetailModel } from './group-model';

export function GroupDetailView({
  model,
  error,
  submitting,
  onOpenAccount,
  onAddSubAccount,
  onEdit,
  onSetArchived,
}: {
  model: GroupDetailModel;
  error: string | null;
  submitting: boolean;
  onOpenAccount: (id: string) => void;
  onAddSubAccount: (input: SubAccountInput) => void;
  onEdit: () => void;
  onSetArchived: (archived: boolean) => void;
}) {
  const renderRow = (row: AccountRowModel) => (
    <ListRow
      key={row.id}
      title={row.title}
      subtitle={row.subtitle}
      trailing={row.trailing}
      onPress={() => onOpenAccount(row.id)}
    />
  );
  const available = model.availableCurrencies;

  return (
    <Screen>
      <Muted>
        {model.title} · {model.subtitle}
      </Muted>
      {model.total ? <Title>{model.total}</Title> : null}
      {model.archivedNotice ? <Notice>{model.archivedNotice}</Notice> : null}
      {model.note ? <Notice>{model.note}</Notice> : null}
      <ErrorBanner message={error} />
      <SectionLabel>Accounts</SectionLabel>
      {model.accounts.length === 0 ? <EmptyState title="No active accounts" /> : null}
      {model.accounts.map(renderRow)}
      {model.archived ? null : (
        <>
          <SectionLabel>Add a currency</SectionLabel>
          {available.length === 0 ? (
            <Muted>Every currency already has an account in this group.</Muted>
          ) : (
            // Remounts when a currency is added, which clears the fields.
            <AddSubAccountFields
              key={available.map(({ code }) => code).join(',')}
              currencies={available}
              submitting={submitting}
              onSubmit={onAddSubAccount}
            />
          )}
        </>
      )}
      <Button label="Edit group" variant="secondary" onPress={onEdit} />
      <Button
        label={model.archived ? 'Restore group' : 'Archive group'}
        variant="secondary"
        disabled={submitting}
        onPress={() => onSetArchived(!model.archived)}
      />
      {model.archivedAccounts.length > 0 ? <SectionLabel>Archived</SectionLabel> : null}
      {model.archivedAccounts.map(renderRow)}
    </Screen>
  );
}

function AddSubAccountFields({
  currencies,
  submitting,
  onSubmit,
}: {
  currencies: readonly Currency[];
  submitting: boolean;
  onSubmit: (input: SubAccountInput) => void;
}) {
  const [currencyCode, setCurrencyCode] = useState<string | null>(null);
  const [openingBalance, setOpeningBalance] = useState('');

  return (
    <>
      <ChoiceChips
        label="Currency"
        options={currencies.map(({ code }) => ({ value: code, label: code }))}
        value={currencyCode}
        onChange={setCurrencyCode}
      />
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
      <Button
        label="Add currency"
        disabled={!currencyCode || submitting}
        onPress={() => currencyCode && onSubmit({ currencyCode, openingBalance })}
      />
    </>
  );
}
