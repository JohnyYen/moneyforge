import { inboxSections, isDuplicate, pickPair, type InboxItem } from './inbox-item';

const HOUR = 3_600_000;
const start = '2026-03-10T12:00:00.000Z';
const hoursLater = (hours: number) => new Date(Date.parse(start) + hours * HOUR).toISOString();

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: 'i1',
  sourceId: 's1',
  ruleId: 'r1',
  status: 'waiting_pair',
  channel: 'sms',
  receivedAt: start,
  body: 'body',
  bodyHash: 'hash',
  referenceKey: null,
  note: null,
  kind: 'transfer_out',
  accountId: 'a',
  categoryId: null,
  counterpartAccountId: 'b',
  amountMinor: 100n,
  currencyCode: 'USD',
  reference: null,
  counterparty: null,
  balance: null,
  description: '',
  autoPost: false,
  splitMode: 'none',
  splitStructureId: null,
  splitRequested: false,
  pairItemId: null,
  transactionId: null,
  ...over,
});

const opposite = (over: Partial<InboxItem> = {}) =>
  item({
    id: 'i2',
    kind: 'transfer_in',
    accountId: 'b',
    counterpartAccountId: 'a',
    ...over,
  });

describe('isDuplicate', () => {
  const later = hoursLater(1);

  it('matches the same body inside the window, in either direction', () => {
    expect(isDuplicate(later, [item()], 2 * HOUR)).toBe(true);
    expect(isDuplicate(start, [item({ receivedAt: later })], 2 * HOUR)).toBe(true);
  });

  it('includes the window boundary and nothing past it', () => {
    expect(isDuplicate(later, [item()], HOUR)).toBe(true);
    expect(isDuplicate(later, [item()], HOUR - 1)).toBe(false);
  });

  it('finds nothing with no stored item', () => {
    expect(isDuplicate(later, [], HOUR)).toBe(false);
  });
});

describe('pickPair', () => {
  const window = 2 * HOUR;

  it('pairs the two sides of one movement', () => {
    expect(pickPair(item(), [opposite()], window)?.id).toBe('i2');
  });

  it('works from either side', () => {
    expect(pickPair(opposite(), [item()], window)?.id).toBe('i1');
  });

  it('includes the window boundary and nothing past it', () => {
    expect(pickPair(item(), [opposite({ receivedAt: hoursLater(2) })], window)?.id).toBe('i2');
    expect(pickPair(item(), [opposite({ receivedAt: hoursLater(2.1) })], window)).toBeNull();
    expect(pickPair(opposite({ receivedAt: hoursLater(3) }), [item()], window)).toBeNull();
  });

  it('needs the same amount in one currency', () => {
    expect(pickPair(item(), [opposite({ amountMinor: 99n })], window)).toBeNull();
  });

  it('allows different amounts across currencies', () => {
    expect(
      pickPair(item(), [opposite({ amountMinor: 92n, currencyCode: 'EUR' })], window)?.id,
    ).toBe('i2');
  });

  it('needs the same two accounts, mirrored', () => {
    expect(pickPair(item(), [opposite({ counterpartAccountId: 'c' })], window)).toBeNull();
    expect(pickPair(item(), [opposite({ accountId: 'c' })], window)).toBeNull();
  });

  it('never pairs two sides of the same direction', () => {
    expect(pickPair(item(), [item({ id: 'i2', accountId: 'b', counterpartAccountId: 'a' })], window)).toBeNull();
  });

  it('never pairs an item with itself', () => {
    expect(pickPair(item(), [item()], window)).toBeNull();
  });

  it('takes the oldest candidate, then the lowest id', () => {
    const older = opposite({ id: 'z', receivedAt: hoursLater(-1) });
    const newer = opposite({ id: 'a', receivedAt: hoursLater(1) });
    expect(pickPair(item(), [newer, older], window)?.id).toBe('z');
    const sameTime = [opposite({ id: 'y' }), opposite({ id: 'x' })];
    expect(pickPair(item(), sameTime, window)?.id).toBe('x');
  });
});

describe('inboxSections', () => {
  const window = 2 * HOUR;
  const now = new Date(hoursLater(1));

  it('sorts open items by what they need from the user', () => {
    const sections = inboxSections(
      [
        item({ id: 'matched', status: 'proposed', kind: 'expense' }),
        item({ id: 'unmatched', status: 'unmatched', kind: null }),
        item({ id: 'side' }),
        item({ id: 'split', status: 'posted', body: null, splitRequested: true, kind: 'income' }),
      ],
      now,
      window,
    );
    expect(sections.review.map(({ id }) => id)).toEqual(['matched', 'unmatched']);
    expect(sections.waiting.map(({ id }) => id)).toEqual(['side']);
    expect(sections.splits.map(({ id }) => id)).toEqual(['split']);
  });

  it('surfaces a side once the window has passed', () => {
    const sections = inboxSections([item()], new Date(hoursLater(2.5)), window);
    expect(sections.waiting).toEqual([]);
    expect(sections.review.map(({ id }) => id)).toEqual(['i1']);
  });

  it('shows a matched pair once', () => {
    const sections = inboxSections(
      [
        item({ status: 'proposed', pairItemId: 'i2' }),
        opposite({ status: 'proposed', pairItemId: 'i1' }),
      ],
      now,
      window,
    );
    expect(sections.review.map(({ id }) => id)).toEqual(['i1']);
  });
});
