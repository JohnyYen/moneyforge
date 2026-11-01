import { invertRate, parseRate, type ExactRate } from './rate';

export type ExchangeRate = {
  readonly id: string;
  readonly fromCode: string;
  readonly toCode: string;
  readonly rate: string;
  readonly effectiveOn: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(text: string): boolean {
  if (!DATE_PATTERN.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(text);
}

export function findRate(
  rates: readonly ExchangeRate[],
  fromCode: string,
  toCode: string,
  asOf: string,
): ExactRate | null {
  let best: { effectiveOn: string; direct: boolean; rate: ExactRate } | null = null;
  for (const candidate of rates) {
    const direct = candidate.fromCode === fromCode && candidate.toCode === toCode;
    const inverse = candidate.fromCode === toCode && candidate.toCode === fromCode;
    if ((!direct && !inverse) || candidate.effectiveOn > asOf) continue;
    const parsed = parseRate(candidate.rate);
    if (!parsed.ok) continue;
    const newer = !best || candidate.effectiveOn > best.effectiveOn;
    const sameDayDirect = best?.effectiveOn === candidate.effectiveOn && direct && !best.direct;
    if (newer || sameDayDirect) {
      best = {
        effectiveOn: candidate.effectiveOn,
        direct,
        rate: direct ? parsed.value : invertRate(parsed.value),
      };
    }
  }
  return best?.rate ?? null;
}
