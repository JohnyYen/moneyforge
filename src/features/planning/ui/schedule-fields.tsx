import { ChoiceChips, TextField } from '@/shared/ui/primitives';

import type { ScheduleUnit } from '../domain/schedule';
import type { ScheduleDraft } from './plan-model';

const UNIT_OPTIONS: readonly { value: ScheduleUnit; label: string }[] = [
  { value: 'day', label: 'Days' },
  { value: 'week', label: 'Weeks' },
  { value: 'month', label: 'Months' },
  { value: 'year', label: 'Years' },
];

/** The one way to enter a schedule, for anything that repeats. */
export function ScheduleFields({
  draft,
  onChange,
}: {
  draft: ScheduleDraft;
  onChange: (change: Partial<ScheduleDraft>) => void;
}) {
  return (
    <>
      <TextField
        label="Repeat every"
        keyboardType="numeric"
        value={draft.every}
        onChangeText={(every) => onChange({ every })}
      />
      <ChoiceChips
        options={UNIT_OPTIONS}
        value={draft.unit}
        onChange={(unit) => onChange({ unit })}
      />
      {draft.unit === 'month' ? (
        <TextField
          label="Day of the month (optional)"
          keyboardType="numeric"
          value={draft.dayOfMonth}
          onChangeText={(dayOfMonth) => onChange({ dayOfMonth })}
        />
      ) : null}
      <TextField
        label="Start date, YYYY-MM-DD"
        value={draft.startOn}
        onChangeText={(startOn) => onChange({ startOn })}
      />
      <TextField
        label="End date, YYYY-MM-DD (optional)"
        value={draft.endOn}
        onChangeText={(endOn) => onChange({ endOn })}
      />
    </>
  );
}
