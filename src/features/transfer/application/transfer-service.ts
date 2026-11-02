import { buildEntry } from '@/features/ledger/application/transaction-use-cases';
import { toLocalDay } from '@/features/ledger/application/overview-use-cases';
import { isValidDate } from '@/features/ledger/domain/exchange-rate';
import { formatDecimal } from '@/features/ledger/domain/money';
import { foldCase } from '@/features/rules/domain/message';
import { err, ok, type Result } from '@/shared/result';

import { parseCsv, writeCsv, type CsvRow, type CsvSeparator } from '../domain/csv';
import { CSV_HEADER, exportRows } from '../domain/csv-export';
import {
  readRow,
  rowFingerprint,
  rowIdentity,
  type CsvMapping,
  type ImportRow,
  type RowKind,
} from '../domain/csv-import';
import { transferError, type TransferError } from '../domain/transfer-error';
import type { TransferDeps, TransferRepositories } from './ports';

/** Android refuses an intent past about 1 MB, and two bytes hold each character. */
export const MAX_EXPORT_CHARS = 200_000;
const MAX_NEW_CATEGORIES = 100;
/** Noon, like every other date-only entry: it exists on every day under daylight saving. */
const NOON = 12;

export type UnknownCategories =
  | { readonly action: 'create' }
  /** Empty leaves the row with no category. */
  | { readonly action: 'fallback'; readonly income: string | null; readonly expense: string | null };

export type CsvImportInput = {
  readonly text: string;
  readonly separator: CsvSeparator;
  readonly hasHeader: boolean;
  readonly accountId: string;
  readonly mapping: CsvMapping;
  readonly unknownCategories: UnknownCategories;
};

export type RowFailure = { readonly line: number; readonly reason: string };
export type NewCategory = { readonly name: string; readonly kind: RowKind };

export type CsvPreview = {
  readonly valid: number;
  readonly duplicates: number;
  readonly invalid: readonly RowFailure[];
  readonly newCategories: readonly NewCategory[];
};

export type CsvReport = {
  readonly imported: number;
  readonly duplicates: number;
  readonly invalid: readonly RowFailure[];
};

export type CsvExportInput = {
  readonly accountId: string | null;
  /** `YYYY-MM-DD`, or empty for no limit. */
  readonly from: string;
  readonly to: string;
};

type PlannedRow = {
  readonly row: ImportRow;
  readonly fingerprint: string;
  /** A category id, a key into `newCategories`, or nothing. */
  readonly category:
    | { readonly id: string }
    | { readonly create: string }
    | null;
};

type Plan = {
  readonly accountId: string;
  readonly decimals: number;
  readonly rows: readonly PlannedRow[];
  readonly duplicates: number;
  readonly invalid: readonly RowFailure[];
  readonly newCategories: ReadonlyMap<string, NewCategory>;
};

/** Thrown inside a write, because a returned error commits what the batch already wrote. */
class BatchRefused extends Error {}

const categoryKey = (kind: RowKind, name: string) => `${kind}\0${foldCase(name)}`;

function checkMapping(mapping: CsvMapping, columns: number): Result<void, TransferError> {
  const { amount, date, description, category } = mapping;
  const amounts = amount.mode === 'single' ? [amount.column] : [amount.debit, amount.credit];
  const named = [date, ...amounts];
  const used = [...named, description, category].filter((column) => column !== null);
  if (used.some((column) => !Number.isInteger(column) || column < 0 || column >= columns)) {
    return err(transferError('invalid-mapping', 'Choose columns that exist in this file.'));
  }
  if (new Set(used).size !== used.length) {
    return err(transferError('invalid-mapping', 'Use each column for one thing only.'));
  }
  return ok(undefined);
}

