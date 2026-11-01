import { useState } from 'react';

import {
  AmountField,
  Button,
  ChoiceChips,
  EmptyState,
  ErrorBanner,
  Muted,
  Screen,
  TextField,
} from '@/shared/ui/primitives';

import type { Account } from '../../domain/account';
import type { Category } from '../../domain/category';

export const ENTRY_KINDS = ['expense', 'income', 'transfer', 'conversion'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

const ENTRY_KIND_OPTIONS = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'conversion', label: 'Conversion' },
] as const;

export type EntryValues = {
  kind: EntryKind;
  accountId: string | null;
  toAccountId: string | null;
  categoryId: string | null;
  amount: string;
  targetAmount: string;
  rate: string;
  fee: string;
  feeCurrency: string | null;
  description: string;
  day: string;
};

function accountOptions(accounts: readonly Account[]) {
  return accounts.map((account) => ({
    value: account.id,
    label: `${account.name} (${account.currencyCode})`,
  }));
}

export function AddTransactionView({
  accounts,
  categories,
  initialAccountId,
  today,
  error,
  submitting,
  onSubmit,
}: {
  accounts: readonly Account[];
  categories: readonly Category[];
  initialAccountId: string | null;
  today: string;
  error: string | null;
  submitting: boolean;
  onSubmit: (values: EntryValues) => void;
}) {
  const [values, setValues] = useState<EntryValues>({
    kind: 'expense',
    accountId: initialAccountId ?? accounts[0]?.id ?? null,
    toAccountId: null,
    categoryId: null,
    amount: '',
    targetAmount: '',
    rate: '',
    fee: '',
    feeCurrency: null,
    description: '',
    day: today,
  });
  const set = <Key extends keyof EntryValues>(key: Key, value: EntryValues[Key]) =>
    setValues((current) => ({ ...current, [key]: value }));

  if (accounts.length === 0) {
    return (
      <Screen>
        <EmptyState title="No accounts yet" hint="Add an account before recording transactions." />
      </Screen>
    );
  }

  const { kind } = values;
  const source = accounts.find((account) => account.id === values.accountId);
  const destinations = accounts.filter((account) => {
    if (account.id === source?.id) return false;
    const sameCurrency = account.currencyCode === source?.currencyCode;
    return kind === 'transfer' ? sameCurrency : !sameCurrency;
  });
  const destination = destinations.find((account) => account.id === values.toAccountId);
  const moving = kind === 'transfer' || kind === 'conversion';
  const feeCurrencies = [source?.currencyCode, destination?.currencyCode].filter(
    (code): code is string => Boolean(code),
  );

  return (
    <Screen>
      <ChoiceChips
        options={ENTRY_KIND_OPTIONS}
        value={kind}
        onChange={(next) =>
          setValues((current) => ({ ...current, kind: next, categoryId: null, toAccountId: null }))
        }
      />
      <AmountField
        label={kind === 'conversion' ? 'You send' : 'Amount'}
        value={values.amount}
        onChangeText={(text) => set('amount', text)}
        autoFocus
      />
      <ChoiceChips
        label={moving ? 'From' : 'Account'}
        options={accountOptions(accounts)}
        value={values.accountId}
        onChange={(id) =>
          setValues((current) => ({ ...current, accountId: id, toAccountId: null, feeCurrency: null }))
        }
      />
      {moving ? (
        destinations.length > 0 ? (
          <ChoiceChips
            label="To"
            options={accountOptions(destinations)}
            value={values.toAccountId}
            onChange={(id) =>
              setValues((current) => ({ ...current, toAccountId: id, feeCurrency: null }))
            }
          />
        ) : (
          <Muted>
            {kind === 'transfer'
              ? 'No other account in this currency.'
              : 'No account in another currency.'}
          </Muted>
        )
      ) : null}
      {kind === 'conversion' ? (
        <>
          <TextField
            label={
              source && destination
                ? `Rate, ${destination.currencyCode} per 1 ${source.currencyCode}`
                : 'Rate'
            }
            value={values.rate}
            onChangeText={(text) => set('rate', text.replace(/,/g, '.'))}
            keyboardType="numeric"
          />
          <AmountField
            label="You receive (optional, calculated from the rate)"
            value={values.targetAmount}
            onChangeText={(text) => set('targetAmount', text)}
          />
        </>
      ) : null}
      {moving ? (
        <AmountField
          label="Fee (optional)"
          value={values.fee}
          onChangeText={(text) => set('fee', text)}
        />
      ) : null}
      {kind === 'conversion' && values.fee && feeCurrencies.length === 2 ? (
        <ChoiceChips
          label="Fee currency"
          options={feeCurrencies.map((code) => ({ value: code, label: code }))}
          value={values.feeCurrency ?? feeCurrencies[0]}
          onChange={(code) => set('feeCurrency', code)}
        />
      ) : null}
      {categories.length > 0 && !moving ? (
        <ChoiceChips
          label="Category"
          options={categories
            .filter((category) => category.kind === kind)
            .map((category) => ({ value: category.id, label: category.name }))}
          value={values.categoryId}
          onChange={(id) => set('categoryId', id)}
        />
      ) : null}
      <TextField
        label="Description (optional)"
        value={values.description}
        onChangeText={(text) => set('description', text)}
      />
      <TextField
        label="Date"
        value={values.day}
        onChangeText={(text) => set('day', text)}
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
      />
      <ErrorBanner message={error} />
      <Button
        label="Save"
        disabled={!values.amount || submitting || (moving && !destination)}
        onPress={() => onSubmit(values)}
      />
    </Screen>
  );
}
