import { err, ok, type Result } from '@/shared/result';

import { ruleError, type RuleError } from './rule-error';

export type MessageSettings = {
  /** Unresolved items older than this are purged. */
  readonly retentionDays: number;
  /** How far apart two reference-less copies of a message still count as one. */
  readonly dedupWindowHours: number;
  /** How long a transfer side waits for the other before asking the user. */
  readonly transferWindowHours: number;
};

export const DEFAULT_MESSAGE_SETTINGS: MessageSettings = {
  retentionDays: 30,
  dedupWindowHours: 24,
  transferWindowHours: 72,
};

export const SETTING_KEYS: Readonly<Record<keyof MessageSettings, string>> = {
  retentionDays: 'rules.retention_days',
  dedupWindowHours: 'rules.dedup_window_hours',
  transferWindowHours: 'rules.transfer_window_hours',
};

const MAX_SETTING = 3650;

const isValidSetting = (value: number) =>
  Number.isInteger(value) && value >= 1 && value <= MAX_SETTING;

/** A value that does not read back falls to the default, so a bad row cannot keep data forever. */
export function readSetting(stored: string | null, fallback: number): number {
  const value = stored === null ? Number.NaN : Number(stored);
  return isValidSetting(value) ? value : fallback;
}

export function validateSettings(settings: MessageSettings): Result<MessageSettings, RuleError> {
  const values = [settings.retentionDays, settings.dedupWindowHours, settings.transferWindowHours];
  if (!values.every(isValidSetting)) {
    return err(ruleError('invalid-settings', `Enter whole numbers from 1 to ${MAX_SETTING}.`));
  }
  return ok(settings);
}

export const hoursToMs = (hours: number) => hours * 3_600_000;
export const daysToMs = (days: number) => days * 86_400_000;
