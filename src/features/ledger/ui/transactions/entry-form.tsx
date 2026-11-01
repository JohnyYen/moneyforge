import { useState, type ReactNode } from 'react';

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
import type { Currency } from '../../domain/currency';
import { amountPreview, ratePreview, receivedPreview } from '../amount-preview';
import type { EntryValues } from './entry-values';

const ENTRY_KIND_OPTIONS = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'conversion', label: 'Conversion' },
] as const;

function accountOptions(accounts: readonly Account[]) {
  return accounts.map((account) => ({
    value: account.id,
    label: `${account.name} (${account.currencyCode})`,
  }));
}

export function EntryForm({
  accounts,
  categories,
  currencies,
  initial,
  error,
  submitting,
  submitLabel = 'Save',
  footer,
  onSubmit,
  onDelete,
}: {
  accounts: readonly Account[];
  categories: readonly Category[];
  currencies: readonly Currency[];
  initial: EntryValues;
  error: string | null;
  submitting: boolean;
  submitLabel?: string;
  footer?: ReactNode;
  onSubmit: (values: EntryValues) => void;
  onDelete?: () => void;
}) {
  const [values, setValues] = useState(initial);
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
  const feeCurrencyCode = values.feeCurrency ?? feeCurrencies[0];
  const currencyOf = (code: string | undefined) =>
    currencies.find((currency) => currency.code === code);

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
        preview={amountPreview(values.amount, currencyOf(source?.currencyCode))}
        autoFocus={!onDelete}
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
          <AmountField
            label={
              source && destination
                ? `Rate, ${destination.currencyCode} per 1 ${source.currencyCode}`
                : 'Rate'
            }
            value={values.rate}
            onChangeText={(text) => set('rate', text)}
            preview={ratePreview(values.rate, source?.currencyCode, destination?.currencyCode)}
          />
          <AmountField
            label="You receive (optional, calculated from the rate)"
            value={values.targetAmount}
            onChangeText={(text) => set('targetAmount', text)}
            preview={receivedPreview({
              received: values.targetAmount,
              sent: values.amount,
              rate: values.rate,
              source: currencyOf(source?.currencyCode),
              target: currencyOf(destination?.currencyCode),
            })}
          />
        </>
      ) : null}
      {moving ? (
        <AmountField
          label="Fee (optional)"
          value={values.fee}
          onChangeText={(text) => set('fee', text)}
          preview={amountPreview(values.fee, currencyOf(feeCurrencyCode), 'non-negative')}
        />
      ) : null}
      {kind === 'conversion' && values.fee && feeCurrencies.length === 2 ? (
        <ChoiceChips
          label="Fee currency"
          options={feeCurrencies.map((code) => ({ value: code, label: code }))}
          value={feeCurrencyCode}
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
        label={submitLabel}
        disabled={!values.amount || submitting || (moving && !destination)}
        onPress={() => onSubmit(values)}
      />
      {onDelete ? (
        <Button
          label="Delete transaction"
          variant="secondary"
          disabled={submitting}
          onPress={onDelete}
        />
      ) : null}
      {footer}
    </Screen>
  );
}
