import {
  buildEntry,
  type TransactionEntry,
} from '@/features/ledger/application/transaction-use-cases';
import { isValidDate } from '@/features/ledger/domain/exchange-rate';
import { formatDecimal, parseDecimal } from '@/features/ledger/domain/money';
import { applySplit, splitProposalFor } from '@/features/split/application/split-service';
import { err, ok, type Result } from '@/shared/result';

import { addDays, laterDay, type Day } from '../domain/calendar';
import { planningError, type PlanningError } from '../domain/planning-error';
import {
  datesDue,
  MAX_ASK_DATES_PER_RUN,
  occurrenceFrom,
  validateRecurringFields,
  type Occurrence,
  type RecurringItem,
  type RecurringKind,
  type RecurringMode,
} from '../domain/recurring';
import type { Schedule } from '../domain/schedule';
import type { PlanningDeps, PlanningRepositories } from './ports';
import { localNoonOf, todayOf } from './recorded-movements';

export type RecurringInput = {
  readonly name: string;
  readonly kind: RecurringKind;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly amount: string;
  readonly categoryId: string | null;
  readonly schedule: Schedule;
  readonly mode: RecurringMode;
  readonly applySplit: boolean;
};

export type ConfirmEdits = {
  readonly amount?: string;
  readonly description?: string;
  readonly occurredOn?: Day;
};

export type MaterializeSummary = {
  readonly pending: number;
  readonly posted: number;
  /** Dates that could not even be stored. They run again next time. */
  readonly failed: number;
};

type ItemResult = Result<RecurringItem, PlanningError>;
type OccurrenceResult = Result<Occurrence, PlanningError>;
type WriteDeps = Pick<PlanningDeps, 'clock' | 'generateId'>;
type Outcome = 'pending' | 'posted' | 'existing';

const CAPPED_NOTE = `Only the latest ${MAX_ASK_DATES_PER_RUN} dates were added. Earlier dates were left out.`;

const notFound = (what: string) => err(planningError('not-found', `${what} not found.`));
const notPending = () =>
  err(planningError('occurrence-not-pending', 'This occurrence is no longer pending.'));

/** An edit may keep an account archived since, so an old item stays correctable. */
async function usableAccount(
  { accounts }: PlanningRepositories,
  id: string,
  existing: RecurringItem | null,
) {
  const account = await accounts.get(id);
  if (!account || account.systemRole !== null) return notFound('Account');
  const kept = existing?.accountId === id || existing?.toAccountId === id;
  if (account.archived && !kept) {
    return err(planningError('account-archived', `${account.name} is archived.`));
  }
  return ok(account);
}

async function buildItem(
  repositories: PlanningRepositories,
  input: RecurringInput,
  base: Pick<RecurringItem, 'id' | 'active' | 'materializedThrough'>,
  existing: RecurringItem | null,
): Promise<ItemResult> {
  const account = await usableAccount(repositories, input.accountId, existing);
  if (!account.ok) return account;
  const { currencyCode } = account.value;
  if (input.kind === 'transfer' && input.toAccountId) {
    const target = await usableAccount(repositories, input.toAccountId, existing);
    if (!target.ok) return target;
    if (target.value.currencyCode !== currencyCode) {
      return err(
        planningError('currency-mismatch', 'A recurring transfer needs accounts in one currency.'),
      );
    }
  }
  if (input.categoryId && input.kind !== 'transfer') {
    const category = await repositories.categories.get(input.categoryId);
    if (category?.kind !== input.kind) {
      return err(planningError('category-mismatch', `Choose an ${input.kind} category.`));
    }
  }
  const currency = await repositories.currencies.get(currencyCode);
  if (!currency) return notFound('Currency');
  const amount = parseDecimal(input.amount, currency.decimals);
  if (!amount.ok) return amount;
  return validateRecurringFields({ ...input, ...base, amount: amount.value, currencyCode });
}

function entryOf(occurrence: Occurrence, amount: string, occurredAt: string): TransactionEntry {
  const { kind, accountId, toAccountId, categoryId, description } = occurrence;
  if (kind === 'transfer') {
    return {
      kind,
      fromAccountId: accountId,
      toAccountId: toAccountId ?? '',
      amount,
      description,
      occurredAt,
    };
  }
  return { kind, accountId, amount, categoryId, description, occurredAt };
}

