import type { Account } from '@/features/ledger/domain/account';
import type { Currency } from '@/features/ledger/domain/currency';

import type { IngestResult } from '../application/ingest-message';
import type { InboxItem } from '../domain/inbox-item';
import type { Rule } from '../domain/rule';
import {
  emptyItemForm,
  emptyRuleDraft,
  ingestResultLabel,
  inboxLabel,
  itemFormFor,
  itemRow,
  needsCounterAmount,
  ruleDraftFor,
  ruleDraftFromItem,
  sampleResults,
  settingsDraftFor,
  templateCopyWarning,
  templateProblem,
  toItemDraft,
  toRuleInput,
  toSettings,
} from './rules-model';

const usd: Currency = { code: 'USD', name: 'Dollar', decimals: 2, symbol: '$', kind: 'fiat' };
const eur: Currency = { code: 'EUR', name: 'Euro', decimals: 2, symbol: 'E', kind: 'fiat' };

const account = (id: string, currencyCode = 'USD'): Account => ({
  id,
  name: `Account ${id}`,
  type: 'Bank',
  currencyCode,
  openingBalance: 0n,
  archived: false,
  systemRole: null,
});

const lookups = { accounts: [account('a'), account('b'), account('e', 'EUR')], currencies: [usd, eur] };

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: 'i1',
  sourceId: 's1',
  ruleId: null,
  status: 'proposed',
  channel: 'sms',
  receivedAt: '2026-03-10T12:00:00.000Z',
  body: 'Paid 10',
  bodyHash: 'hash',
  referenceKey: null,
  note: null,
  kind: 'expense',
  accountId: 'a',
  categoryId: null,
  counterpartAccountId: null,
  amountMinor: 1050n,
  currencyCode: 'USD',
  reference: null,
  counterparty: null,
  balance: null,
  description: 'Shop',
  autoPost: false,
  splitMode: 'none',
  splitStructureId: null,
  splitRequested: false,
  pairItemId: null,
  transactionId: null,
  ...over,
});

describe('templateCopyWarning', () => {
  const message = 'Paid 10.50 USD at Acme Hardware Store. Card 1234';

  it('warns when the template still holds the message', () => {
    expect(templateCopyWarning(message, message)).toContain('Acme Hardware Store');
  });

  it('warns about values left in fixed text', () => {
    expect(templateCopyWarning('Paid {amount} USD at {counterparty}. Card 1234', message)).toContain(
      'Card 1234',
    );
  });

  it('accepts short wording shared with the message', () => {
    expect(templateCopyWarning('Paid {amount} USD at {counterparty}. Card {*}', message)).toBeNull();
  });

  it('accepts fixed text that is not in the message, or no message at all', () => {
    expect(templateCopyWarning('Spent 1234 {amount} on stuff in the store', message)).toBeNull();
    expect(templateCopyWarning(message, null)).toBeNull();
  });
});

describe('rule draft', () => {
  const ready = {
    ...emptyRuleDraft('s1'),
    name: 'Pay',
    priority: '5',
    template: 'Paid {amount} at {counterparty}',
    accountId: 'a',
  };

  it('starts with nothing that could post by itself', () => {
    expect(emptyRuleDraft('s1')).toMatchObject({ autoPost: false, splitMode: 'none', kind: 'expense' });
  });

  it('round-trips a rule', () => {
    const input = toRuleInput({ ...ready, kind: 'income', splitMode: 'ask' });
    const rule: Rule = { ...input, id: 'r1' };
    expect(toRuleInput(ruleDraftFor(rule))).toEqual(input);
  });

  it('reports an unreadable priority rather than defaulting it', () => {
    expect(Number.isNaN(toRuleInput({ ...ready, priority: 'high' }).priority)).toBe(true);
    expect(toRuleInput({ ...ready, priority: '' }).priority).toBe(0);
  });

  it('clears fields that do not apply to the kind', () => {
    expect(
      toRuleInput({ ...ready, kind: 'expense', counterpartAccountId: 'b', splitMode: 'auto', splitStructureId: 's' }),
    ).toMatchObject({ counterpartAccountId: null, splitMode: 'none', splitStructureId: null });
    expect(
      toRuleInput({ ...ready, kind: 'transfer_out', counterpartAccountId: 'b', categoryId: 'c' }),
    ).toMatchObject({ counterpartAccountId: 'b', categoryId: null });
  });

  it('starts from a message, escaped, and never turns it into a sample', () => {
    expect(ruleDraftFromItem(item({ body: 'Ref {1}' }))).toMatchObject({
      sourceId: 's1',
      template: 'Ref {{1}}',
      samples: [''],
    });
  });

  it('names what is wrong with a template, and nothing when it is fine', () => {
    expect(templateProblem('Paid')).toBe('A template needs {amount}.');
    expect(templateProblem('Paid {amount}')).toBeNull();
    expect(templateProblem('')).toBeNull();
  });
});

