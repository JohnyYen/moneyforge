import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { toLocalDay } from '@/features/ledger/application/overview-use-cases';
import { useLedger } from '@/features/ledger/ui/ledger-context';
import { recordedAmount } from '@/features/planning/application/recorded-movements';
import { missingRatesLabel, scheduleLabel } from '@/features/planning/ui/plan-model';
import {
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
  Title,
} from '@/shared/ui/primitives';
import { unwrapOrThrow } from '@/shared/ui/unwrap';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import {
  percentLabel,
  rangeLabel,
  REPORT_RANGE_LABELS,
  REPORT_RANGES,
  reportRange,
  showMoney,
  valuationRow,
  type ReportRange,
} from './asset-model';
import { AssetProjectionNotices } from './asset-projection-notices';
import { useAssets } from './assets-context';

const RANGE_OPTIONS = REPORT_RANGES.map((value) => ({ value, label: REPORT_RANGE_LABELS[value] }));

export function AssetDetailScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const assets = useAssets();
  const ledger = useLedger();
  const router = useRouter();
  const [range, setRange] = useState<ReportRange>('month');
  const load = useCallback(async () => {
    const period = reportRange(range, toLocalDay(new Date()));
    const [report, valuations, streams, linked, currencies] = await Promise.all([
      assets.assetReport(id, period),
      assets.listValuations(id),
      assets.listStreams(id),
      assets.linkedTransactions(id),
      ledger.listCurrencies(),
    ]);
    return {
      report: unwrapOrThrow(report),
      valuations,
      streams,
      linked,
      currencies: new Map(currencies.map((item) => [item.code, item])),
    };
  }, [assets, id, ledger, range]);
  const { state, reload } = useFocusQuery(load);
  const remove = useSubmit((valuationId: string) => assets.removeValuation(valuationId), reload);

  const askToRemove = (valuationId: string, label: string) =>
    Alert.alert('Remove this value?', label, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void remove.submit(valuationId) },
    ]);

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ report, valuations, streams, linked, currencies }) => {
        const { asset, actual, expected, difference, latest, netYield, period } = report;
        const code = asset.currencyCode;
        const show = (minor: bigint) => showMoney(minor, code, currencies);
        const missing = missingRatesLabel(report.missingRates);
        const params = { id: asset.id };
        return (
          <Screen>
            <Title>{asset.name}</Title>
            <Muted>{latest ? `Value: ${show(latest.amount)} on ${latest.valuedOn}` : 'No value yet'}</Muted>
            {asset.soldOn ? <Notice>Sold on {asset.soldOn}. Expected flows stopped.</Notice> : null}
            {asset.notes ? <Muted>{asset.notes}</Muted> : null}
            <Button
              label="Edit asset"
              variant="secondary"
              onPress={() => router.push({ pathname: '/assets/[id]/edit', params })}
            />

            <SectionLabel>Report</SectionLabel>
            <ChoiceChips options={RANGE_OPTIONS} value={range} onChange={setRange} />
            <Muted>{rangeLabel(period.startOn, period.endOn)}</Muted>
            <ListRow title="Income" subtitle={`Expected ${show(expected.income)}`} trailing={show(actual.income)} />
            <ListRow title="Expense" subtitle={`Expected ${show(expected.expense)}`} trailing={show(actual.expense)} />
            <ListRow title="Net" subtitle={`Expected ${show(expected.net)}`} trailing={show(actual.net)} />
            <ListRow
              title="Against expected"
              trailing={difference === null ? 'Not available' : show(difference)}
            />
            <ListRow title="Net yield on latest value" trailing={percentLabel(netYield) ?? 'Not available'} />
            {missing ? <Notice>{missing}</Notice> : null}

            <SectionLabel>Value history</SectionLabel>
            <ErrorBanner message={remove.error} />
            {valuations.length === 0 ? <EmptyState title="No values yet" /> : <Muted>Tap a value to remove it.</Muted>}
            {valuations.map((valuation) => {
              const { key, title, trailing } = valuationRow(valuation, asset, currencies);
              return (
                <ListRow
                  key={key}
                  title={title}
                  trailing={trailing}
                  onPress={() => askToRemove(key, `${title}: ${trailing}`)}
                />
              );
            })}
            <Button
              label="Add value"
              onPress={() => router.push({ pathname: '/assets/[id]/valuation', params })}
            />

            <SectionLabel>Expected cash flow</SectionLabel>
            <AssetProjectionNotices assetId={asset.id} />
            {streams.map((stream) => (
              <ListRow
                key={stream.id}
                title={stream.name}
                subtitle={scheduleLabel(stream.schedule)}
                trailing={show(stream.kind === 'income' ? stream.amount : -stream.amount)}
                onPress={() =>
                  router.push({
                    pathname: '/assets/[id]/stream',
                    params: { ...params, streamId: stream.id },
                  })
                }
              />
            ))}
            <Button
              label="Add expected flow"
              onPress={() => router.push({ pathname: '/assets/[id]/stream', params })}
            />

            <SectionLabel>Actual cash flow</SectionLabel>
            {linked.length === 0 ? (
              <EmptyState title="Nothing linked yet" hint="Link a transaction from its screen." />
            ) : null}
            {linked.map((transaction) => {
              const amount = recordedAmount(transaction);
              const minor = transaction.kind === 'expense' ? -(amount?.minor ?? 0n) : amount?.minor;
              return (
                <ListRow
                  key={transaction.id}
                  title={transaction.description || transaction.kind}
                  subtitle={amount?.day}
                  trailing={amount && minor !== undefined ? showMoney(minor, amount.currency, currencies) : undefined}
                  onPress={() =>
                    router.push({ pathname: '/transactions/[id]', params: { id: transaction.id } })
                  }
                />
              );
            })}
            <ListRow
              title="Rules that link here"
              onPress={() => router.push({ pathname: '/assets/[id]/rules', params })}
            />
          </Screen>
        );
      }}
    </QueryBoundary>
  );
}
