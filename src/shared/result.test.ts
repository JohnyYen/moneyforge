import { err, ok, type Result } from './result';

function parsePositive(input: number): Result<number, string> {
  return input > 0 ? ok(input) : err('not positive');
}

describe('Result', () => {
  it('carries the value on success', () => {
    const result = parsePositive(5);

    expect(result).toEqual({ ok: true, value: 5 });
  });

  it('carries the error on failure', () => {
    const result = parsePositive(-1);

    expect(result).toEqual({ ok: false, error: 'not positive' });
  });

  it('narrows by the ok discriminant', () => {
    const result = parsePositive(2);

    const doubled = result.ok ? result.value * 2 : 0;

    expect(doubled).toBe(4);
  });
});
