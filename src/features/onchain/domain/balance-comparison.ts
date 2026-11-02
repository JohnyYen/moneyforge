export type BalanceComparison = {
  readonly status: 'matches' | 'within-precision' | 'differs';
  /** The on-chain amount in the account's minor units, rounded down when it is finer. */
  readonly counted: bigint;
  /** `counted` minus the ledger. */
  readonly difference: bigint;
};

/** An amount finer than the account's currency can never reconcile, so it is reported apart. */
export function compareBalance({
  amount,
  tokenDecimals,
  ledger,
  accountDecimals,
}: {
  readonly amount: bigint;
  readonly tokenDecimals: number;
  readonly ledger: bigint;
  readonly accountDecimals: number;
}): BalanceComparison {
  const dropped = tokenDecimals - accountDecimals;
  const factor = 10n ** BigInt(Math.abs(dropped));
  const counted = dropped > 0 ? amount / factor : amount * factor;
  const difference = counted - ledger;
  if (difference !== 0n) return { status: 'differs', counted, difference };
  const finer = dropped > 0 && amount % factor !== 0n;
  return { status: finer ? 'within-precision' : 'matches', counted, difference };
}

const STALE_AFTER_MS = 60 * 60 * 1000;

/** Past an hour a balance may have moved, and a shown value should say so. */
export function isStale(readAt: string, now: Date): boolean {
  const age = now.getTime() - new Date(readAt).getTime();
  return !(age <= STALE_AFTER_MS);
}
