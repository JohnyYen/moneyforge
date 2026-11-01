import type { Clock, IdGenerator } from '@/features/ledger/application/ports';
import type { SplitRepositories } from '@/features/split/application/ports';

import type { InboxItem } from '../domain/inbox-item';
import type { Rule, RuleKind } from '../domain/rule';
import type { MessageSource } from '../domain/source';

export interface RuleRepository {
  listSources(): Promise<MessageSource[]>;
  getSource(id: string): Promise<MessageSource | null>;
  findSourceBySender(sender: string): Promise<MessageSource | null>;
  saveSource(source: MessageSource): Promise<void>;

  listRules(sourceId: string): Promise<Rule[]>;
  getRule(id: string): Promise<Rule | null>;
  saveRule(rule: Rule): Promise<void>;
  /** Items built by the rule stay, with no link to it. */
  removeRule(id: string): Promise<void>;

  getItem(id: string): Promise<InboxItem | null>;
  saveItem(item: InboxItem): Promise<void>;
  /** Open items, plus posted income still waiting to be split. */
  listOpenItems(): Promise<InboxItem[]>;
  findItemByReference(sourceId: string, referenceKey: string): Promise<InboxItem | null>;
  listItemsByBodyHash(sourceId: string, bodyHash: string): Promise<InboxItem[]>;
  /** Unpaired sides of `kind` in the range: open, or posted alone with their transaction. */
  listPairCandidates(kind: RuleKind, from: string, to: string): Promise<InboxItem[]>;
  /** The same sides as `listPairCandidates`, however long ago they arrived. */
  listUnpairedSides(kind: RuleKind): Promise<InboxItem[]>;
  /**
   * For items received before `cutoff`, deletes the unmatched ones and erases the text of the
   * rest, which carry money and dedup keys. Returns how many changed.
   */
  purgeUnresolvedBefore(cutoff: string): Promise<number>;
}

export interface RuleRepositories extends SplitRepositories {
  readonly rules: RuleRepository;
}

export interface RuleStore extends RuleRepositories {
  atomic<T>(work: (repositories: RuleRepositories) => Promise<T>): Promise<T>;
}

export type SecretGenerator = () => string | Promise<string>;

export type RuleDeps = {
  readonly store: RuleStore;
  readonly clock: Clock;
  readonly generateId: IdGenerator;
  /** Called outside any write, so it may take its time. */
  readonly generateSecret: SecretGenerator;
  /** Runs after a source is saved. It must not reject: the source is already stored. */
  readonly onSourcesChanged?: () => Promise<void>;
};
