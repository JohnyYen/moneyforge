import type { Account } from './account';
import type { AccountGroup } from './account-group';

type Labelled = Pick<Account, 'name' | 'groupId'>;

export function groupNamesById(
  groups: readonly Pick<AccountGroup, 'id' | 'name'>[],
): ReadonlyMap<string, string> {
  return new Map(groups.map(({ id, name }) => [id, name]));
}

/**
 * How an account reads outside its group: "Bank X · EUR" for a grouped one, its plain name
 * otherwise. Derived on display, so it follows a group rename; stored names never change.
 */
export function accountLabel(account: Labelled, groupNames: ReadonlyMap<string, string>): string {
  const group = account.groupId === null ? undefined : groupNames.get(account.groupId);
  return group === undefined ? account.name : `${group} · ${account.name}`;
}

/** Copies whose `name` is their label, for display only: never save one back. */
export function withGroupLabels<T extends Labelled>(
  accounts: readonly T[],
  groups: readonly Pick<AccountGroup, 'id' | 'name'>[],
): T[] {
  const names = groupNamesById(groups);
  return accounts.map((account) => ({ ...account, name: accountLabel(account, names) }));
}
