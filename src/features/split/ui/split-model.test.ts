import type { Account } from '@/features/ledger/domain/account';
import type { Currency } from '@/features/ledger/domain/currency';

import type { SplitDetails } from '../application/split-service';
import {
  moveKindOf,
  pendingMovesLabel,
  previewRows,
  runRows,
  toMoveRow,
  type SplitLookups,
} from './split-model';

const usd: Currency = { code: 'USD', name: 'US dollar', decimals: 2, symbol: '$', kind: 'fiat' };
const eur: Currency = { code: 'EUR', name: 'Euro', decimals: 2, symbol: '€', kind: 'fiat' };
const account = (id: string, currencyCode: string): Account => ({
  id,
  name: id.toUpperCase(),
  type: 'Bank',
  currencyCode,
  openingBalance: 0n,
  archived: false,
  systemRole: null,
});
const lookups: SplitLookups = {
  accounts: [account('a', 'USD'), account('b', 'USD'), account('c', 'EUR')],
  currencies: [usd, eur],
};

const details: SplitDetails = {
  run: {
    id: 'run',
    transactionId: 'tx',
    structureId: 's',
    structureName: 'Salary',
    sourceAccountId: 'a',
    currencyCode: 'USD',
    amount: 1000n,
    createdAt: '2026-03-10T12:00:00.000Z',
    lines: [
      { position: 0, label: 'Stay', targetAccountId: 'a', percentage: '50', isRemainder: false, amount: 500n },
      { position: 1, label: 'Save', targetAccountId: 'b', percentage: '30', isRemainder: false, amount: 300n },
      { position: 2, label: 'Fx', targetAccountId: 'c', percentage: '20', isRemainder: true, amount: 200n },
    ],
  },
  moves: [
    {
      id: 'm1',
      runId: 'run',
      position: 1,
      label: 'Save',
      fromAccountId: 'a',
      toAccountId: 'b',
      amount: 300n,
      currencyCode: 'USD',
      status: 'done',
      ledgerTransactionId: 'lt',
    },
  ],
};

describe('split display model', () => {
  it('labels the pending count', () => {
    expect(pendingMovesLabel(1)).toBe('1 pending move');
    expect(pendingMovesLabel(3)).toBe('3 pending moves');
  });

  it('tells a transfer from a conversion by the target currency', () => {
    expect(moveKindOf({ toAccountId: 'b', currencyCode: 'USD' }, lookups)).toBe('transfer');
    expect(moveKindOf({ toAccountId: 'c', currencyCode: 'USD' }, lookups)).toBe('conversion');
  });

  it('describes a move row', () => {
    expect(toMoveRow(details.moves[0], lookups)).toEqual({
      id: 'm1',
      title: 'Save',
      subtitle: 'A → B',
      amount: '$3.00',
    });
  });

  it('shows every run line, with where it stands', () => {
    expect(runRows(details, lookups)).toEqual([
      { key: '0', title: 'Stay', subtitle: '50% · A · Stays in place', amount: '$5.00', moveId: null },
      { key: '1', title: 'Save', subtitle: '30% · B · Done', amount: '$3.00', moveId: 'm1' },
      // A positive line with no move left means nothing to do; only a tiny income does this.
      { key: '2', title: 'Fx', subtitle: '20% · C · Nothing to move', amount: '$2.00', moveId: null },
    ]);
  });

  it('previews what a structure would do', () => {
    const rows = previewRows(
      1000n,
      'a',
      'USD',
      {
        lines: [
          { label: 'Stay', targetAccountId: 'a', percentage: '75', isRemainder: false },
          { label: 'Fx', targetAccountId: 'c', percentage: null, isRemainder: true },
        ],
      },
      lookups,
    );

    expect(rows).toEqual([
      { key: '0', title: 'Stay', subtitle: '75% · A · Stays in place', amount: '$7.50', moveId: null },
      { key: '1', title: 'Fx', subtitle: '25% · C · Conversion', amount: '$2.50', moveId: null },
    ]);
  });
});
