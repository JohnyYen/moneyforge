# MoneyForge app

Engram mirror topic: `odd/moneyforge-app/tasks` (status: synced by parent).

## Objective

Build MoneyForge, an open source native Android personal finance app with Expo.

## Problem and why

Budget apps rarely combine multi-currency fiat and stablecoin accounts, automatic income splitting by percentage, and rules that turn bank messages into transactions. The owner needs all of that, driven by bank SMS, and other people must be able to configure it for their own context.

## Scope

- Multi-currency accounts (fiat and stablecoins), categories, income and expenses.
- Transfers and conversions as first-class movements, with rate and fee.
- Double-entry ledger hidden from the user, plus reconciliation.
- Income split structures by percentage, producing pending "move X to Y" tasks.
- User-defined message sources and rules, a review inbox, and deduplication.
- Automatic SMS capture in the full variant; paste and share in both variants.
- Flexible budgets, recurring items, and cash flow projection.
- Assets with expected and actual cash flow; read-only on-chain balances by public address.
- Encrypted backup export and import, CSV import, and release preparation.

Out of scope: moving real money, custody, a backend server, iOS, and web.

## Constraints

- Local-first: SQLite on the device and no server.
- Money is never `float`: `bigint` in minor units, stored as TEXT because stablecoins reach 18 decimals.
- Everything user-facing is data (categories, split rules, currencies, asset types), never hardcoded.
- Only senders on the user's allowlist are persisted; other messages are discarded unread by the rule engine.
- The Play variant declares no SMS permissions. The full variant declares `RECEIVE_SMS`.
- Generated artifacts are in English. Commits use Conventional Commits with no AI attribution.

## Decisions

- Package id `app.moneyforge`, and `app.moneyforge.full` for the full variant. Confirm before the first Play upload.
- License: GPL-3.0-or-later, so forks stay open.
- Architecture: screaming and hexagonal, under `src/features/<feature>/{domain,application,infrastructure,ui}`. Routes in `app/` stay thin.
- Persistence: handwritten SQL migrations behind a small `SqlDriver` port, with `expo-sqlite` in production and `node:sqlite` in tests, so the same SQL is exercised by Jest.
- Tooling: pnpm 11 ignores `node-linker` in `.npmrc`, so `nodeLinker: hoisted` lives in `pnpm-workspace.yaml`. Build scripts for `@parcel/watcher` and `unrs-resolver` are denied through `allowBuilds` because both ship prebuilt binaries. The `lint` script calls `eslint .` directly with the Expo config.
- Delivery strategy: `exception-ok`. This is a greenfield repository with no remote, built as ordered work-unit commits on one feature branch; the forecast is above 400 authored lines per task, and PR slicing is decided when a remote exists. Each task below is a natural slice boundary.

## Tasks

Route for every task unless noted: delegated direct, because each touches 2+ non-trivial files.

Review base for the next candidate: `31855a1`.

- [x] T1 Scaffold: Expo app, TypeScript strict, lint, Jest, folder structure, README. Commit: `feat: scaffold Expo app`.
- [x] T2 Ledger core: money, currencies, accounts, categories, double-entry journal, transfers, conversions, reconciliation, SQLite, base screens. Commits: `a151036`, `5bab646`, `09b24b9`.
- [x] T2.1 Ledger hardening: verified T2 defects (amount entry, rollback recovery, posting load paging, currency decimals, conversion consistency, double submit, queue re-entrancy, same-day rate test, foreign key check) plus editing and deleting transactions. Commits: `1ed15f4`, `f6d34bd`.
- [x] T3 Income split: structures, percentages, pending move tasks, screens. Commits: `caf80e7`, `20ac32f`.
- [x] T3.1 T3 hardening: conversion tolerance independent of how the rate is written, stall deadline from the first waiter, previews that reflect rejection, derived received amount preview, stale save error, metadata kept on edit, forms that cannot strand after saving, migration upgrade test. Commit: `d55be54`.
- [ ] T4 Rules engine: sources, rule templates with test samples, inbox, dedup, own-transfer pairing, per-rule split mode, paste and share input.
- [ ] T5 SMS capture: Kotlin Expo module, config plugin, two variants, opt-in screen. Depends on an Android toolchain for build proof.
- [ ] T6 Planning: flexible budgets, recurring items, cash flow projection.
- [ ] T7 Wealth: assets, asset cash flow, read-only on-chain balances.
- [ ] T8 Data and release: encrypted backup, CSV import, shareable rule packs, CI, store listing, privacy policy.

