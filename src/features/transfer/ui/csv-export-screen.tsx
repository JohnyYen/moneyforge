import { useCallback, useState } from 'react';

import { useLedger } from '@/features/ledger/ui/ledger-context';
import {
  Button,
  ChoiceChips,
  ErrorBanner,
  Muted,
  Notice,
  QueryBoundary,
  Screen,
  TextField,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { CsvExportInput } from '../application/transfer-service';
import { shareText } from '@/shared/ui/share-text';
import { useTransfer } from './transfer-context';

const ALL_ACCOUNTS = 'all';

export function CsvExportScreen() {
  const ledger = useLedger();
  const transfer = useTransfer();
  const load = useCallback(() => ledger.accountBalancesForDisplay(), [ledger]);
  const { state, reload } = useFocusQuery(load);
  const [accountId, setAccountId] = useState(ALL_ACCOUNTS);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const share = useSubmit(
    async (input: CsvExportInput) => {
      const exported = await transfer.exportCsv(input);
      if (!exported.ok) return exported;
      const shared = await shareText('MoneyForge transactions', exported.value.csv);
      return shared.ok ? exported : shared;
    },
    ({ rows }) => setNotice(`Prepared ${rows} rows.`),
  );

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {(balances) => (
        <Screen>
          <Muted>
            One row per account a transaction touched, so a transfer shows both sides. Leave a date
            empty for no limit.
          </Muted>
          <ChoiceChips
            label="Account"
            options={[
              { value: ALL_ACCOUNTS, label: 'All accounts' },
              ...balances.map(({ account }) => ({ value: account.id, label: account.name })),
            ]}
            value={accountId}
            onChange={setAccountId}
          />
          <TextField label="From (YYYY-MM-DD)" value={from} onChangeText={setFrom} />
          <TextField label="To (YYYY-MM-DD)" value={to} onChangeText={setTo} />
          {notice ? <Notice>{notice}</Notice> : null}
          <ErrorBanner message={share.error} />
          <Button
            label="Share CSV"
            disabled={share.submitting}
            onPress={() =>
              void share.submit({
                accountId: accountId === ALL_ACCOUNTS ? null : accountId,
                from: from.trim(),
                to: to.trim(),
              })
            }
          />
        </Screen>
      )}
    </QueryBoundary>
  );
}
