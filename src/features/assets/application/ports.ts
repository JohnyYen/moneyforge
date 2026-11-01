import type { Clock, IdGenerator, LedgerRepositories } from '@/features/ledger/application/ports';

import type {
  Asset,
  AssetType,
  ExpectedStream,
  RuleLink,
  StreamPayment,
  TransactionLink,
  Valuation,
} from '../domain/asset';

export interface AssetRepository {
  listTypes(): Promise<AssetType[]>;
  getType(id: string): Promise<AssetType | null>;
  saveType(type: AssetType): Promise<void>;

  listAssets(): Promise<Asset[]>;
  getAsset(id: string): Promise<Asset | null>;
  saveAsset(asset: Asset): Promise<void>;

  /** Newest first, of every asset. */
  listValuations(): Promise<Valuation[]>;
  /** Keeps one value per asset and day. A later save replaces it. */
  saveValuation(valuation: Valuation): Promise<void>;
  removeValuation(id: string): Promise<void>;

  listStreams(): Promise<ExpectedStream[]>;
  getStream(id: string): Promise<ExpectedStream | null>;
  saveStream(stream: ExpectedStream): Promise<void>;
  /** Links to the stream stay, on the asset alone. */
  removeStream(id: string): Promise<void>;

  listLinks(): Promise<TransactionLink[]>;
  /** Links to a stream, with what each transaction says now. */
  listPayments(): Promise<StreamPayment[]>;
  getLink(transactionId: string): Promise<TransactionLink | null>;
  saveLink(link: TransactionLink): Promise<void>;
  removeLink(transactionId: string): Promise<void>;

  listRuleLinks(): Promise<RuleLink[]>;
  getRuleLink(ruleId: string): Promise<RuleLink | null>;
  saveRuleLink(link: RuleLink): Promise<void>;
  removeRuleLink(ruleId: string): Promise<void>;
  ruleExists(ruleId: string): Promise<boolean>;

  /** True when a stored amount here is written in this currency's minor units. */
  isCurrencyInUse(code: string): Promise<boolean>;
}

export interface AssetRepositories extends LedgerRepositories {
  readonly assets: AssetRepository;
}

export interface AssetStore extends AssetRepositories {
  atomic<T>(work: (repositories: AssetRepositories) => Promise<T>): Promise<T>;
}

export type AssetDeps = {
  readonly store: AssetStore;
  readonly clock: Clock;
  readonly generateId: IdGenerator;
};
