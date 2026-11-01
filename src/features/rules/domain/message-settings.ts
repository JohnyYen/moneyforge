import { err, ok, type Result } from '@/shared/result';

import { ruleError, type RuleError } from './rule-error';

export type MessageSettings = {
  /** Unresolved items older than this are purged. */
  readonly retentionDays: number;
  /** How close two messages with the same text are called a likely copy. */
  readonly dedupWindowMinutes: number;
  /** How long a transfer side waits for the other before asking the user. */
  readonly transferWindowHours: number;
};

export const DEFAULT_MESSAGE_SETTINGS: MessageSettings = {
  retentionDays: 30,
  dedupWindowMinutes: 10,
  transferWindowHours: 72,
};

export const SETTING_KEYS: Readonly<Record<keyof MessageSettings, string>> = {
  retentionDays: 'rules.retention_days',
  dedupWindowMinutes: 'rules.dedup_window_minutes',
  transferWindowHours: 'rules.transfer_window_hours',
};

/** The key of the per-install secret behind every dedup hash. */
export const DEDUP_SECRET_KEY = 'rules.dedup_secret';

const MAX_SETTING = 3650;

const isValidSetting = (value: number) =>
  Number.isInteger(value) && value >= 1 && value <= MAX_SETTING;

/** A value that does not read back falls to the default, so a bad row cannot keep data forever. */
export function readSetting(stored: string | null, fallback: number): number {
  const value = stored === null ? Number.NaN : Number(stored);
  return isValidSetting(value) ? value : fallback;
}

export function validateSettings(settings: MessageSettings): Result<MessageSettings, RuleError> {
  const values = [settings.retentionDays, settings.dedupWindowMinutes, settings.transferWindowHours];
  if (!values.every(isValidSetting)) {
    return err(ruleError('invalid-settings', `Enter whole numbers from 1 to ${MAX_SETTING}.`));
  }
  if (settings.retentionDays * 24 < settings.transferWindowHours) {
    return err(
      ruleError('invalid-settings', 'Keep messages for at least as long as the transfer window.'),
    );
  }
  return ok(settings);
}

export const minutesToMs = (minutes: number) => minutes * 60_000;
export const hoursToMs = (hours: number) => hours * 3_600_000;
export const daysToMs = (days: number) => days * 86_400_000;