function categoryResolver(
  repositoryCategories: Awaited<ReturnType<TransferRepositories['categories']['list']>>,
  policy: UnknownCategories,
) {
  const named = new Map<string, typeof repositoryCategories>();
  for (const category of repositoryCategories) {
    const key = categoryKey(category.kind, category.name);
    named.set(key, [...(named.get(key) ?? []), category]);
  }
  const newCategories = new Map<string, NewCategory>();

  const resolve = (row: ImportRow): Result<PlannedRow['category'], string> => {
    const fallback =
      policy.action === 'fallback' && (row.kind === 'income' ? policy.income : policy.expense);
    const unknown = fallback ? { id: fallback } : null;
    if (!row.category) return ok(unknown);
    const key = categoryKey(row.kind, row.category);
    const matches = named.get(key) ?? [];
    const active = matches.filter(({ archived }) => !archived);
    if (active.length > 1) return err(`Two categories share the name ${row.category}.`);
    if (active.length === 1) return ok({ id: active[0].id });
    if (matches.length > 0) return err(`${row.category} is archived.`);
    if (policy.action !== 'create') return ok(unknown);
    if (!newCategories.has(key)) {
      if (newCategories.size >= MAX_NEW_CATEGORIES) {
        return err(`One import can create up to ${MAX_NEW_CATEGORIES} categories.`);
      }
      newCategories.set(key, { name: row.category, kind: row.kind });
    }
    return ok({ create: key });
  };

  return { resolve, newCategories };
}

/** Only reads, so a preview can show exactly what the write would do. */
async function planImport(
  repositories: TransferRepositories,
  input: CsvImportInput,
  parsed: readonly CsvRow[],
  secret: string,
): Promise<Result<Plan, TransferError>> {
  const { accountId, hasHeader, mapping, unknownCategories } = input;
  const account = await repositories.accounts.get(accountId);
  if (!account || account.systemRole !== null) {
    return err(transferError('not-found', 'Account not found.'));
  }
  if (account.archived) {
    return err(transferError('account-archived', `${account.name} is archived.`));
  }
  const currency = await repositories.currencies.get(account.currencyCode);
  if (!currency) return err(transferError('not-found', `Unknown currency ${account.currencyCode}.`));
  const columns = parsed[0]?.cells.length ?? 0;
  const checked = checkMapping(mapping, columns);
  if (!checked.ok) return checked;

  const { resolve, newCategories } = categoryResolver(
    await repositories.categories.list(),
    unknownCategories,
  );
  const invalid: RowFailure[] = [];
  const candidates: PlannedRow[] = [];
  const repeats = new Map<string, number>();
  for (const csvRow of parsed.slice(hasHeader ? 1 : 0)) {
    const row = readRow(csvRow, mapping, columns, currency.decimals);
    const category = row.ok ? resolve(row.value) : row;
    if (!row.ok || !category.ok) {
      const reason = category.ok ? 'This row cannot be read.' : category.error;
      invalid.push({ line: csvRow.line, reason });
      continue;
    }
    const identity = rowIdentity(accountId, row.value);
    const repeat = repeats.get(identity) ?? 0;
    repeats.set(identity, repeat + 1);
    const fingerprint = rowFingerprint(accountId, row.value, repeat, secret);
    candidates.push({ row: row.value, fingerprint, category: category.value });
  }

  const known = await repositories.importedRows.findKnown(
    candidates.map(({ fingerprint }) => fingerprint),
  );
  const rows = candidates.filter(({ fingerprint }) => !known.has(fingerprint));
  // A category only a duplicate named would be created for nothing.
  const wanted = new Set(
    rows.flatMap(({ category }) => (category && 'create' in category ? [category.create] : [])),
  );
  return ok({
    accountId,
    decimals: currency.decimals,
    rows,
    duplicates: candidates.length - rows.length,
    invalid,
    newCategories: new Map([...newCategories].filter(([key]) => wanted.has(key))),
  });
}

