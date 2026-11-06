import type {
  AccountBalance,
  AccountsOverview,
  GroupOverview,
} from '../../application/overview-use-cases';
import type { Currency } from '../../domain/currency';
import { formatDisplay } from '../../domain/money';

export type AccountRowModel = {
  readonly kind: 'account';
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly trailing: string;
};

export type GroupRowModel = {
  readonly kind: 'group';
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  /** The total in the base currency, or `null` when it is not shown. */
  readonly trailing: string | null;
  readonly note: string | null;
  /** The active sub-accounts, shown beneath the group. */
  readonly accounts: readonly AccountRowModel[];
};

export type AccountsListEntry = AccountRowModel | GroupRowModel;

export type AccountsListModel = {
  readonly active: readonly AccountsListEntry[];
  readonly archived: readonly AccountsListEntry[];
  /** Whether any account, in a group or not, can take a transaction. */
  readonly hasActiveAccounts: boolean;
};

export function missingRatesNote(codes: readonly string[]): string | null {
  return codes.length > 0 ? `No rate for ${codes.join(', ')}, so it is not in the total.` : null;
}

/** A standalone account, as the list has always shown it. */
export function accountRow({ account, currency, balance }: AccountBalance): AccountRowModel {
  return {
    kind: 'account',
    id: account.id,
    title: account.name,
    subtitle: `${account.type} · ${currency.code}`,
    trailing: formatDisplay(balance, currency),
  };
}

/** A sub-account: its group gives the type, and its currency is shown unless it is the name. */
export function subAccountRow({ account, currency, balance }: AccountBalance): AccountRowModel {
  return {
    kind: 'account',
    id: account.id,
    title: account.name,
    subtitle: account.name === currency.code ? undefined : currency.code,
    trailing: formatDisplay(balance, currency),
  };
}

function groupRow(overview: GroupOverview, base: Currency | null): GroupRowModel {
  const { group, accounts, total, missingRates } = overview;
  // An active group lists the currencies it shows; an archived one, all it held.
  const shown = group.archived ? accounts : accounts.filter(({ account }) => !account.archived);
  const codes = shown.map(({ currency }) => currency.code);
  return {
    kind: 'group',
    id: group.id,
    title: group.name,
    subtitle: [group.type, codes.join(', ')].filter(Boolean).join(' · '),
    // An archived group's total leaves out its archived sub-accounts, so it would read as zero.
    trailing: base && !group.archived ? formatDisplay(total, base) : null,
    note: group.archived ? null : missingRatesNote(missingRates),
    accounts: group.archived ? [] : shown.map(subAccountRow),
  };
}

/**
 * Active groups, each with its active sub-accounts, then the active accounts outside any group.
 * Archived groups and archived ungrouped accounts go to their own section. A sub-account archived
 * on its own inside an active group is shown only on the group's screen.
 */
export function accountsListModel(
  overview: AccountsOverview,
  base: Currency | null,
): AccountsListModel {
  const groups = overview.groups.map((group) => groupRow(group, base));
  const isArchived = (id: string) =>
    overview.groups.find(({ group }) => group.id === id)?.group.archived ?? false;
  const activeGroups = groups.filter(({ id }) => !isArchived(id));
  const activeUngrouped = overview.ungrouped.filter(({ account }) => !account.archived);
  return {
    active: [...activeGroups, ...activeUngrouped.map(accountRow)],
    archived: [
      ...groups.filter(({ id }) => isArchived(id)),
      ...overview.ungrouped.filter(({ account }) => account.archived).map(accountRow),
    ],
    hasActiveAccounts:
      activeUngrouped.length > 0 || activeGroups.some(({ accounts }) => accounts.length > 0),
  };
}