## Acceptance criteria

- Every journal entry balances per currency; a test proves it for transfers, conversions, and splits.
- An own transfer reported by two messages produces one transfer.
- A message from a sender outside the allowlist is never persisted.
- The Play variant manifest contains no SMS permission.
- `pnpm test`, `pnpm typecheck`, and `pnpm lint` pass at each task close.

## Applicable checks

Test-first with Jest for domain and application behavior. UI screens use `tsc` and lint, plus component tests where behavior is meaningful. Android builds use Gradle when the toolchain exists; if it does not, that check is recorded as pending and never claimed.

## Progress

T1 done. Route: delegated direct; the scaffold touched 2+ non-trivial files.

T1 evidence:

- RED: `pnpm test --testPathPatterns result` failed with `Cannot find module './result'`. GREEN: after adding `src/shared/result.ts`, the suite passes.
- `pnpm test`: 3 suites, 8 tests passed, including an in-memory `node:sqlite` test.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0.
- `pnpm expo export --platform android`: exit 0, one 2.5 MB Hermes bundle.
- Pending: no Gradle build or device run yet, so runtime behavior on Android is unproven.
- Open: `pnpm lint` timed out twice during T1 and could not be reproduced once dependencies settled. Cause not established.
- review: medium, declined by the user for this candidate; spot check pnpm test passed 8/8.

T2 done. Route: delegated direct; 2+ non-trivial files.

T2 evidence:

- RED: domain and persistence suites failed with `Cannot find module` (8 failed, the 3 T1 suites passed); the application suite failed on `./ledger-service`; the UI helper suites failed on `./entry-date` and `./transaction-row-model`.
- GREEN: `pnpm test`: 14 suites, 140 tests passed.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0.
- `pnpm expo export --platform android`: exit 0, one 2.8 MB Hermes bundle.
- Tests cover balancing per currency for transfer, conversion, fee, and adjustment; the 18-decimal round trip; rejection of unbalanced entries in the domain and at the write boundary; atomic rollback on a failed posting and on a failed later step.
- Not run: no device run, Gradle build, or screen rendering test (no render test library is installed). `expo-sqlite` adapter and every screen are compiled, never executed; first run on a device is unproven.
- Decisions: net worth leaves archived accounts out and reports currencies with no rate as missing. Rate lookup is direct or inverse only, with no triangulation. A conversion fee is added to the amount sent when in the source currency, and deducted from the amount received when in the target currency. Editing and deleting recorded transactions is out of T2 scope.
- `expo-sqlite` transactions use one queued connection, because `withExclusiveTransactionAsync` opens a second connection without `PRAGMA foreign_keys`.
- Run Jest with stdin from `/dev/null` in this environment: a piped run with open stdin hung past 200 seconds once.
- review: high, declined by the user for this candidate; independent verifier ran; findings fixed in T2.1.

T2.1 done. Route: delegated direct; 2+ non-trivial files.

T2.1 evidence:

- RED, defects: `pnpm test`: 29 failed of 174, including re-entrancy cases that hung to the Jest timeout. RED, edit and delete: 11 failed of 197.
- GREEN: `pnpm test`: 18 suites, 205 tests passed.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0.
- `pnpm expo export --platform android`: exit 0, one 2.8 MB Hermes bundle.
- The same-day direct rate already worked, so its test had no RED. Removing the `sameDayDirect` branch made it fail, which proves it covers that path.
- A failed mid-replace was already atomic through the `journal.save` savepoint, so that new test also passed on its first run.
- Not run: no device run, Gradle build, or screen rendering test. The `expo-sqlite` foreign key check, `useSubmit`, the confirmation dialog, previews, and the new screen are compiled, never executed. `assertForeignKeysEnabled` and the submit gate are tested on their own.
- Decisions:
  - Amounts with more fractional digits than the currency allows are rejected, including zeros. Rates have no such bound, so `1,500` as a rate is caught only by the preview.
  - A conversion with both a received amount and a rate is rejected when they disagree beyond the precision the rate was written with, rather than derived, because a quotient may not be an exact decimal. Rate `0.92` accepts 0.915 to 0.925, and a whole number rate such as `3` accepts 2.5 to 3.5.
  - The old fixture of 10 USD at 0.92 receiving 9.13 is now rejected, so a provider spread needs the real rate or an empty received amount.
  - Re-entrancy is detected by a stall, not by call tracing: Hermes has no `AsyncLocalStorage`, and unrelated callers must keep queueing. After 2 seconds with no statement running and a caller waiting, every waiter is rejected with `ReentrantTransactionError` and never runs. Work that awaits something other than the database for that long fails unrelated waiters the same way.
  - After a failed ROLLBACK the driver raises `TransactionRollbackError`, retries before the next operation, and runs nothing until that succeeds. "No transaction is active" is matched by message and counts as rolled back.
  - `useSubmit` takes `exitsOnSuccess`, and the gate stays closed after success on screens that leave. Screens that stay reopen it.
  - Opening entries cannot be edited or deleted here; reconciliations can be deleted but not edited. An edit may keep an account or category archived since, and may change the kind. Metadata is rebuilt by the factories.
- review: high, declined by the user for this candidate; independent verifier ran.

T3 done. Route: delegated direct; 2+ non-trivial files.

T3 evidence:

- RED, domain: 5 suites failed with `Cannot find module`, and 4 `deriveRate` tests failed of 24. RED, application and storage: 2 suites failed on missing modules. RED, UI models: 2 suites failed on missing modules.
- GREEN: `pnpm test`: 26 suites, 319 tests passed.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0.
- `pnpm expo export --platform android`: exit 0, one 2.9 MB Hermes bundle.
- Tests cover allocations summing exactly (1 to 8 lines, 200 rounds each, across 0 to 18 decimals, seeded), balanced journals from completed transfers and conversions, double apply including a concurrent one, rollback mid-completion and mid-undo, snapshots surviving structure edits, and the edit and delete guards in both directions.
- Rollback tests had no behavioral RED because the modules did not exist yet. Making the split store's `atomic` run without a transaction failed exactly the 2 rollback tests and the concurrent apply test, which proves they cover it.
- Not run: no device run, Gradle build, or screen rendering test. Every split screen, `useConfirmedSubmit`, the `Alert` confirmations, `app-services-provider`, and migration 002 under `expo-sqlite` are compiled, never executed. Migration 002 did run on `node:sqlite`, but only on a fresh database, not on an existing version 1 database with data.
- Decisions:
  - The ledger stays unaware of splits. It exposes a `TransactionChangeGuard` port, bound to the transaction through `LedgerRepositories.changeGuard`, and `src/app-services` wires the split guard in. `open-ledger.ts` moved there as `open-app-services.ts`. Screens take slots (`header`, `onRecorded`, `renderFooter`), and split composes them in `ledger-screens.tsx`.
  - A guard that needs consent returns `confirmation-required`, and the caller retries with `{ confirmed: true }`. A refusal must happen before any write, because a returned error commits.
  - Only amount, account, and kind count as material on an income with a run, compared through its postings. Description, date, and category stay editable, with no cancellation.
  - Skipped moves count as not done, so an income whose moves are all pending or skipped can be canceled after confirmation. Canceling deletes the run, so a new one can be applied.
  - Beyond the brief: a linked transfer or conversion may change amount, fee, date, and description, but not its accounts or kind, because that would leave a done move describing something else. `undoMove` also returns a skipped move to pending, so a mistaken skip is not permanent.
  - The remainder line goes through largest remainder like any other line, with its exact share as the percentage, so it does not absorb all rounding.
  - A conversion needs the received amount; an empty rate is derived by the new `deriveRate`, rounded to 12 decimals (more for tiny rates). That rounding stays inside the tolerance of `isConsistentConversion`. A stated rate that disagrees is rejected.
  - A category default wins over an account default. Defaults on archived structures are ignored, not deleted.
  - Applying and completing respect archives: a run is rejected if a target is archived, and a pending move whose account was archived later cannot be completed until the account is restored, though it can be skipped.
  - The count on the main tab is a row at the top of the Accounts screen, shown when any move is pending, not a badge on the tab. The tab layout gets no focus events, so a badge would go stale.