async function splitPosted(
  repositories: PlanningRepositories,
  { clock, generateId }: WriteDeps,
  transactionId: string,
): Promise<string | null> {
  const proposal = await splitProposalFor(repositories, transactionId);
  const structureId = proposal?.proposedStructureId;
  if (!structureId) return 'No default split structure, so this income was not split.';
  const applied = await applySplit(repositories, { clock, generateId }, { transactionId, structureId });
  return applied.ok ? null : `Could not split automatically: ${applied.error.message}`;
}

/**
 * Posts through the ledger's own validation. Takes the repositories of a running write. A refusal
 * happens before anything is written, and a refused split leaves the income posted with a note.
 */
async function postOccurrence(
  repositories: PlanningRepositories,
  deps: WriteDeps,
  occurrence: Occurrence,
  edits: ConfirmEdits = {},
): Promise<OccurrenceResult> {
  const currency = await repositories.currencies.get(occurrence.currencyCode);
  if (!currency) return notFound('Currency');
  const occurredOn = edits.occurredOn?.trim() || occurrence.dueOn;
  if (!isValidDate(occurredOn)) {
    return err(planningError('invalid-date', 'Enter a date as YYYY-MM-DD.'));
  }
  const amountText = edits.amount?.trim() || formatDecimal(occurrence.amount, currency.decimals);
  const amount = parseDecimal(amountText, currency.decimals);
  if (!amount.ok) return amount;

  const edited = {
    ...occurrence,
    amount: amount.value,
    description: edits.description?.trim() || occurrence.description,
  };
  const transaction = await buildEntry(
    repositories,
    entryOf(edited, amountText, localNoonOf(occurredOn)),
    { id: deps.generateId(), occurredAt: localNoonOf(occurredOn), existing: null },
  );
  if (!transaction.ok) return transaction;
  await repositories.journal.save(transaction.value);

  const note =
    edited.applySplit && edited.kind === 'income'
      ? await splitPosted(repositories, deps, transaction.value.id)
      : null;
  const posted: Occurrence = {
    ...edited,
    status: 'posted',
    transactionId: transaction.value.id,
    note,
  };
  await repositories.planning.saveOccurrence(posted);
  return ok(posted);
}