async function writePlan(
  repositories: TransferRepositories,
  { accountId, decimals, rows, newCategories }: Plan,
  generateId: () => string,
): Promise<void> {
  const created = new Map<string, string>();
  for (const [key, { name, kind }] of newCategories) {
    const id = generateId();
    await repositories.categories.save({ id, name, kind, parentId: null, archived: false });
    created.set(key, id);
  }
  for (const { row, fingerprint, category } of rows) {
    const [year, month, date] = row.day.split('-').map(Number);
    const occurredAt = new Date(year, month - 1, date, NOON).toISOString();
    const transaction = await buildEntry(
      repositories,
      {
        kind: row.kind,
        accountId,
        amount: formatDecimal(row.minor, decimals),
        description: row.description,
        occurredAt,
        categoryId: !category
          ? null
          : 'id' in category
            ? category.id
            : (created.get(category.create) ?? null),
      },
      { id: generateId(), occurredAt, existing: null },
    );
    if (!transaction.ok) throw new BatchRefused(transaction.error.message);
    await repositories.journal.save(transaction.value);
    await repositories.importedRows.save(fingerprint, transaction.value.id);
  }
}

const previewOf = ({ rows, duplicates, invalid, newCategories }: Plan): CsvPreview => ({
  valid: rows.length,
  duplicates,
  invalid,
  newCategories: [...newCategories.values()],
});

function dayBound(day: string, endOfDay: boolean): string {
  const [year, month, date] = day.split('-').map(Number);
  const moment = endOfDay
    ? new Date(year, month - 1, date, 23, 59, 59, 999)
    : new Date(year, month - 1, date);
  return moment.toISOString();
}

export function createTransferService({ store, generateId, loadSecret }: TransferDeps) {
  // Kept in memory only, like a shared message: a route param would outlive the import.
  let sharedCsv: string | null = null;

  return {
    holdSharedCsv: (text: string) => {
      sharedCsv = text;
    },

    takeSharedCsv: () => {
      const text = sharedCsv;
      sharedCsv = null;
      return text;
    },

    previewCsv: async (input: CsvImportInput): Promise<Result<CsvPreview, TransferError>> => {
      const parsed = parseCsv(input.text, input.separator);
      if (!parsed.ok) return parsed;
      const plan = await planImport(store, input, parsed.value, await loadSecret());
      return plan.ok ? ok(previewOf(plan.value)) : plan;
    },

    /**
     * One atomic batch of the valid rows: a failure while writing leaves nothing behind, so a
     * retry never meets half a file. Duplicate and invalid rows are skipped and reported, as the
     * preview showed. Income posted here runs no split, like any other past entry.
     */
    importCsv: async (input: CsvImportInput): Promise<Result<CsvReport, TransferError>> => {
      const parsed = parseCsv(input.text, input.separator);
      if (!parsed.ok) return parsed;
      const secret = await loadSecret();
      try {
        return await store.atomic(async (repositories) => {
          const plan = await planImport(repositories, input, parsed.value, secret);
          if (!plan.ok) return plan;
          await writePlan(repositories, plan.value, generateId);
          const { rows, duplicates, invalid } = plan.value;
          return ok({ imported: rows.length, duplicates, invalid });
        });
      } catch (error) {
        if (!(error instanceof BatchRefused)) throw error;
        const message = `Nothing was imported. ${error.message}`;
        return err(transferError('import-failed', message));
      }
    },

    exportCsv: async ({
      accountId,
      from,
      to,
    }: CsvExportInput): Promise<Result<{ csv: string; rows: number }, TransferError>> => {
      const range = (message: string) => err(transferError('invalid-range', message));
      if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
        return range('Enter dates as YYYY-MM-DD.');
      }
      if (from && to && from > to) return range('The range ends before it starts.');
      const [transactions, accounts, categories, currencies] = await Promise.all([
        store.journal.list({
          accountId: accountId ?? undefined,
          from: from ? dayBound(from, false) : undefined,
          to: to ? dayBound(to, true) : undefined,
        }),
        store.accounts.listUser(),
        store.categories.list(),
        store.currencies.list(),
      ]);
      const rows = exportRows([...transactions].reverse(), accountId, {
        accounts,
        categories,
        currencies,
        dayOf: (occurredAt) => toLocalDay(new Date(occurredAt)),
      });
      const csv = writeCsv([[...CSV_HEADER], ...rows]);
      if (csv.length > MAX_EXPORT_CHARS) {
        return err(transferError('too-large', 'Too much to share at once. Choose a shorter range.'));
      }
      return ok({ csv, rows: rows.length });
    },
  };
}

export type TransferService = ReturnType<typeof createTransferService>;