describe('sampleResults', () => {
  const draft = {
    ...emptyRuleDraft('s1'),
    name: 'Pay',
    template: 'Paid {amount} {currency} at {counterparty}',
    accountId: 'a',
  };

  it('shows the fields extracted from a sample', () => {
    const [result] = sampleResults({ ...draft, samples: ['Paid 1,500.25 USD at Shop'] }, lookups);
    expect(result).toEqual({
      sample: 'Paid 1,500.25 USD at Shop',
      matched: true,
      lines: ['Amount: 1,500.25 USD', 'Counterparty: Shop'],
    });
  });

  it('says why a sample failed', () => {
    const [noMatch, badAmount] = sampleResults(
      { ...draft, samples: ['Hello', 'Paid 1.500,25 USD at Shop'] },
      lookups,
    );
    expect(noMatch).toMatchObject({ matched: false, lines: ['Expected "Paid " at the start.'] });
    expect(badAmount.matched).toBe(false);
    expect(badAmount.lines[0]).toContain('1.500,25');
  });

  it('skips empty samples', () => {
    expect(sampleResults({ ...draft, samples: ['  '] }, lookups)).toEqual([]);
  });

  it('asks for an account before it can test', () => {
    const [result] = sampleResults({ ...draft, accountId: null, samples: ['Hello'] }, lookups);
    expect(result).toMatchObject({ matched: false, lines: ['Choose an account to test this rule.'] });
  });
});

describe('item form', () => {
  it('fills from a proposal', () => {
    expect(itemFormFor(item(), lookups.currencies)).toEqual({
      kind: 'expense',
      accountId: 'a',
      counterpartAccountId: null,
      categoryId: null,
      amount: '10.50',
      description: 'Shop',
    });
  });

  it('is empty for an unmatched item and gives no draft until complete', () => {
    const form = itemFormFor(item({ kind: null, accountId: null, amountMinor: null, currencyCode: null, description: '' }), lookups.currencies);
    expect(form).toEqual(emptyItemForm);
    expect(toItemDraft(form)).toBeNull();
    expect(toItemDraft({ ...form, kind: 'income', accountId: 'a' })).toBeNull();
    expect(toItemDraft({ ...form, kind: 'income', accountId: 'a', amount: '5' })).toMatchObject({ amount: '5' });
  });

  it('asks for the other amount only for a lone side across currencies', () => {
    const transfer = { kind: 'transfer_out', accountId: 'a', counterpartAccountId: 'e' } as const;
    const form = { ...emptyItemForm, ...transfer, amount: '1' };
    expect(needsCounterAmount(form, false, lookups.accounts)).toBe(true);
    expect(needsCounterAmount(form, true, lookups.accounts)).toBe(false);
    expect(needsCounterAmount({ ...form, counterpartAccountId: 'b' }, false, lookups.accounts)).toBe(false);
    expect(needsCounterAmount({ ...form, kind: 'income' }, false, lookups.accounts)).toBe(false);
  });
});

describe('itemRow', () => {
  it('describes a proposal', () => {
    expect(itemRow(item(), lookups, 'Bank')).toEqual({
      title: 'Shop',
      subtitle: 'Bank · Expense · Account a',
      trailing: '$10.50',
    });
  });

  it('shows an unmatched message by its text', () => {
    expect(itemRow(item({ kind: null, description: '', amountMinor: null, accountId: null }), lookups, 'Bank')).toEqual({
      title: 'Paid 10',
      subtitle: 'Bank · No rule matched',
      trailing: undefined,
    });
  });
});

describe('labels', () => {
  it('counts the inbox', () => {
    expect(inboxLabel(1)).toBe('1 message to review');
    expect(inboxLabel(3)).toBe('3 messages to review');
  });

  it.each<[IngestResult, string]>([
    [{ outcome: 'dropped' }, 'This sender is not on your list, so nothing was saved.'],
    [{ outcome: 'one-time-code' }, 'This looks like a one-time code, so nothing was saved.'],
    [{ outcome: 'duplicate' }, 'This message is already in your inbox or history.'],
  ])('explains %j', (result, label) => {
    expect(ingestResultLabel(result)).toBe(label);
  });

  it('has nothing to explain when an item was made', () => {
    expect(ingestResultLabel({ outcome: 'inbox', itemId: 'i', status: 'proposed' })).toBeNull();
    expect(ingestResultLabel({ outcome: 'posted', itemId: 'i', transactionId: 't' })).toBeNull();
  });
});

describe('settings draft', () => {
  it('round-trips and leaves an unreadable number for validation to refuse', () => {
    const draft = settingsDraftFor({ retentionDays: 30, dedupWindowMinutes: 24, transferWindowHours: 72 });
    expect(toSettings(draft)).toEqual({ retentionDays: 30, dedupWindowMinutes: 24, transferWindowHours: 72 });
    expect(toSettings({ ...draft, retentionDays: 'x' }).retentionDays).toBeNaN();
  });
});
