import { occurredAtFromDay } from './entry-date';

describe('occurredAtFromDay', () => {
  it('leaves today undefined so the entry keeps the current time', () => {
    expect(occurredAtFromDay('2026-03-10', '2026-03-10')).toEqual({ ok: true, value: undefined });
  });

  it('places another day at local noon so it stays on that day', () => {
    const result = occurredAtFromDay('2026-03-01', '2026-03-10');

    expect(result).toEqual({ ok: true, value: new Date(2026, 2, 1, 12).toISOString() });
  });

  it('rejects a day that does not exist', () => {
    expect(occurredAtFromDay('2026-02-30', '2026-03-10')).toMatchObject({
      ok: false,
      error: { code: 'invalid-date' },
    });
  });
});
