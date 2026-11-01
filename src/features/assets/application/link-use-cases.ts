import { toLocalDay } from '@/features/ledger/application/overview-use-cases';
import type { Transaction } from '@/features/ledger/domain/journal';
import { err, ok, type Result } from '@/shared/result';

import { type ExpectedStream, type TransactionLink } from '../domain/asset';
import { assetError, type AssetError } from '../domain/asset-error';
import { nearestDue } from '../domain/asset-flows';
import type { AssetDeps, AssetRepository } from './ports';

export type LinkInput = {
  readonly transactionId: string;
  readonly assetId: string;
  readonly streamId: string | null;
};

export type RuleLinkInput = { readonly assetId: string; readonly streamId: string | null };

const invalid = (message: string) => err(assetError('invalid-link', message));
const notFound = (what: string) => err(assetError('not-found', `${what} not found.`));

const isCashFlow = ({ kind }: Transaction) => kind === 'income' || kind === 'expense';

/** The stream's closest date no other transaction fulfils. */
async function dueDateFor(
  assets: AssetRepository,
  stream: ExpectedStream,
  transaction: Transaction,
): Promise<string | null> {
  const others = (await assets.listLinks()).filter(
    ({ streamId, transactionId }) => streamId === stream.id && transactionId !== transaction.id,
  );
  const taken = new Set(others.flatMap(({ dueOn }) => (dueOn ? [dueOn] : [])));
  return nearestDue(stream.schedule, toLocalDay(new Date(transaction.occurredAt)), taken);
}

/**
 * Runs inside the write that posts a rule's entry, so it awaits only the database. A link that
 * can no longer apply is skipped: the entry must post either way, and it can be linked by hand.
 */
export async function linkFromRule(
  assets: AssetRepository,
  ruleId: string,
  transaction: Transaction,
): Promise<void> {
  const link = await assets.getRuleLink(ruleId);
  if (!link || !isCashFlow(transaction)) return;
  const stream = link.streamId ? await assets.getStream(link.streamId) : null;
  const fulfils = stream?.kind === transaction.kind ? stream : null;
  await assets.saveLink({
    transactionId: transaction.id,
    assetId: link.assetId,
    streamId: fulfils?.id ?? null,
    dueOn: fulfils ? await dueDateFor(assets, fulfils, transaction) : null,
  });
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
      store.atomic(async ({ assets, journal }) => {
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
        const dueOn = stream.value ? await dueDateFor(assets, stream.value, transaction) : null;
        const link = { transactionId, assetId, streamId, dueOn };
        await assets.saveLink(link);
        return ok(link);
      }),

    unlinkTransaction: async (transactionId: string): Promise<Result<void, AssetError>> => {
      await store.assets.removeLink(transactionId);
      return ok(undefined);
    },

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