export function createRecurringUseCases({ store, clock, generateId }: PlanningDeps) {
  const deps = { clock, generateId };
  let materializing: Promise<MaterializeSummary> | null = null;

  /** One date, in one write. The unique key behind `findOccurrence` makes this repeatable. */
  async function materializeOne(
    item: RecurringItem,
    dueOn: Day,
    note: string | null,
  ): Promise<Outcome> {
    const occurrence = { ...occurrenceFrom(item, dueOn, generateId()), note };
    const holdWithNote = async (repositories: PlanningRepositories, reason: string) => {
      const note = `Could not post: ${reason}`;
      await repositories.planning.saveOccurrence({ ...occurrence, note });
    };
    try {
      return await store.atomic(async (repositories): Promise<Outcome> => {
        if (await repositories.planning.findOccurrence(item.id, dueOn)) return 'existing';
        if (item.mode === 'ask') {
          await repositories.planning.saveOccurrence(occurrence);
          return 'pending';
        }
        const posted = await postOccurrence(repositories, deps, occurrence);
        if (posted.ok) return 'posted';
        await holdWithNote(repositories, posted.error.message);
        return 'pending';
      });
    } catch (error) {
      // The failed write is gone whole, so this starts clean. In `ask` mode there is nothing to
      // hold on to: the same failure stops this write too, and the date runs again next time.
      if (item.mode === 'ask') throw error;
      return store.atomic(async (repositories): Promise<Outcome> => {
        if (await repositories.planning.findOccurrence(item.id, dueOn)) return 'existing';
        await holdWithNote(repositories, 'the write failed.');
        return 'pending';
      });
    }
  }

  /**
   * Returns how many steps failed. Later dates wait for a failed one and the marker stays on the
   * last date that exists, so nothing is lost and the projection never counts a date twice. Other
   * items are not held up. Only `ask` items are capped, see `datesDue`: an `auto` item only meets
   * this after days away, and `createItem` keeps it from a distant start.
   */
  async function materializeItem(
    item: RecurringItem,
    today: Day,
    created: { pending: number; posted: number },
  ): Promise<number> {
    const { dates, capped } = datesDue(item, today);
    try {
      for (const [index, dueOn] of dates.entries()) {
        const outcome = await materializeOne(item, dueOn, capped && index === 0 ? CAPPED_NOTE : null);
        if (outcome !== 'existing') created[outcome] += 1;
        await store.planning.markMaterialized(item.id, dueOn);
      }
      await store.planning.markMaterialized(item.id, today);
      return 0;
    } catch {
      return 1;
    }
  }

  async function runMaterialization(): Promise<MaterializeSummary> {
    const today = todayOf(clock);
    const items = (await store.planning.listItems()).filter(({ active }) => active);
    const summary = { pending: 0, posted: 0, failed: 0 };
    for (const item of items) {
      summary.failed += await materializeItem(item, today, summary);
    }
    return summary;
  }

  return {
    listItems: () => store.planning.listItems(),
    getItem: (id: string) => store.planning.getItem(id),
    listPendingOccurrences: () => store.planning.listPendingOccurrences(),
    listPostedNotes: () => store.planning.listPostedNotes(),
    getOccurrence: (id: string) => store.planning.getOccurrence(id),

    /** For app start and after saving an item. Overlapping callers share one run. */
    materializeDue: (): Promise<MaterializeSummary> => {
      materializing ??= runMaterialization().finally(() => {
        materializing = null;
      });
      return materializing;
    },

    /** An `auto` item only posts from today on: past dates of a new item are never real entries. */
    createItem: (input: RecurringInput): Promise<ItemResult> =>
      store.atomic(async (repositories) => {
        const today = todayOf(clock);
        const skipsPast = input.mode === 'auto' && input.schedule.startOn < today;
        const materializedThrough = skipsPast ? addDays(today, -1) : null;
        const base = { id: generateId(), active: true, materializedThrough };
        const item = await buildItem(repositories, input, base, null);
        if (item.ok) await repositories.planning.saveItem(item.value);
        return item;
      }),

    /** Occurrences hold their own copy, so only dates not yet materialized see this. */
    updateItem: (id: string, input: RecurringInput): Promise<ItemResult> =>
      store.atomic(async (repositories) => {
        const existing = await repositories.planning.getItem(id);
        if (!existing) return notFound('Recurring item');
        const { active, mode } = existing;
        const yesterday = addDays(todayOf(clock), -1);
        const materializedThrough =
          mode === 'ask' && input.mode === 'auto'
            ? laterDay(existing.materializedThrough ?? yesterday, yesterday)
            : existing.materializedThrough;
        const base = { id, active, materializedThrough };
        const item = await buildItem(repositories, input, base, existing);
        if (item.ok) await repositories.planning.saveItem(item.value);
        return item;
      }),

    /** Restoring moves the marker to yesterday, so only archived time stays gone, not today. */
    setItemActive: (id: string, active: boolean): Promise<Result<void, PlanningError>> =>
      store.atomic(async ({ planning }) => {
        const existing = await planning.getItem(id);
        if (!existing) return notFound('Recurring item');
        const yesterday = addDays(todayOf(clock), -1);
        const { materializedThrough } = existing;
        await planning.saveItem({
          ...existing,
          active,
          materializedThrough: active
            ? laterDay(materializedThrough ?? yesterday, yesterday)
            : materializedThrough,
        });
        return ok(undefined);
      }),

    confirmOccurrence: (id: string, edits: ConfirmEdits = {}): Promise<OccurrenceResult> =>
      store.atomic(async (repositories) => {
        const occurrence = await repositories.planning.getOccurrence(id);
        if (!occurrence) return notFound('Occurrence');
        if (occurrence.status !== 'pending') return notPending();
        return postOccurrence(repositories, deps, occurrence, edits);
      }),

    skipOccurrence: (id: string): Promise<Result<void, PlanningError>> =>
      store.atomic(async ({ planning }) => {
        const occurrence = await planning.getOccurrence(id);
        if (!occurrence) return notFound('Occurrence');
        if (occurrence.status !== 'pending') return notPending();
        await planning.saveOccurrence({ ...occurrence, status: 'skipped' });
        return ok(undefined);
      }),

    /** Only a posted note: a pending one explains what still needs doing. */
    dismissPostedNote: (id: string): Promise<Result<void, PlanningError>> =>
      store.atomic(async ({ planning }) => {
        const occurrence = await planning.getOccurrence(id);
        if (occurrence?.status !== 'posted') return notFound('Note');
        await planning.saveOccurrence({ ...occurrence, note: null });
        return ok(undefined);
      }),
  };
}
