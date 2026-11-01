import { parseDecimal } from '@/features/ledger/domain/money';
import { todayOf } from '@/features/planning/application/recorded-movements';
import type { Day } from '@/features/planning/domain/calendar';
import type { Schedule } from '@/features/planning/domain/schedule';
import { err, ok, type Result } from '@/shared/result';

import {
  sellAsset,
  validateAsset,
  validateStream,
  validateValuation,
  type Asset,
  type AssetType,
  type ExpectedStream,
  type StreamKind,
  type Valuation,
} from '../domain/asset';
import { assetError, type AssetError } from '../domain/asset-error';
import type { AssetDeps, AssetRepositories } from './ports';

export type AssetInput = {
  readonly name: string;
  readonly typeId: string;
  readonly currencyCode: string;
  readonly accountId: string | null;
  readonly notes: string;
};

export type ValuationInput = { readonly valuedOn: Day; readonly amount: string };

export type StreamInput = {
  readonly name: string;
  readonly kind: StreamKind;
  readonly amount: string;
  readonly schedule: Schedule;
};

type AssetResult = Result<Asset, AssetError>;
type StreamResult = Result<ExpectedStream, AssetError>;

const notFound = (what: string) => err(assetError('not-found', `${what} not found.`));

async function amountIn(repositories: AssetRepositories, code: string, amount: string) {
  const currency = await repositories.currencies.get(code);
  return currency ? parseDecimal(amount, currency.decimals) : notFound('Currency');
}

/** An edit may keep what was archived since, so an old asset stays correctable. */
async function buildAsset(
  { accounts, assets, currencies }: AssetRepositories,
  input: AssetInput,
  base: Pick<Asset, 'id' | 'currencyCode' | 'status' | 'soldOn'>,
  existing: Asset | null,
): Promise<AssetResult> {
  const candidate = validateAsset({ ...input, ...base });
  if (!candidate.ok) return candidate;
  const asset = candidate.value;
  const type = await assets.getType(asset.typeId);
  if (!type || (type.archived && type.id !== existing?.typeId)) return notFound('Asset type');
  if (!(await currencies.get(asset.currencyCode))) return notFound('Currency');
  if (asset.accountId) {
    const account = await accounts.get(asset.accountId);
    if (!account || account.systemRole !== null) return notFound('Account');
    if (account.archived && account.id !== existing?.accountId) {
      return err(assetError('account-archived', `${account.name} is archived.`));
    }
    if (account.currencyCode !== asset.currencyCode) {
      return err(assetError('currency-mismatch', `Choose an account in ${asset.currencyCode}.`));
    }
  }
  return candidate;
}

async function buildStream(
  repositories: AssetRepositories,
  input: StreamInput,
  base: Pick<ExpectedStream, 'id' | 'assetId'>,
): Promise<StreamResult> {
  const asset = await repositories.assets.getAsset(base.assetId);
  if (!asset) return notFound('Asset');
  const amount = await amountIn(repositories, asset.currencyCode, input.amount);
  if (!amount.ok) return amount;
  return validateStream({ ...input, ...base, amount: amount.value });
}

