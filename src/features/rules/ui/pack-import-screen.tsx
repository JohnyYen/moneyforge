import { useCallback, useState } from 'react';

import { useLedger } from '@/features/ledger/ui/ledger-context';
import {
  Button,
  ChoiceChips,
  ErrorBanner,
  ListRow,
  Muted,
  Notice,
  QueryBoundary,
  Screen,
  SectionLabel,
  TextField,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { PackPreview } from '../application/rule-pack-use-cases';
import { useRules } from './rules-context';

const NO_CATEGORY = { value: '', label: 'No category' };

export function PackImportScreen() {
  const ledger = useLedger();
  const rules = useRules();
  const load = useCallback(async () => {
    const [balances, categories] = await Promise.all([
      ledger.accountBalances(),
      ledger.listCategories(),
    ]);
    return {
      accounts: balances.map(({ account }) => account).filter(({ archived }) => !archived),
      categories: categories.filter(({ archived }) => !archived),
    };
  }, [ledger]);
  const { state, reload } = useFocusQuery(load);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<PackPreview | null>(null);
  const [accounts, setAccounts] = useState<ReadonlyMap<string, string>>(new Map());
  const [categories, setCategories] = useState<ReadonlyMap<string, string>>(new Map());
  const [report, setReport] = useState<string | null>(null);

  const check = useSubmit((pack: string) => rules.previewRulePack(pack), (value) => {
    setPreview(value);
    setAccounts(new Map());
    setCategories(new Map());
    setReport(null);
  });
  const commit = useSubmit(
    () => rules.importRulePack({ text, accounts, categories }),
    (done) => {
      setPreview(null);
      setReport(`Added ${done.sources} sources and ${done.rules} rules. Skipped ${done.skipped}.`);
    },
  );

  const edit = (value: string) => {
    setText(value);
    setPreview(null);
    setReport(null);
  };
  const withSlot = (map: ReadonlyMap<string, string>, slot: string, id: string) =>
    new Map(map).set(slot, id);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {(lookups) => (
        <Screen>
          <Notice>
            A pack comes from someone else, so nothing is saved until you confirm. Imported rules
            never post by themselves, and income from them asks before splitting.
          </Notice>
          <TextField label="Pack text" multiline value={text} onChangeText={edit} />
          <ErrorBanner message={check.error ?? commit.error} />
          {report ? <Notice>{report}</Notice> : null}
          <Button
            label="Check pack"
            variant={preview ? 'secondary' : 'primary'}
            disabled={check.submitting || !text.trim()}
            onPress={() => void check.submit(text)}
          />
          {preview ? (
            <>
              <SectionLabel>{preview.name}</SectionLabel>
              {preview.description ? <Muted>{preview.description}</Muted> : null}
              <Muted>Messages from these senders will be saved once you confirm.</Muted>
              {preview.sources.map(({ name, sender, isNew, newRules, knownRules }) => (
                <ListRow
                  key={sender}
                  title={name}
                  subtitle={`${sender}. ${newRules} new rules, ${knownRules} already here.`}
                  trailing={isNew ? 'New' : undefined}
                />
              ))}
              <SectionLabel>Your accounts</SectionLabel>
              {preview.slots.accounts.map((slot) => (
                <ChoiceChips
                  key={slot}
                  label={slot}
                  options={lookups.accounts.map(({ id, name }) => ({ value: id, label: name }))}
                  value={accounts.get(slot) ?? null}
                  onChange={(id) => setAccounts(withSlot(accounts, slot, id))}
                />
              ))}
              {preview.slots.categories.length > 0 ? (
                <SectionLabel>Your categories</SectionLabel>
              ) : null}
              {preview.slots.categories.map(({ name: slot, kind }) => (
                <ChoiceChips
                  key={slot}
                  label={slot}
                  options={[
                    NO_CATEGORY,
                    ...lookups.categories
                      .filter((category) => category.kind === kind)
                      .map(({ id, name }) => ({ value: id, label: name })),
                  ]}
                  value={categories.get(slot) ?? ''}
                  onChange={(id) => setCategories(withSlot(categories, slot, id))}
                />
              ))}
              <Button
                label="Confirm import"
                disabled={
                  commit.submitting ||
                  preview.slots.accounts.some((slot) => !accounts.has(slot))
                }
                onPress={() => void commit.submit(undefined)}
              />
            </>
          ) : null}
        </Screen>
      )}
    </QueryBoundary>
  );
}
