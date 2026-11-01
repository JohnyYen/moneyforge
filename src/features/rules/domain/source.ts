import { err, ok, type Result } from '@/shared/result';

import { MESSAGE_CHANNELS, normalizeSender, type MessageChannel } from './message';
import { ruleError, type RuleError } from './rule-error';

export type MessageSource = {
  readonly id: string;
  readonly name: string;
  readonly channel: MessageChannel;
  /** Normalized. One source per sender, so a message always resolves to one dedup scope. */
  readonly sender: string;
  readonly enabled: boolean;
};

export function createMessageSource(input: MessageSource): Result<MessageSource, RuleError> {
  const name = input.name.trim();
  const sender = normalizeSender(input.sender);
  if (!name) return err(ruleError('invalid-source', 'Give the source a name.'));
  if (!sender) return err(ruleError('invalid-source', 'Enter the sender of the messages.'));
  if (!MESSAGE_CHANNELS.includes(input.channel)) {
    return err(ruleError('invalid-source', 'Choose where the messages come from.'));
  }
  return ok({ ...input, name, sender });
}