export function createAssetUseCases({ store, clock, generateId }: AssetDeps) {
  const changeStatus = (
    id: string,
    change: (asset: Asset) => AssetResult,
  ): Promise<AssetResult> =>
    store.atomic(async ({ assets }) => {
      const existing = await assets.getAsset(id);
      if (!existing) return notFound('Asset');
      const changed = change(existing);
      if (changed.ok) await assets.saveAsset(changed.value);
      return changed;
    });

  return {
    listTypes: () => store.assets.listTypes(),

    saveType: (input: {
      readonly id: string | null;
      readonly name: string;
    }): Promise<Result<AssetType, AssetError>> =>
      store.atomic(async ({ assets }) => {
        const name = input.name.trim();
        if (!name) return err(assetError('invalid-asset-type', 'Enter a name.'));
        const existing = input.id ? await assets.getType(input.id) : null;
        if (input.id && !existing) return notFound('Asset type');
        const type = { archived: false, ...existing, id: input.id ?? generateId(), name };
        await assets.saveType(type);
        return ok(type);
      }),

    setTypeArchived: (id: string, archived: boolean): Promise<Result<void, AssetError>> =>
      store.atomic(async ({ assets }) => {
        const existing = await assets.getType(id);
        if (!existing) return notFound('Asset type');
        await assets.saveType({ ...existing, archived });
        return ok(undefined);
      }),

    listAssets: () => store.assets.listAssets(),
    getAsset: (id: string) => store.assets.getAsset(id),

    createAsset: (input: AssetInput): Promise<AssetResult> =>
      store.atomic(async (repositories) => {
        const { currencyCode } = input;
        const base = { id: generateId(), currencyCode, status: 'active', soldOn: null } as const;
        const asset = await buildAsset(repositories, input, base, null);
        if (asset.ok) await repositories.assets.saveAsset(asset.value);
        return asset;
      }),

    /** The currency stays: stored values are minor units of it. */
    updateAsset: (id: string, input: AssetInput): Promise<AssetResult> =>
      store.atomic(async (repositories) => {
        const existing = await repositories.assets.getAsset(id);
        if (!existing) return notFound('Asset');
        const { currencyCode, status, soldOn } = existing;
        const base = { id, currencyCode, status, soldOn };
        const asset = await buildAsset(repositories, input, base, existing);
        if (asset.ok) await repositories.assets.saveAsset(asset.value);
        return asset;
      }),

    /** Its expected flows stop from `soldOn`. The sale itself is a transaction like any other. */
    sellAsset: (id: string, soldOn: Day): Promise<AssetResult> =>
      changeStatus(id, (asset) => sellAsset(asset, soldOn.trim(), todayOf(clock))),

    reopenAsset: (id: string): Promise<AssetResult> =>
      changeStatus(id, (asset) => ok({ ...asset, status: 'active', soldOn: null })),

    listValuations: async (assetId: string): Promise<Valuation[]> =>
      (await store.assets.listValuations()).filter((valuation) => valuation.assetId === assetId),

    /** Stays out of the ledger: a new value is not cash. */
    addValuation: (assetId: string, input: ValuationInput): Promise<Result<Valuation, AssetError>> =>
      store.atomic(async (repositories) => {
        const asset = await repositories.assets.getAsset(assetId);
        if (!asset) return notFound('Asset');
        const amount = await amountIn(repositories, asset.currencyCode, input.amount);
        if (!amount.ok) return amount;
        const valuation = validateValuation(
          { id: generateId(), assetId, valuedOn: input.valuedOn.trim(), amount: amount.value },
          todayOf(clock),
        );
        if (valuation.ok) await repositories.assets.saveValuation(valuation.value);
        return valuation;
      }),

    removeValuation: async (id: string): Promise<Result<void, AssetError>> => {
      await store.assets.removeValuation(id);
      return ok(undefined);
    },

    listStreams: async (assetId: string): Promise<ExpectedStream[]> =>
      (await store.assets.listStreams()).filter((stream) => stream.assetId === assetId),

    getStream: (id: string) => store.assets.getStream(id),

    createStream: (assetId: string, input: StreamInput): Promise<StreamResult> =>
      store.atomic(async (repositories) => {
        const stream = await buildStream(repositories, input, { id: generateId(), assetId });
        if (stream.ok) await repositories.assets.saveStream(stream.value);
        return stream;
      }),

    updateStream: (id: string, input: StreamInput): Promise<StreamResult> =>
      store.atomic(async (repositories) => {
        const existing = await repositories.assets.getStream(id);
        if (!existing) return notFound('Stream');
        const stream = await buildStream(repositories, input, existing);
        if (stream.ok) await repositories.assets.saveStream(stream.value);
        return stream;
      }),

    removeStream: async (id: string): Promise<Result<void, AssetError>> => {
      await store.assets.removeStream(id);
      return ok(undefined);
    },
  };
}
