import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { toLocalDay } from '@/features/ledger/application/overview-use-cases';
import type { Account } from '@/features/ledger/domain/account';
import type { Category } from '@/features/ledger/domain/category';
import { useLedger } from '@/features/ledger/ui/ledger-context';
import { leaveScreen } from '@/shared/ui/leave-screen';
import {
  AmountField,
  Button,
  ChoiceChips,
  EmptyState,
  ErrorBanner,
  Muted,
  Notice,
  QueryBoundary,
  Screen,
  TextField,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { RecurringKind, RecurringMode } from '../domain/recurring';
import type { ScheduleUnit } from '../domain/schedule';
import {
  emptyRecurringDraft,
  pastStartNotice,
  toRecurringDraft,
  toRecurringInput,
  type RecurringDraft,
} from './plan-model';
import { usePlanning } from './planning-context';

const KIND_OPTIONS: readonly { value: RecurringKind; label: string }[] = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
  { value: 'transfer', label: 'Transfer' },
];

const UNIT_OPTIONS: readonly { value: ScheduleUnit; label: string }[] = [
  { value: 'day', label: 'Days' },
  { value: 'week', label: 'Weeks' },
  { value: 'month', label: 'Months' },
  { value: 'year', label: 'Years' },
];

const MODE_OPTIONS: readonly { value: RecurringMode; label: string }[] = [
  { value: 'ask', label: 'Ask me first' },
  { value: 'auto', label: 'Post automatically' },
];

const ON_OFF = [
  { value: 'off', label: 'No' },
  { value: 'on', label: 'Yes' },
] as const;

const NO_CATEGORY = 'none';

function RecurringForm({
  initial,
  accounts,
  categories,
  error,
  submitting,
  onSubmit,
  archiveLabel,
  onArchive,
}: {
  initial: RecurringDraft;
  accounts: readonly Account[];
  categories: readonly Category[];
  error: string | null;
  submitting: boolean;
  onSubmit: (draft: RecurringDraft) => void;
  archiveLabel?: string;
  onArchive?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const update = (change: Partial<RecurringDraft>) =>
    setDraft((current) => ({ ...current, ...change }));
  const accountOptions = accounts.map(({ id, name, currencyCode }) => ({
    value: id,
    label: `${name} (${currencyCode})`,
  }));
  const categoryOptions = [
    { value: NO_CATEGORY, label: 'None' },
    ...categories
      .filter(({ kind }) => kind === draft.kind)
      .map(({ id, name }) => ({ value: id, label: name })),
  ];
  const notice = onArchive ? null : pastStartNotice(draft, toLocalDay(new Date()));

  return (
    <Screen>
      <TextField label="Name" value={draft.name} onChangeText={(name) => update({ name })} />
      <ChoiceChips
        label="Type"
        options={KIND_OPTIONS}
        value={draft.kind}
        onChange={(kind) => update({ kind, categoryId: '' })}
      />
      <ChoiceChips
        label={draft.kind === 'transfer' ? 'From account' : 'Account'}
        options={accountOptions}
        value={draft.accountId}
        onChange={(accountId) => update({ accountId })}
      />
      {draft.kind === 'transfer' ? (
        <ChoiceChips
          label="To account"
          options={accountOptions}
          value={draft.toAccountId}
          onChange={(toAccountId) => update({ toAccountId })}
        />
      ) : (
        <ChoiceChips
          label="Category"
          options={categoryOptions}
          value={draft.categoryId || NO_CATEGORY}
          onChange={(value) => update({ categoryId: value === NO_CATEGORY ? '' : value })}
        />
      )}
      <AmountField
        label="Amount"
        value={draft.amount}
        onChangeText={(amount) => update({ amount })}
      />
      <TextField
        label="Repeat every"
        keyboardType="numeric"
        value={draft.every}
        onChangeText={(every) => update({ every })}
      />
      <ChoiceChips
        options={UNIT_OPTIONS}
        value={draft.unit}
        onChange={(unit) => update({ unit })}
      />
      {draft.unit === 'month' ? (
        <TextField
          label="Day of the month (optional)"
          keyboardType="numeric"
          value={draft.dayOfMonth}
          onChangeText={(dayOfMonth) => update({ dayOfMonth })}
        />
      ) : null}
      <TextField
        label="Start date, YYYY-MM-DD"
        value={draft.startOn}
        onChangeText={(startOn) => update({ startOn })}
      />
      <TextField
        label="End date, YYYY-MM-DD (optional)"
        value={draft.endOn}
        onChangeText={(endOn) => update({ endOn })}
      />
      <ChoiceChips
        label="When a date arrives"
        options={MODE_OPTIONS}
        value={draft.mode}
        onChange={(mode) => update({ mode })}
      />
      {notice ? <Notice>{notice}</Notice> : null}
      {draft.kind === 'income' ? (
        <>
          <ChoiceChips
            label="Apply the proposed split"
            options={ON_OFF}
            value={draft.applySplit ? 'on' : 'off'}
            onChange={(value) => update({ applySplit: value === 'on' })}
          />
          <Muted>Uses the default structure for this category or account.</Muted>
        </>
      ) : null}
      <ErrorBanner message={error} />
      <Button label="Save" disabled={submitting} onPress={() => onSubmit(draft)} />
      {onArchive && archiveLabel ? (
        <Button
          label={archiveLabel}
          variant="secondary"
          disabled={submitting}
          onPress={onArchive}
        />
      ) : null}
    </Screen>
  );
}

export function RecurringEditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const planning = usePlanning();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    const [accounts, categories, currencies, item] = await Promise.all([
      ledger.listAccounts(),
      ledger.listCategories(),
      ledger.listCurrencies(),
      id ? planning.getItem(id) : null,
    ]);
    const used = new Set([item?.accountId, item?.toAccountId]);
    return {
      item,
      currency: currencies.find(({ code }) => code === item?.currencyCode),
      accounts: accounts.filter((account) => !account.archived || used.has(account.id)),
      categories: categories.filter(
        (category) => !category.archived || category.id === item?.categoryId,
      ),
    };
  }, [id, ledger, planning]);
  const { state, reload } = useFocusQuery(load);

  const exit = () => leaveScreen(router);
  // Saved first, so a date already due shows up as soon as this screen closes.
  const save = useSubmit(
    (draft: RecurringDraft) =>
      id
        ? planning.updateItem(id, toRecurringInput(draft))
        : planning.createItem(toRecurringInput(draft)),
    async () => {
      await planning.materializeDue();
      exit();
    },
    { exitsOnSuccess: true },
  );
  const setActive = useSubmit((active: boolean) => planning.setItemActive(id ?? '', active), exit, {
    exitsOnSuccess: true,
  });

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ item, currency, accounts, categories }) => {
        if (id && (!item || !currency)) {
          return (
            <Screen>
              <EmptyState title="Recurring item not found" />
            </Screen>
          );
        }
        if (accounts.length === 0) {
          return (
            <Screen>
              <EmptyState title="No accounts yet" hint="Add an account first." />
            </Screen>
          );
        }
        return (
          <RecurringForm
            initial={
              item && currency
                ? toRecurringDraft(item, currency)
                : emptyRecurringDraft(toLocalDay(new Date()), accounts[0].id)
            }
            accounts={accounts}
            categories={categories}
            error={save.error ?? setActive.error}
            submitting={save.submitting || setActive.submitting}
            onSubmit={(draft) => void save.submit(draft)}
            archiveLabel={item?.active ? 'Archive item' : 'Restore item'}
            onArchive={item ? () => void setActive.submit(!item.active) : undefined}
          />
        );
      }}
    </QueryBoundary>
  );
}
