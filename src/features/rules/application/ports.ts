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
  /** Unpaired sides of `kind`: waiting, or posted alone with their transaction still there. */
  listPairCandidates(kind: RuleKind, from: string, to: string): Promise<InboxItem[]>;
  /** Deletes unresolved items received before `cutoff`, and returns how many. */
  purgeUnresolvedBefore(cutoff: string): Promise<number>;
}

export interface RuleRepositories extends SplitRepositories {
  readonly rules: RuleRepository;
}

export interface RuleStore extends RuleRepositories {
  atomic<T>(work: (repositories: RuleRepositories) => Promise<T>): Promise<T>;
}

export type RuleDeps = {
  readonly store: RuleStore;
  readonly clock: Clock;
  readonly generateId: IdGenerator;
};
