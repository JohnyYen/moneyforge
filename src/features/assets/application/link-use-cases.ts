import type { TransactionChangeGuard } from '@/features/ledger/application/ports';
import type { Transaction } from '@/features/ledger/domain/journal';
import { recordedAmount } from '@/features/planning/application/recorded-movements';
import { err, ok, type Result } from '@/shared/result';

import type { ExpectedStream, StreamPayment, TransactionLink } from '../domain/asset';
import { assetError, type AssetError } from '../domain/asset-error';
import { assignDueDates, paymentMeasure } from '../domain/asset-flows';
import type { AssetDeps, AssetRepositories, AssetRepository } from './ports';

export type LinkInput = {
  readonly transactionId: string;
  readonly assetId: string;
  readonly streamId: string | null;
};

export type RuleLinkInput = { readonly assetId: string; readonly streamId: string | null };

const invalid = (message: string) => err(assetError('invalid-link', message));
const notFound = (what: string) => err(assetError('not-found', `${what} not found.`));

const isCashFlow = ({ kind }: Transaction) => kind === 'income' || kind === 'expense';

/** Everything `refreshStream` reads, which a hook bound to one write can also supply. */
type LinkRepositories = Pick<AssetRepositories, 'assets' | 'currencies' | 'exchangeRates'>;

type PaymentChange = (payment: StreamPayment) => StreamPayment[];

/**
 * Gives every payment of a stream its date again, from what the transactions say now. `change`
 * shows one as it is about to be, for a guard that runs before the write. Awaits only the
 * database, so it can run inside a write.
 */
export async function refreshStream(
  { assets, currencies, exchangeRates }: LinkRepositories,
  stream: ExpectedStream,
  change: PaymentChange = (payment) => [payment],
): Promise<void> {
  const asset = await assets.getAsset(stream.assetId);
  if (!asset) return;
  const context = { rates: await exchangeRates.list(), currencies: await currencies.list() };
  const payments = (await assets.listPayments())
    .filter(({ streamId }) => streamId === stream.id)
    .flatMap(change);
  const assigned = assignDueDates(stream, payments, paymentMeasure(asset.currencyCode, context));
  for (const { transactionId, assetId, streamId, dueOn } of payments) {
    const next = assigned.get(transactionId) ?? null;
    if (next !== dueOn) await assets.saveLink({ transactionId, assetId, streamId, dueOn: next });
  }
}

async function refreshStreamOf(
  repositories: LinkRepositories,
  streamId: string | null | undefined,
  change?: PaymentChange,
): Promise<void> {
  const stream = streamId ? await repositories.assets.getStream(streamId) : null;
  if (stream) await refreshStream(repositories, stream, change);
}

/** Keeps stream dates true to edited transactions, in the write that changes them. */
export function createAssetChangeGuard(repositories: LinkRepositories): TransactionChangeGuard {
  const refreshFor = async (id: string, change: PaymentChange) => {
    const link = await repositories.assets.getLink(id);
    await refreshStreamOf(repositories, link?.streamId, change);
    return ok(undefined);
  };
  return {
    beforeUpdate: (_, next) =>
      refreshFor(next.id, (payment) => {
        if (payment.transactionId !== next.id) return [payment];
        const amount = recordedAmount(next);
        return amount ? [{ ...payment, ...amount, kind: next.kind }] : [];
      }),
    beforeDelete: ({ id }) =>
      refreshFor(id, (payment) => (payment.transactionId === id ? [] : [payment])),
  };
}

/**
 * Runs inside the write that posts a rule's entry, so it awaits only the database. A link that
 * can no longer apply is skipped: the entry must post either way, and it can be linked by hand.
 */
export async function linkFromRule(
  repositories: LinkRepositories,
  ruleId: string,
  transaction: Transaction,
): Promise<void> {
  const { assets } = repositories;
  const link = await assets.getRuleLink(ruleId);
  if (!link || !isCashFlow(transaction)) return;
  const stream = link.streamId ? await assets.getStream(link.streamId) : null;
  const fulfils = stream?.kind === transaction.kind ? stream : null;
  await assets.saveLink({
    transactionId: transaction.id,
    assetId: link.assetId,
    streamId: fulfils?.id ?? null,
    dueOn: null,
  });
  if (fulfils) await refreshStream(repositories, fulfils);
}

async function streamOf(
  assets: AssetRepository,
  streamId: string | null,
  assetId: string,
): Promise<Result<ExpectedStream | null, AssetError>> {
  if (!streamId) return ok(null);
  const stream = await assets.getStream(streamId);
  return stream?.assetId === assetId ? ok(stream) : invalid('Choose a stream of this asset.');
}

export function createLinkUseCases({ store }: AssetDeps) {
  return {
    getLink: (transactionId: string) => store.assets.getLink(transactionId),

    /** Newest first. */
    async linkedTransactions(assetId: string): Promise<Transaction[]> {
      const links = (await store.assets.listLinks()).filter((link) => link.assetId === assetId);
      const found = await Promise.all(
        links.map(({ transactionId }) => store.journal.get(transactionId)),
      );
      return found
        .filter((transaction) => transaction !== null)
        .sort((first, second) => second.occurredAt.localeCompare(first.occurredAt));
    },

    /** Linking again moves it. A stream date comes from the transaction's own day. */
    linkTransaction: (input: LinkInput): Promise<Result<TransactionLink, AssetError>> =>
      store.atomic(async (repositories) => {
        const { assets, journal } = repositories;
        const { transactionId, assetId, streamId } = input;
        const transaction = await journal.get(transactionId);
        if (!transaction) return notFound('Transaction');
        if (!isCashFlow(transaction)) return invalid('Only income and expenses link to an asset.');
        if (!(await assets.getAsset(assetId))) return notFound('Asset');
        const stream = await streamOf(assets, streamId, assetId);
        if (!stream.ok) return stream;
        if (stream.value && stream.value.kind !== transaction.kind) {
          return invalid(`Choose an ${transaction.kind} stream.`);
        }
        const previous = await assets.getLink(transactionId);
        await assets.saveLink({ transactionId, assetId, streamId, dueOn: null });
        await refreshStreamOf(repositories, streamId);
        if (previous?.streamId !== streamId) {
          await refreshStreamOf(repositories, previous?.streamId);
        }
        const link = await assets.getLink(transactionId);
        return link ? ok(link) : notFound('Link');
      }),

    unlinkTransaction: (transactionId: string): Promise<Result<void, AssetError>> =>
      store.atomic(async (repositories) => {
        const link = await repositories.assets.getLink(transactionId);
        await repositories.assets.removeLink(transactionId);
        await refreshStreamOf(repositories, link?.streamId);
        return ok(undefined);
      }),

    listRuleLinks: async (assetId: string) =>
      (await store.assets.listRuleLinks()).filter((link) => link.assetId === assetId),

    /** `null` stops linking. Entries already linked stay. */
    setRuleLink: (ruleId: string, link: RuleLinkInput | null): Promise<Result<void, AssetError>> =>
      store.atomic(async ({ assets }) => {
        if (!link) {
          await assets.removeRuleLink(ruleId);
          return ok(undefined);
        }
        if (!(await assets.ruleExists(ruleId))) return notFound('Rule');
        if (!(await assets.getAsset(link.assetId))) return notFound('Asset');
        const stream = await streamOf(assets, link.streamId, link.assetId);
        if (!stream.ok) return stream;
        await assets.saveRuleLink({ ...link, ruleId });
        return ok(undefined);
      }),
  };
}
