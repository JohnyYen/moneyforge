import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { formatDecimal } from '@/features/ledger/domain/money';
import { amountPreview, ratePreview } from '@/features/ledger/ui/amount-preview';
import { useLedger } from '@/features/ledger/ui/ledger-context';
import { leaveScreen } from '@/shared/ui/leave-screen';
import {
  AmountField,
  Button,
  ChoiceChips,
  EmptyState,
  ErrorBanner,
  ListRow,
  Muted,
  QueryBoundary,
  Screen,
} from '@/shared/ui/primitives';
import { useFocusQuery } from '@/shared/ui/use-focus-query';
import { useSubmit } from '@/shared/ui/use-submit';

import type { CompleteMoveInput } from '../application/split-service';
import type { PendingMove } from '../domain/split-run';
import { useSplit } from './split-context';
import { moveKindOf, toMoveRow, type SplitLookups } from './split-model';

type CompletionFields = Omit<CompleteMoveInput, 'moveId' | 'occurredAt'>;

function CompletionForm({
  move,
  lookups,
  error,
  submitting,
  onComplete,
  onSkip,
}: {
  move: PendingMove;
  lookups: SplitLookups;
  error: string | null;
  submitting: boolean;
  onComplete: (fields: CompletionFields) => void;
  onSkip: () => void;
}) {
  const source = lookups.currencies.find(({ code }) => code === move.currencyCode);
  const targetCode = lookups.accounts.find(({ id }) => id === move.toAccountId)?.currencyCode;
  const target = lookups.currencies.find(({ code }) => code === targetCode);
  const conversion = moveKindOf(move, lookups) === 'conversion';

  const [amount, setAmount] = useState(source ? formatDecimal(move.amount, source.decimals) : '');
  const [targetAmount, setTargetAmount] = useState('');
  const [rate, setRate] = useState('');
  const [fee, setFee] = useState('');
  const [feeCurrency, setFeeCurrency] = useState(move.currencyCode);
  const feeTarget = feeCurrency === targetCode ? target : source;

  return (
    <>
      <AmountField
        label="You sent"
        value={amount}
        onChangeText={setAmount}
        preview={amountPreview(amount, source)}
      />
      {conversion ? (
        <>
          <AmountField
            label={`You received in ${targetCode}`}
            value={targetAmount}
            onChangeText={setTargetAmount}
            preview={amountPreview(targetAmount, target)}
          />
          <AmountField
            label="Rate (optional, calculated from the amounts)"
            value={rate}
            onChangeText={setRate}
            preview={ratePreview(rate, move.currencyCode, targetCode)}
          />
        </>
      ) : null}
      <AmountField
        label="Fee (optional)"
        value={fee}
        onChangeText={setFee}
        preview={amountPreview(fee, feeTarget, 'non-negative')}
      />
      {conversion && fee && targetCode ? (
        <ChoiceChips
          label="Fee currency"
          options={[move.currencyCode, targetCode].map((code) => ({ value: code, label: code }))}
          value={feeCurrency}
          onChange={setFeeCurrency}
        />
      ) : null}
      <ErrorBanner message={error} />
      <Button
        label="I made this move"
        disabled={submitting || !amount || (conversion && !targetAmount)}
        onPress={() =>
          onComplete({
            amount,
            targetAmount,
            rate,
            fee,
            feeCurrency: conversion ? feeCurrency : undefined,
          })
        }
      />
      <Button label="Skip this move" variant="secondary" disabled={submitting} onPress={onSkip} />
    </>
  );
}

function confirmUndo(onConfirm: () => void) {
  Alert.alert('Undo this move?', 'The linked transaction will be deleted.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Undo', style: 'destructive', onPress: onConfirm },
  ]);
}

export function MoveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ledger = useLedger();
  const split = useSplit();
  const router = useRouter();
  const load = useCallback(async () => {
    const [move, accounts, currencies] = await Promise.all([
      split.getMove(id),
      ledger.listAccounts(),
      ledger.listCurrencies(),
    ]);
    return { move, lookups: { accounts, currencies } };
  }, [id, ledger, split]);
  const { state, reload } = useFocusQuery(load);

  const exit = () => leaveScreen(router);
  const options = { exitsOnSuccess: true };
  const complete = useSubmit(
    (fields: CompletionFields) => split.completeMove({ ...fields, moveId: id }),
    exit,
    options,
  );
  const skip = useSubmit<void, void>(() => split.skipMove(id), exit, options);
  const undo = useSubmit<void, void>(() => split.undoMove(id), exit, options);
  const submitting = complete.submitting || skip.submitting || undo.submitting;

  return (
    <QueryBoundary state={state} onRetry={reload}>
      {({ move, lookups }) => {
        if (!move) {
          return (
            <Screen>
              <EmptyState title="Move not found" />
            </Screen>
          );
        }
        const { title, subtitle, amount } = toMoveRow(move, lookups);
        const { ledgerTransactionId } = move;
        return (
          <Screen>
            <ListRow title={title} subtitle={subtitle} trailing={amount} />
            {move.status === 'pending' ? (
              <CompletionForm
                move={move}
                lookups={lookups}
                error={complete.error ?? skip.error}
                submitting={submitting}
                onComplete={(fields) => void complete.submit(fields)}
                onSkip={() => void skip.submit()}
              />
            ) : (
              <>
                <Muted>
                  {move.status === 'done' ? 'This move is done.' : 'This move was skipped.'}
                </Muted>
                <ErrorBanner message={undo.error} />
                {ledgerTransactionId ? (
                  <Button
                    label="Open transaction"
                    variant="secondary"
                    onPress={() =>
                      router.push({
                        pathname: '/transactions/[id]',
                        params: { id: ledgerTransactionId },
                      })
                    }
                  />
                ) : null}
                <Button
                  label={move.status === 'done' ? 'Undo move' : 'Back to pending'}
                  variant="secondary"
                  disabled={submitting}
                  onPress={() =>
                    move.status === 'done'
                      ? confirmUndo(() => void undo.submit())
                      : void undo.submit()
                  }
                />
              </>
            )}
          </Screen>
        );
      }}
    </QueryBoundary>
  );
}
