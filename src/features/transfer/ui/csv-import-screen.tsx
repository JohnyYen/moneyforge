import { useCallback, useState } from 'react';

import { useLedger } from '@/features/ledger/ui/ledger-context';
import { err } from '@/shared/result';
import {
  Button,
  ChoiceChips,
  EmptyState,
  ErrorBanner,
  Muted,
  Notice,
  QueryBoundary,
  Screen,
  SectionLabel,
  TextField,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { CsvPreview } from '../application/transfer-service';
import { useTransfer } from './transfer-context';
import {
  columnChoices,
  DATE_OPTIONS,
  emptyCsvDraft,
  failureLines,
  NUMBER_OPTIONS,
  previewLines,
  reportLabel,
  SEPARATOR_OPTIONS,
  toCsvInput,
  undoLines,
  type CsvDraft,
} from './transfer-model';

const NONE = { value: '', label: 'None' };

export function CsvImportScreen() {
  const ledger = useLedger();
  const transfer = useTransfer();
  const load = useCallback(async () => {
    const [balances, categories] = await Promise.all([
      ledger.accountBalancesForDisplay(),
      ledger.listCategories(),
    ]);
    return {
      accounts: balances.map(({ account }) => account).filter(({ archived }) => !archived),
      categories: categories.filter(({ archived }) => !archived),
    };
  }, [ledger]);
  const { state, reload } = useFocusQuery(load);
  const [draft, setDraft] = useState<CsvDraft>(() => ({
    ...emptyCsvDraft,
    text: transfer.takeSharedCsv() ?? '',
  }));
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [undone, setUndone] = useState<readonly string[]>([]);
  /** Outlives edits to the form, which only change the next import. */
  const [batchId, setBatchId] = useState<string | null>(null);

  /** Any change leaves the preview behind, so what is confirmed is always what was shown. */
  const change = (patch: Partial<CsvDraft>) => {
    setDraft({ ...draft, ...patch });
    setPreview(null);
    setReport(null);
  };

  const check = useSubmit(async (current: CsvDraft) => {
    const input = toCsvInput(current);
    return input.ok ? transfer.previewCsv(input.value) : err(input.error);
  }, setPreview);
  const commit = useSubmit(
    async (current: CsvDraft) => {
      const input = toCsvInput(current);
      return input.ok ? transfer.importCsv(input.value) : err(input.error);
    },
    (done) => {
      setReport(reportLabel(done));
      setPreview(null);
      setBatchId(done.batchId);
      setUndone([]);
    },
  );
  const undo = useSubmit(
    (batch: string) => transfer.undoImport(batch),
    (done) => {
      setBatchId(null);
      setReport(null);
      setUndone(undoLines(done));
    },
  );

  const columns = columnChoices(draft);
  const optional = [NONE, ...columns];

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ accounts, categories }) => {
        if (accounts.length === 0) {
          return (
            <Screen>
              <EmptyState title="No accounts yet" hint="Add an account to import into." />
            </Screen>
          );
        }
        const fallbackOptions = (kind: 'income' | 'expense') => [
          NONE,
          ...categories
            .filter((category) => category.kind === kind)
            .map(({ id, name }) => ({ value: id, label: name })),
        ];
        return (
          <Screen>
            <Muted>
              Nothing is written until you confirm the preview. Importing the same file again adds
              nothing.
            </Muted>
            <TextField
              label="CSV text"
              multiline
              value={draft.text}
              onChangeText={(text) => change({ text })}
            />
            <ChoiceChips
              label="Account"
              options={accounts.map(({ id, name }) => ({ value: id, label: name }))}
              value={draft.accountId}
              onChange={(accountId) => change({ accountId })}
            />
            <ChoiceChips
              label="Separator"
              options={SEPARATOR_OPTIONS}
              value={draft.separator}
              onChange={(separator) => change({ separator })}
            />
            <ChoiceChips
              label="First row"
              options={[
                { value: 'header', label: 'Column names' },
                { value: 'data', label: 'A transaction' },
              ]}
              value={draft.hasHeader ? 'header' : 'data'}
              onChange={(first) => change({ hasHeader: first === 'header' })}
            />

            <SectionLabel>Columns</SectionLabel>
            {columns.length === 0 ? <Muted>Paste a file to choose its columns.</Muted> : null}
            <ChoiceChips
              label="Date"
              options={columns}
              value={draft.dateColumn}
              onChange={(dateColumn) => change({ dateColumn })}
            />
            <ChoiceChips
              label="Description"
              options={optional}
              value={draft.descriptionColumn}
              onChange={(descriptionColumn) => change({ descriptionColumn })}
            />
            <ChoiceChips
              label="Category"
              options={optional}
              value={draft.categoryColumn}
              onChange={(categoryColumn) => change({ categoryColumn })}
            />
            <ChoiceChips
              label="Currency"
              options={optional}
              value={draft.currencyColumn}
              onChange={(currencyColumn) => change({ currencyColumn })}
            />
            <ChoiceChips
              label="Amounts are in"
              options={[
                { value: 'single', label: 'One column' },
                { value: 'split', label: 'Debit and credit' },
              ]}
              value={draft.amountMode}
              onChange={(amountMode) => change({ amountMode })}
            />
            {draft.amountMode === 'single' ? (
              <>
                <ChoiceChips
                  label="Amount"
                  options={columns}
                  value={draft.amountColumn}
                  onChange={(amountColumn) => change({ amountColumn })}
                />
                <ChoiceChips
                  label="A positive amount is"
                  options={[
                    { value: 'income', label: 'Money in' },
                    { value: 'expense', label: 'Money out' },
                  ]}
                  value={draft.positive}
                  onChange={(positive) => change({ positive })}
                />
              </>
            ) : (
              <>
                <ChoiceChips
                  label="Debit, money out"
                  options={columns}
                  value={draft.debitColumn}
                  onChange={(debitColumn) => change({ debitColumn })}
                />
                <ChoiceChips
                  label="Credit, money in"
                  options={columns}
                  value={draft.creditColumn}
                  onChange={(creditColumn) => change({ creditColumn })}
                />
              </>
            )}

            <SectionLabel>Formats</SectionLabel>
            <ChoiceChips
              label="Dates"
              options={DATE_OPTIONS}
              value={draft.dateFormat}
              onChange={(dateFormat) => change({ dateFormat })}
            />
            <ChoiceChips
              label="Numbers"
              options={NUMBER_OPTIONS}
              value={draft.numberFormat}
              onChange={(numberFormat) => change({ numberFormat })}
            />

            <SectionLabel>Categories not found</SectionLabel>
            <ChoiceChips
              label="Rows with an unknown category"
              options={[
                { value: 'fallback', label: 'Use a fallback' },
                { value: 'create', label: 'Create them' },
              ]}
              value={draft.unknown}
              onChange={(unknown) => change({ unknown })}
            />
            {draft.unknown === 'fallback' ? (
              <>
                <ChoiceChips
                  label="Fallback for money in"
                  options={fallbackOptions('income')}
                  value={draft.fallbackIncome}
                  onChange={(fallbackIncome) => change({ fallbackIncome })}
                />
                <ChoiceChips
                  label="Fallback for money out"
                  options={fallbackOptions('expense')}
                  value={draft.fallbackExpense}
                  onChange={(fallbackExpense) => change({ fallbackExpense })}
                />
              </>
            ) : null}

            <ErrorBanner message={check.error ?? commit.error ?? undo.error} />
            {report ? <Notice>{report}</Notice> : null}
            {undone.map((line) => (
              <Muted key={line}>{line}</Muted>
            ))}
            {batchId ? (
              <Button
                label="Undo this import"
                variant="secondary"
                disabled={undo.submitting}
                onPress={() => void undo.submit(batchId)}
              />
            ) : null}
            <Button
              label="Preview"
              variant={preview ? 'secondary' : 'primary'}
              disabled={check.submitting || !draft.text.trim()}
              onPress={() => void check.submit(draft)}
            />
            {preview ? (
              <>
                <SectionLabel>Preview</SectionLabel>
                <Notice>
                  {`${preview.valid} to import, ${preview.duplicates} already imported, ${preview.invalid.length} invalid.`}
                </Notice>
                {previewLines(preview).map((line, index) => (
                  <Muted key={index}>{line}</Muted>
                ))}
                {preview.newCategories.length > 0 ? (
                  <Muted>
                    {`New categories: ${preview.newCategories.map(({ name }) => name).join(', ')}.`}
                  </Muted>
                ) : null}
                {failureLines(preview.invalid).map((line) => (
                  <Muted key={line}>{line}</Muted>
                ))}
                <Button
                  label={`Import ${preview.valid} rows`}
                  disabled={commit.submitting || preview.valid === 0}
                  onPress={() => void commit.submit(draft)}
                />
              </>
            ) : null}
          </Screen>
        );
      }}
    </QueryBoundary>
  );
}
