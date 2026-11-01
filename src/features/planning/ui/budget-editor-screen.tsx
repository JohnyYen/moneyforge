import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import type { Category } from '@/features/ledger/domain/category';
import type { Currency } from '@/features/ledger/domain/currency';
import { useLedger } from '@/features/ledger/ui/ledger-context';
import { leaveScreen } from '@/shared/ui/leave-screen';
import {
  AmountField,
  Button,
  ChoiceChips,
  EmptyState,
  ErrorBanner,
  Muted,
  QueryBoundary,
  Screen,
  TextField,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import { PERIOD_KINDS, type PeriodKind } from '../domain/period';
import {
  emptyBudgetDraft,
  toBudgetDraft,
  toBudgetInput,
  toggled,
  type BudgetDraft,
} from './plan-model';
import { ToggleChips } from './plan-visuals';
import { usePlanning } from './planning-context';

const PERIOD_LABELS: Record<PeriodKind, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
  custom: 'Custom',
};

const START_DAY_HINTS: Partial<Record<PeriodKind, string>> = {
  weekly: 'Start day, Monday 1 to Sunday 7 (optional)',
  monthly: 'Start day of the month (optional)',
  yearly: 'Start day (optional)',
};

const ON_OFF = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' },
] as const;

function BudgetForm({
  initial,
  currencies,
  categories,
  error,
  submitting,
  onSubmit,
  archiveLabel,
  onArchive,
}: {
  initial: BudgetDraft;
  currencies: readonly Currency[];
  categories: readonly Category[];
  error: string | null;
  submitting: boolean;
  onSubmit: (draft: BudgetDraft) => void;
  archiveLabel?: string;
  onArchive?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const update = (change: Partial<BudgetDraft>) =>
    setDraft((current) => ({ ...current, ...change }));
  const startDayHint = START_DAY_HINTS[draft.periodKind];

  return (
    <Screen>
      <TextField label="Name" value={draft.name} onChangeText={(name) => update({ name })} />
      <ChoiceChips
        label="Currency"
        options={currencies.map(({ code }) => ({ value: code, label: code }))}
        value={draft.currencyCode}
        onChange={(currencyCode) => update({ currencyCode })}
      />
      <AmountField
        label="Amount per period"
        value={draft.amount}
        onChangeText={(amount) => update({ amount })}
      />
      <ToggleChips
        label="Categories"
        options={categories.map(({ id, name, kind }) => ({
          value: id,
          label: kind === 'income' ? `${name} (refunds)` : name,
        }))}
        values={draft.categoryIds}
        onToggle={(id) =>
          setDraft((current) => ({ ...current, categoryIds: toggled(current.categoryIds, id) }))
        }
      />
      <Muted>Income in a category here counts as a refund, which lowers spending.</Muted>
      <ChoiceChips
        label="Period"
        options={PERIOD_KINDS.map((value) => ({ value, label: PERIOD_LABELS[value] }))}
        value={draft.periodKind}
        onChange={(periodKind) => update({ periodKind })}
      />
      {draft.periodKind === 'yearly' ? (
        <TextField
          label="Start month, 1 to 12 (optional)"
          keyboardType="numeric"
          value={draft.startMonth}
          onChangeText={(startMonth) => update({ startMonth })}
        />
      ) : null}
      {startDayHint ? (
        <TextField
          label={startDayHint}
          keyboardType="numeric"
          value={draft.startDay}
          onChangeText={(startDay) => update({ startDay })}
        />
      ) : null}
      {draft.periodKind === 'custom' ? (
        <>
          <TextField
            label="First day, YYYY-MM-DD"
            value={draft.customStartOn}
            onChangeText={(customStartOn) => update({ customStartOn })}
          />
          <TextField
            label="Length in days"
            keyboardType="numeric"
            value={draft.customLengthDays}
            onChangeText={(customLengthDays) => update({ customLengthDays })}
          />
        </>
      ) : null}
      <ChoiceChips
        label="Rollover"
        options={ON_OFF}
        value={draft.rollover ? 'on' : 'off'}
        onChange={(value) => update({ rollover: value === 'on' })}
      />
      <Muted>With rollover, what is left or overspent carries into the next period.</Muted>
      {onArchive ? (
        <Muted>Changing the amount, period, or rollover starts the carry again from zero.</Muted>
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

export function BudgetEditorScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const planning = usePlanning();
  const ledger = useLedger();
  const router = useRouter();
  const load = useCallback(async () => {
    const [currencies, categories, base, budget] = await Promise.all([
      ledger.listCurrencies(),
      ledger.listCategories(),
      ledger.getBaseCurrency(),
      id ? planning.getBudget(id) : null,
    ]);
    const chosen = new Set(budget?.categoryIds);
    return {
      budget,
      base,
      currencies,
      categories: categories.filter(
        ({ id: categoryId, archived }) => !archived || chosen.has(categoryId),
      ),
    };
  }, [id, ledger, planning]);
  const { state, reload } = useFocusQuery(load);

  const exit = () => leaveScreen(router);
  const save = useSubmit(
    (draft: BudgetDraft) =>
      id
        ? planning.updateBudget(id, toBudgetInput(draft))
        : planning.createBudget(toBudgetInput(draft)),
    exit,
    { exitsOnSuccess: true },
  );
  const setActive = useSubmit((active: boolean) => planning.setBudgetActive(id ?? '', active), exit, {
    exitsOnSuccess: true,
  });

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ budget, base, currencies, categories }) => {
        const currency = currencies.find(({ code }) => code === budget?.currencyCode);
        if (id && (!budget || !currency)) {
          return (
            <Screen>
              <EmptyState title="Budget not found" />
            </Screen>
          );
        }
        return (
          <BudgetForm
            initial={
              budget && currency
                ? toBudgetDraft(budget, currency)
                : emptyBudgetDraft(base?.code ?? '')
            }
            currencies={currencies}
            categories={categories}
            error={save.error ?? setActive.error}
            submitting={save.submitting || setActive.submitting}
            onSubmit={(draft) => void save.submit(draft)}
            archiveLabel={budget?.active ? 'Archive budget' : 'Restore budget'}
            onArchive={budget ? () => void setActive.submit(!budget.active) : undefined}
          />
        );
      }}
    </QueryBoundary>
  );
}
