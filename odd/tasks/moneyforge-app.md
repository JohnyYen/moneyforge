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

Review base for the next candidate: `fa3305f`.

- [x] T1 Scaffold: Expo app, TypeScript strict, lint, Jest, folder structure, README. Commit: `feat: scaffold Expo app`.
- [x] T2 Ledger core: money, currencies, accounts, categories, double-entry journal, transfers, conversions, reconciliation, SQLite, base screens. Commits: `a151036`, `5bab646`, `09b24b9`.
- [x] T2.1 Ledger hardening: verified T2 defects (amount entry, rollback recovery, posting load paging, currency decimals, conversion consistency, double submit, queue re-entrancy, same-day rate test, foreign key check) plus editing and deleting transactions. Commits: `1ed15f4`, `f6d34bd`.
- [ ] T3 Income split: structures, percentages, pending move tasks, screens.
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

## Next step

T3 Income split. Run the ledger on a device or emulator when a toolchain exists.
