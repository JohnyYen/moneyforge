# Account Groups

## Objective

Let one account (for example "Bank X") hold sub-accounts in different currencies, shown together with a total in the base currency.

## Problem

Every account holds exactly one immutable currency (`accounts.currency_code`, `001-ledger.ts`). A bank or wallet that keeps USD and EUR today appears as two unrelated rows in a flat list.

## Why

Real institutions hold several currencies. Users want to see them as one place, with a combined total, without losing the per-currency balances.

## Decision

The user chose the "parent account" model (2026-11-06): the parent only groups, and each sub-account is an ordinary single-currency account. The multi-currency-account model was rejected because it would break the one-account-one-currency rule used by the ledger, transfers, message rules, planning and backups.

Design defaults (parent-chosen, no product fork):

- The parent is a new `account_groups` row (`id, name, type, archived`), not an account. It has no currency and no postings, so the ledger, journal and balance code stay unchanged.
- `accounts.group_id` is a nullable FK to `account_groups`. Ungrouped accounts behave exactly as today. Only one level of nesting.
- A group holds at most one sub-account per currency (enforced in the use case and by a partial unique index on `(group_id, currency_code)`).
- A sub-account created inside a group defaults its name to the currency code.
- An existing account can be moved into or out of a group from its edit form, if the target group has no sub-account in that currency.
- The group total converts each sub-account balance to the base currency with the existing `findRate` logic. Currencies without a rate are reported as missing, never counted as zero.
- Archiving a group archives all its sub-accounts. Net worth is unchanged, because it already sums accounts.
- Moving money between sub-accounts in different currencies uses the existing conversion flow.

## Scope

- Migration `008-account-groups.ts`, the domain entity, store and use cases.
- Backup: the new table and column listed in `backup-tables.ts` with `since: 8`.
- Group balance and total computation.
- UI: the accounts list grouped by parent, a create-group flow, a group detail screen, adding a sub-account, and a group picker in the account edit form.

Out of scope: nested groups, multi-currency accounts, group-level budgets or rules.

## Constraints

- Amounts stay bigint. Balances stay derived from postings.
- Restoring a schema-7 backup must keep working: migrations replay to version 8.
- English UI copy and code. Web preview and Android both work.

## Acceptance criteria

- Creating a group with USD and EUR sub-accounts shows one parent row with a base-currency total and two child rows with their own balances.
- A second sub-account in the same currency inside one group is rejected.
- Existing accounts and backups from schema 7 work unchanged.
- Transfers and conversions between sub-accounts work with the existing flows.

## Checks

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `EXPO_OFFLINE=1 pnpm expo export --platform android`.

## Delivery

Work-unit commits on `feat/account-groups`. The forecast is about 1000 authored lines over three slices, one per task, each reviewed under RDD. Delivery follows the user's earlier choice for this repo: fast-forward to `main` after approval.

## Tasks

- [x] T9.1 Persistence and use cases: migration 008, `AccountGroup` entity, store methods, use cases (create, rename, archive, add a sub-account, move an account in or out), currency uniqueness per group, backup tables. Route: delegated (writer, 2+ non-trivial files).
- [ ] T9.2 Group balances: a domain function for the per-group total in the base currency, with missing rates; exposed by the overview use case. Route: delegated.
- [ ] T9.3 UI: grouped accounts list, create-group screen, group detail, add a sub-account, group picker in the account form. Route: delegated.

## Progress

- 2026-11-06: Explored the ledger, persistence, backup and UI (explorer). User chose the parent-account model. Branch `feat/account-groups` created from `b41bff8`.

- 2026-11-06: T9.1 done (delegated writer). Migration 008 (`account_groups`, nullable `accounts.group_id` FK, partial unique index on `(group_id, currency_code)`), `AccountGroup` entity, `accountGroups` repository, and use cases `createAccountGroup`, `updateAccountGroup`, `addSubAccount`, `moveAccountToGroup`, `setAccountGroupArchived`, `listAccountGroups`, `getAccountGroup`; `createAccount`/`updateAccount` take an optional `groupId`. Backup lists `account_groups` (since 8) and `accounts.group_id` through a new per-column `since`. RED: 16 failing tests across the use case, store, migrator and backup suites before the implementation; GREEN: `pnpm test` 78 suites, 1828 tests pass; `pnpm typecheck`, `pnpm lint` and the Android export pass. Older-schema backup tests now roll a current database back by hand, because the current store writes `group_id`; a schema-7 backup restores with every account ungrouped.

## Next step

T9.2.
