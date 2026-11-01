import type { Currency } from '@/features/ledger/domain/currency';
import { isValidDate } from '@/features/ledger/domain/exchange-rate';
import { formatDecimal, formatDisplay } from '@/features/ledger/domain/money';

import type { BudgetInput } from '../application/budget-use-cases';
import type { RecurringInput } from '../application/recurring-use-cases';
import type { Budget, BudgetStatus } from '../domain/budget';
import { partsOf, type Day } from '../domain/calendar';
import type { FlowTotals } from '../domain/cash-flow';
import type { BudgetPeriod, PeriodKind } from '../domain/period';
import {
  MAX_ASK_DATES_PER_RUN,
  type Occurrence,
  type RecurringItem,
  type RecurringKind,
  type RecurringMode,
} from '../domain/recurring';
import type { Schedule, ScheduleUnit } from '../domain/schedule';

type Currencies = ReadonlyMap<string, Currency>;

const money = (minor: bigint, code: string, currencies: Currencies) => {
  const currency = currencies.get(code);
  return currency ? formatDisplay(minor, currency) : `${minor} ${code}`;
};

const SCALE = 1000n;

/** Exact on bigint, so 18 decimal amounts scale as well as cents. From 0 to 1. */
export function barFraction(value: bigint, limit: bigint): number {
  if (limit <= 0n) return 0;
  const size = value < 0n ? -value : value;
  if (size >= limit) return 1;
  return Number((size * SCALE) / limit) / Number(SCALE);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDay(day: Day): string {
  const { month, date } = partsOf(day);
  return `${MONTHS[month - 1]} ${date}`;
}

export function missingRatesLabel(codes: readonly string[]): string | null {
  return codes.length > 0 ? `No rate for ${codes.join(', ')}, so it is not included here.` : null;
}

export function budgetRow(status: BudgetStatus, currencies: Currencies) {
  const { budget, period, spent, available, remaining, missingRates } = status;
  const code = budget.currencyCode;
  const overspent = remaining < 0n;
  const left = overspent
    ? `${money(-remaining, code, currencies)} over`
    : `${money(remaining, code, currencies)} left`;
  return {
    key: budget.id,
    title: budget.name,
    subtitle: `${shortDay(period.startOn)} to ${shortDay(period.endOn)}. ${left}`,
    amount: `${money(spent, code, currencies)} of ${money(available, code, currencies)}`,
    fraction: barFraction(spent > 0n ? spent : 0n, available),
    overspent,
    warning:
      missingRates.length > 0
        ? `No rate for ${missingRates.join(', ')}, so spending in them is not counted.`
        : null,
  };
}

export function occurrencesLabel(count: number): string {
  return count === 1 ? '1 occurrence to confirm' : `${count} occurrences to confirm`;
}

export function occurrenceRow(occurrence: Occurrence, currencies: Currencies) {
  const { id, kind, amount, currencyCode, description, dueOn, note } = occurrence;
  return {
    key: id,
    title: description,
    subtitle: note ? `${dueOn}. ${note}` : dueOn,
    amount: money(kind === 'expense' ? -amount : amount, currencyCode, currencies),
  };
}

/** What a start date in the past does to a new item. */
export function pastStartNotice(
  { startOn, mode }: Pick<RecurringDraft, 'startOn' | 'mode'>,
  today: Day,
): string | null {
  const day = startOn.trim();
  if (!isValidDate(day) || day >= today) return null;
  return mode === 'auto'
    ? 'Dates before today will not be posted. Automatic posting starts today.'
    : `Dates before today wait for you to confirm. Only the latest ${MAX_ASK_DATES_PER_RUN} are added.`;
}

const UNIT_NAMES: Record<ScheduleUnit, string> = {
  day: 'day',
  week: 'week',
  month: 'month',
  year: 'year',
};

export function scheduleLabel({ unit, every, startOn, endOn, dayOfMonth }: Schedule): string {
  const name = UNIT_NAMES[unit];
  const repeat = every === 1 ? `Every ${name}` : `Every ${every} ${name}s`;
  const day = unit === 'month' ? ` on day ${dayOfMonth ?? partsOf(startOn).date}` : '';
  return `${repeat}${day}${endOn ? ` until ${endOn}` : ''}`;
}

export function firstNegativeLabel(day: Day | null): string {
  return day ? `Goes negative on ${day}.` : 'Stays positive through this horizon.';
}

export function flowTotalsLabel({ income, expense, net }: FlowTotals, currency: Currency): string {
  const show = (minor: bigint) => formatDisplay(minor, currency);
  return `In ${show(income)}, out ${show(expense)}, net ${show(net)}`;
}

/** Keeps the lowest balance of each bucket, so a dip below zero never drops out of the chart. */
export function bucketBalances(days: readonly Day[], balances: readonly bigint[], maxBars: number) {
  const size = Math.max(1, Math.ceil(days.length / maxBars));
  const bars: { day: Day; balance: bigint }[] = [];
  for (let start = 0; start < days.length; start += size) {
    const lowest = balances
      .slice(start, start + size)
      .reduce((first, second) => (second < first ? second : first));
    bars.push({ day: days[start], balance: lowest });
  }
  return bars;
}

export function toggled(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

const optionalNumber = (text: string): number | null =>
  text.trim() === '' ? null : Number(text.trim());

export type BudgetDraft = {
  readonly name: string;
  readonly currencyCode: string;
  readonly amount: string;
  readonly categoryIds: readonly string[];
  readonly periodKind: PeriodKind;
  readonly startDay: string;
  readonly startMonth: string;
  readonly customStartOn: string;
  readonly customLengthDays: string;
  readonly rollover: boolean;
};

export const emptyBudgetDraft = (currencyCode: string): BudgetDraft => ({
  name: '',
  currencyCode,
  amount: '',
  categoryIds: [],
  periodKind: 'monthly',
  startDay: '',
  startMonth: '',
  customStartOn: '',
  customLengthDays: '',
  rollover: false,
});

function periodOf(draft: BudgetDraft): BudgetPeriod {
  const startDay = optionalNumber(draft.startDay);
  switch (draft.periodKind) {
    case 'weekly':
    case 'monthly':
      return { kind: draft.periodKind, startDay };
    case 'yearly':
      return { kind: 'yearly', startMonth: optionalNumber(draft.startMonth), startDay };
    case 'custom':
      return {
        kind: 'custom',
        startOn: draft.customStartOn.trim(),
        lengthDays: Number(draft.customLengthDays.trim()),
      };
  }
}

export function toBudgetInput(draft: BudgetDraft): BudgetInput {
  const { name, currencyCode, amount, categoryIds, rollover } = draft;
  return { name, currencyCode, amount, categoryIds, rollover, period: periodOf(draft) };
}

const asText = (value: number | null) => (value === null ? '' : String(value));

export function toBudgetDraft(budget: Budget, currency: Currency): BudgetDraft {
  const { period } = budget;
  return {
    name: budget.name,
    currencyCode: budget.currencyCode,
    amount: formatDecimal(budget.amount, currency.decimals),
    categoryIds: budget.categoryIds,
    periodKind: period.kind,
    startDay: period.kind === 'custom' ? '' : asText(period.startDay),
    startMonth: period.kind === 'yearly' ? asText(period.startMonth) : '',
    customStartOn: period.kind === 'custom' ? period.startOn : '',
    customLengthDays: period.kind === 'custom' ? String(period.lengthDays) : '',
    rollover: budget.rollover,
  };
}

export type ScheduleDraft = {
  readonly unit: ScheduleUnit;
  readonly every: string;
  readonly dayOfMonth: string;
  readonly startOn: string;
  readonly endOn: string;
};

export const emptyScheduleDraft = (today: Day): ScheduleDraft => ({
  unit: 'month',
  every: '1',
  dayOfMonth: '',
  startOn: today,
  endOn: '',
});

export const toSchedule = (draft: ScheduleDraft): Schedule => ({
  unit: draft.unit,
  every: Number(draft.every.trim()),
  startOn: draft.startOn.trim(),
  endOn: draft.endOn.trim() || null,
  dayOfMonth: optionalNumber(draft.dayOfMonth),
});

export const toScheduleDraft = (schedule: Schedule): ScheduleDraft => ({
  unit: schedule.unit,
  every: String(schedule.every),
  dayOfMonth: asText(schedule.dayOfMonth),
  startOn: schedule.startOn,
  endOn: schedule.endOn ?? '',
});

export type RecurringDraft = ScheduleDraft & {
  readonly name: string;
  readonly kind: RecurringKind;
  readonly accountId: string;
  readonly toAccountId: string;
  readonly amount: string;
  readonly categoryId: string;
  readonly mode: RecurringMode;
  readonly applySplit: boolean;
};

export const emptyRecurringDraft = (today: Day, accountId: string): RecurringDraft => ({
  name: '',
  kind: 'expense',
  accountId,
  toAccountId: '',
  amount: '',
  categoryId: '',
  ...emptyScheduleDraft(today),
  mode: 'ask',
  applySplit: false,
});

export function toRecurringInput(draft: RecurringDraft): RecurringInput {
  const transfer = draft.kind === 'transfer';
  return {
    name: draft.name,
    kind: draft.kind,
    accountId: draft.accountId,
    toAccountId: transfer ? draft.toAccountId || null : null,
    amount: draft.amount,
    categoryId: transfer ? null : draft.categoryId || null,
    schedule: toSchedule(draft),
    mode: draft.mode,
    applySplit: draft.kind === 'income' && draft.applySplit,
  };
}

export function toRecurringDraft(item: RecurringItem, currency: Currency): RecurringDraft {
  return {
    name: item.name,
    kind: item.kind,
    accountId: item.accountId,
    toAccountId: item.toAccountId ?? '',
    amount: formatDecimal(item.amount, currency.decimals),
    categoryId: item.categoryId ?? '',
    ...toScheduleDraft(item.schedule),
    mode: item.mode,
    applySplit: item.applySplit,
  };
}