- review: medium, declined by the user for this candidate; writer self-verification and parent spot check.

T3.1 done. Route: delegated direct; 2+ non-trivial files.

T3.1 evidence:

- RED: `pnpm test`: 31 failed of 356, 6 suites. `leaveScreen`: its suite failed with `Cannot find module`.
- GREEN: `pnpm test`: 27 suites, 358 tests passed.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0.
- Fixed, all verified findings:
  - Major: rate `1` accepted 100 USD to 149.99 USDT. Now 100.01 passes and 140 fails, with tests for rates `1`, `2`, `0.92`, 0-decimal and 18-decimal currencies, boundaries included.
  - The stall deadline runs from the first waiter; a test with 10 arrivals over 90 ms of a 100 ms deadline detects at 100 ms.
  - `0` and negatives no longer preview as "Saved as". A negative source reports non-positive, not a rate mismatch, with or without a received amount.
  - "You receive" left blank previews the derived amount.
  - A delete failure is no longer hidden by a stale save error.
  - An edit keeps metadata keys it does not manage.
  - `onSuccess` failing no longer strands a form without feedback, and a save with no back history leaves the screen.
  - A test runs migration 001, real data, then 001 and 002, and checks every ledger table row by row, the foreign key check, an 18-decimal amount, and new tables referencing old rows.
- The migration tests had no behavioral RED because the upgrade already worked. Adding `DELETE FROM exchange_rates` to migration 002 failed the row by row test, which proves it covers data loss.
- Not run: no device run, Gradle build, Android export, or screen rendering test, since no render test library is installed. `useSubmit`, `clearError` and the detail screen's banner (finding 5) have no test of their own, and `receivedPreview` is tested but its wiring in `entry-form.tsx` is compiled, never executed. `runSubmission` and `leaveScreen` are tested on their own.
- Decisions:
  - Supersedes the T2.1 tolerance. A target is consistent within half a minor unit of the target currency, or within 0.5% of the expected value, boundaries included, in exact bigint arithmetic. Rate `0.92` on 10 now accepts 9.16 to 9.24, and `0.9200` behaves the same.
  - Half a minor unit means whatever the rate itself produces is always consistent, so a blank received amount can never be rejected as a mismatch.
  - `deriveRate` starts at 12 decimals and adds 12 until `isConsistentConversion` accepts the result, replacing the old `> 0` test, which accepted a rate off by up to 100% under the new tolerance. Non-positive amounts return `0`.
  - Previews take a rule: `positive` by default, `non-negative` for fees, `any` for opening and counted balances, which may legitimately be zero or overdrawn.
  - Supersedes "metadata is rebuilt by the factories" from T2.1. Keys other than `rate`, `rateFrom`, and `rateTo` carry over an edit, and those three never survive a change away from conversion.
  - After a failure following a successful save, the gate of a screen that exits stays closed and the banner says "Saved, but this screen could not update. Go back to continue." Reopening it would offer a second write of a stored change.
  - `router.back()` with no history is a silent no-op, not a throw, so every exit goes through `leaveScreen`, which goes home instead. `onSuccess` may return a promise, so the split proposal step after recording is covered too.
- Skipped on purpose: the finding that editing an older conversion can fail the new tolerance. There are no released users, so no legacy data exists.

## Next step

T4 Rules engine. Run the ledger and split screens on a device or emulator when a toolchain exists, including migration 002 over an existing database under `expo-sqlite`.
