import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import type { Account } from '@/features/ledger/domain/account';
import type { Category } from '@/features/ledger/domain/category';
import type { Currency } from '@/features/ledger/domain/currency';
import { formatDisplay } from '@/features/ledger/domain/money';
import { useLedger } from '@/features/ledger/ui/ledger-context';
import { err } from '@/shared/result';
import { leaveScreen } from '@/shared/ui/leave-screen';
import {
  AmountField,
  Button,
  ChoiceChips,
  EmptyState,
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

import type { ItemDetails } from '../application/inbox-use-cases';
import { isResolved, type InboxItem } from '../domain/inbox-item';
import { isTransferKind } from '../domain/rule';
import { useRules } from './rules-context';
import { useApproveItem, type Approval } from './use-approve-item';
import {
  itemFormFor,
  KIND_LABELS,
  KIND_OPTIONS,
  needsCounterAmount,
  toItemDraft,
  type ItemForm,
} from './rules-model';

const NONE = '';

const incomplete = () => err({ message: 'Complete the item first.' });

function ExtractedRows({ item }: { item: InboxItem }) {
  const rows = [
    ['Reference', item.reference],
    ['Counterparty', item.counterparty],
    ['Balance', item.balance],
  ] as const;
  return (
    <>
      {rows.map(([title, value]) =>
        value ? <ListRow key={title} title={title} trailing={value} /> : null,
      )}
    </>
  );
}

function PartnerRow({
  partner,
  currencies,
}: {
  partner: InboxItem;
  currencies: readonly Currency[];
}) {
  const currency = currencies.find(({ code }) => code === partner.currencyCode);
  return (
    <ListRow
      title={partner.kind ? KIND_LABELS[partner.kind] : 'Other message'}
      subtitle="Paired message"
      trailing={
        partner.amountMinor !== null && currency
          ? formatDisplay(partner.amountMinor, currency)
          : undefined
      }
    />
  );
}

function ReviewForm({
  details,
  accounts,
  categories,
  currencies,
  overdue,
  error,
  submitting,
  onApprove,
  onSave,
  onReject,
  onCreateRule,
}: {
  details: ItemDetails;
  accounts: readonly Account[];
  categories: readonly Category[];
  currencies: readonly Currency[];
  overdue: boolean;
  error: string | null;
  submitting: boolean;
  onApprove: (approval: Approval) => void;
  onSave: (form: ItemForm) => void;
  onReject: () => void;
  onCreateRule: () => void;
}) {
  const { item, partner } = details;
  const [initial] = useState(() => itemFormFor(item, currencies));
  const [form, setForm] = useState(initial);
  const [counterAmount, setCounterAmount] = useState('');
  const update = (change: Partial<ItemForm>) => setForm((current) => ({ ...current, ...change }));

  const transfer = form.kind !== null && isTransferKind(form.kind);
  const accountOptions = accounts
    .filter(({ archived, id }) => !archived || id === item.accountId)
    .map(({ id, name, currencyCode }) => ({ value: id, label: `${name} (${currencyCode})` }));
  const categoryOptions = categories
    .filter(({ kind, archived, id }) => kind === form.kind && (!archived || id === item.categoryId))
    .map(({ id, name }) => ({ value: id, label: name }));
  const draft = toItemDraft(form);
  const askCounterAmount = needsCounterAmount(form, partner !== null, accounts);

  return (
    <Screen>
      {item.note ? <Notice>{item.note}</Notice> : null}
      {overdue ? (
        <Notice>
          The other side of this transfer never arrived. Post it on its own or reject it.
        </Notice>
      ) : null}
      {item.status === 'waiting_pair' && !overdue ? (
        <Muted>Waiting for the other side of this transfer.</Muted>
      ) : null}
      {item.body ? (
        <>
          <SectionLabel>Message</SectionLabel>
          <Muted>{item.body}</Muted>
        </>
      ) : null}
      <ExtractedRows item={item} />
      {partner ? <PartnerRow partner={partner} currencies={currencies} /> : null}
      <SectionLabel>Transaction</SectionLabel>
      <ChoiceChips
        label="Type"
        options={KIND_OPTIONS}
        value={form.kind}
        onChange={(kind) => update({ kind, categoryId: null })}
      />
      <ChoiceChips
        label={transfer ? 'Account in this message' : 'Account'}
        options={accountOptions}
        value={form.accountId}
        onChange={(accountId) => update({ accountId })}
      />
      {transfer ? (
        <ChoiceChips
          label="Other account"
          options={accountOptions}
          value={form.counterpartAccountId}
          onChange={(counterpartAccountId) => update({ counterpartAccountId })}
        />
      ) : (
        <ChoiceChips
          label="Category"
          options={[{ value: NONE, label: 'None' }, ...categoryOptions]}
          value={form.categoryId ?? NONE}
          onChange={(categoryId) => update({ categoryId: categoryId || null })}
        />
      )}
      <AmountField
        label="Amount"
        value={form.amount}
        onChangeText={(amount) => update({ amount })}
      />
      {askCounterAmount ? (
        <AmountField
          label="Amount on the other account"
          value={counterAmount}
          onChangeText={setCounterAmount}
        />
      ) : null}
      <TextField
        label="Description"
        value={form.description}
        onChangeText={(description) => update({ description })}
      />
      <ErrorBanner message={error} />
      <Button
        label={transfer && !partner ? 'Post this side alone' : 'Approve'}
        disabled={submitting || !draft}
        onPress={() =>
          onApprove({
            form,
            counterAmount,
            changed: JSON.stringify(form) !== JSON.stringify(initial),
          })
        }
      />
      <Button
        label="Save changes"
        variant="secondary"
        disabled={submitting || !draft}
        onPress={() => onSave(form)}
      />
      <Button label="Reject" variant="secondary" disabled={submitting} onPress={onReject} />
      {item.body ? (
        <Button
          label="Create a rule"
          variant="secondary"
          disabled={submitting}
          onPress={onCreateRule}
        />
      ) : null}
    </Screen>
  );
}

export function ItemReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ledger = useLedger();
  const rules = useRules();
  const router = useRouter();

  const load = useCallback(async () => {
    const [details, sections, accounts, categories, currencies] = await Promise.all([
      rules.getItem(id),
      rules.listInbox(),
      ledger.listAccounts(),
      ledger.listCategories(),
      ledger.listCurrencies(),
    ]);
    const overdue =
      details?.item.status === 'waiting_pair' &&
      sections.review.some((item) => item.id === details.item.id);
    return { details, overdue, accounts, categories, currencies };
  }, [id, ledger, rules]);
  const { state, reload } = useFocusQuery(load);

  const exit = () => leaveScreen(router);
  const exits = { exitsOnSuccess: true };
  const save = useSubmit(
    async (form: ItemForm) => {
      const draft = toItemDraft(form);
      return draft ? rules.editItem(id, draft) : incomplete();
    },
    exit,
    exits,
  );
  const approve = useApproveItem(id, exit);
  const reject = useSubmit(() => rules.rejectItem(id), exit, exits);
  const dismiss = useSubmit(() => rules.dismissSplit(id), exit, exits);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ details, overdue, accounts, categories, currencies }) => {
        if (!details) {
          return (
            <Screen>
              <EmptyState title="Message not found" hint="It may have been purged." />
            </Screen>
          );
        }
        const { item } = details;
        if (item.status === 'posted' && item.splitRequested && item.transactionId) {
          const transactionId = item.transactionId;
          return (
            <Screen>
              {item.note ? <Notice>{item.note}</Notice> : null}
              <Muted>This income is recorded and can be split.</Muted>
              <ErrorBanner message={dismiss.error} />
              <Button
                label="Split income"
                onPress={() =>
                  router.push({
                    pathname: '/split/apply/[transactionId]',
                    params: { transactionId },
                  })
                }
              />
              <Button
                label="Not this time"
                variant="secondary"
                disabled={dismiss.submitting}
                onPress={() => void dismiss.submit(undefined)}
              />
            </Screen>
          );
        }
        if (isResolved(item)) {
          return (
            <Screen>
              <EmptyState
                title={item.status === 'posted' ? 'Posted to your ledger' : 'Rejected'}
              />
            </Screen>
          );
        }
        return (
          <ReviewForm
            key={item.id}
            details={details}
            accounts={accounts}
            categories={categories}
            currencies={currencies}
            overdue={overdue}
            error={approve.error ?? save.error ?? reject.error}
            submitting={approve.submitting || save.submitting || reject.submitting}
            onApprove={(approval) => void approve.submit(approval)}
            onSave={(form) => void save.submit(form)}
            onReject={() => void reject.submit(undefined)}
            onCreateRule={() =>
              router.push({
                pathname: '/rules/new',
                params: { sourceId: item.sourceId, itemId: item.id },
              })
            }
          />
        );
      }}
    </QueryBoundary>
  );
}
