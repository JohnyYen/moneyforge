import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { ok } from '@/shared/result';
import { useSubmit } from '@/shared/ui/use-submit';

import type { ApproveOptions } from '../application/inbox-use-cases';
import { useRules } from './rules-context';
import { toItemDraft, type ItemForm } from './rules-model';

export type Approval = {
  readonly form: ItemForm;
  readonly counterAmount: string;
  readonly changed: boolean;
  readonly otherSide?: ApproveOptions['otherSide'];
};

type OtherSide = NonNullable<Approval['otherSide']>;

function askAboutOtherSide(message: string, onAnswer: (answer: OtherSide) => void) {
  Alert.alert('Is this the same transfer?', message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Different transfers', onPress: () => onAnswer('different') },
    { text: 'Same transfer', onPress: () => onAnswer('same') },
  ]);
}

/** Saves any edits, then approves. An opposite side found on the way is the user's call. */
export function useApproveItem(id: string, onSuccess: () => void) {
  const rules = useRules();
  const retry = useRef<(approval: Approval) => void>(() => undefined);
  const { submit, ...rest } = useSubmit(
    async (approval: Approval) => {
      const { form, counterAmount, changed, otherSide } = approval;
      const draft = toItemDraft(form);
      if (!draft) return { ok: false as const, error: { message: 'Complete the item first.' } };
      if (changed) {
        const edited = await rules.editItem(id, draft);
        if (!edited.ok) return edited;
        // An edit can join a transfer that is already posted, which leaves nothing to approve.
        if (edited.value.status === 'posted') return ok(undefined);
      }
      const approved = await rules.approveItem(id, { counterAmount, otherSide });
      if (!approved.ok && approved.error.code === 'confirmation-required') {
        askAboutOtherSide(approved.error.message, (answer) =>
          retry.current({ ...approval, changed: false, otherSide: answer }),
        );
      }
      return approved.ok ? ok(undefined) : approved;
    },
    onSuccess,
    { exitsOnSuccess: true },
  );
  useEffect(() => {
    retry.current = (approval) => void submit(approval);
  });

  return { ...rest, submit };
}
