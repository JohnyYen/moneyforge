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
- Publication target: Google Play, fully free and open source, with no monetization. The full variant ships on GitHub Releases. Play registration from Cuba is unresolved and is the user's to settle.

## Tasks

Route for every task unless noted: delegated direct, because each touches 2+ non-trivial files.

Review base for the next candidate: `a3af194`.

- [x] T1 Scaffold: Expo app, TypeScript strict, lint, Jest, folder structure, README. Commit: `feat: scaffold Expo app`.
- [x] T2 Ledger core: money, currencies, accounts, categories, double-entry journal, transfers, conversions, reconciliation, SQLite, base screens. Commits: `a151036`, `5bab646`, `09b24b9`.
- [x] T2.1 Ledger hardening: verified T2 defects (amount entry, rollback recovery, posting load paging, currency decimals, conversion consistency, double submit, queue re-entrancy, same-day rate test, foreign key check) plus editing and deleting transactions. Commits: `1ed15f4`, `f6d34bd`.
- [x] T3 Income split: structures, percentages, pending move tasks, screens. Commits: `caf80e7`, `20ac32f`.
- [x] T3.1 T3 hardening: conversion tolerance independent of how the rate is written, stall deadline from the first waiter, previews that reflect rejection, derived received amount preview, stale save error, metadata kept on edit, forms that cannot strand after saving, migration upgrade test. Commit: `d55be54`.
- [x] T4 Rules engine: sources, rule templates with test samples, inbox, dedup, own-transfer pairing, per-rule split mode, paste input. Share input moved to T5. Commits: `599e7d8`, `ba5ea65`.
- [x] T4.1 T4 hardening: verified review findings on one-time codes, number scanning, replays, lone transfer sides, reference keys, cross-currency pairs, field caps, purge, rule samples, keyed hashes, `secure_delete`, and `allowBackup`. Commits: `7b1a098`, `49a47f4`.
- [ ] T5 SMS capture: Kotlin Expo module, config plugin, two variants, opt-in screen, Android share target. Depends on an Android toolchain for build proof. Background capture must not open a second database connection: all access goes through the one queued `SqlDriver`, because a second connection would lose `PRAGMA foreign_keys` and `secure_delete` and escape the write queue that dedup relies on. Status: code complete; Kotlin never compiled; no Gradle build, no APK, no device run, user asked to install nothing yet.
- [x] T5.1 T5 review advisories: keep the queue on a read failure, guard extra removal, keep a consumed share from replaying after process death, require a real amount for the authorization code exemption, make drain independent of navigation. Kotlin uncompiled. Commit: `f44a2e1`.
- [x] T6 Planning: flexible budgets, recurring items, cash flow projection. Commits: `ce411fd`, `70e822f`.
- [x] T6.1 T6 hardening: verified review findings on backfill of auto items, budget and recurring double counts, posted notes, rollover edits, refunds, restore on a due date, per-date markers, future budgets, currency decimals, unprojected transfers, and rate lookups. Commits: `a33fdc5`, `5485a50`.
- [x] T7a Assets: types, values, expected and actual cash flow, reports, portfolio, net worth with assets, projection source, Assets tab. Planning follow-ups included. Commits: `ac6a8a5`, `9d4dabf`, and the `feat(assets): add the Assets tab and link transactions from their screens` commit that records this line.
- [x] T7a.1 T7a hardening: verified findings on stream edits, coverage by amount and current transaction state, overdue expenses, budget double counts, late payments, projection notices, link failures, and report figures. Commit: `df4f609`.
- [x] T7b On-chain balances: read-only balances by public address. Commits: `abdcd66` (T7a.1 advisory), `c717c4b`, and the `feat(onchain): add the on-chain screens` commit that records this line.
- [x] T8a CSV and rule packs: T7b advisories, CSV import and export, shareable rule packs, Data screen. Rule packs exclude samples. Commits: `c383635` (advisories), `d6144b0`, and the `feat(rules): add shareable rule packs` commit that records this line.
- [x] T8a.1 T8a hardening: verified findings on packs taking over a source, rule selection stopping at a failure, CSV preview and undo, export round trips, all-accounts files, packs storing personal senders, dates, caps, fallbacks, control characters, and semicolon formulas. Commits: `c20c997`, and the `fix(transfer): show what an import will do, undo it, and survive a round trip` commit that records this line.
- [ ] T8b Backup: encrypted export and import. Backup must carry `rules.dedup_secret` and `imported_rows`, or every stored dedup key and import fingerprint stops matching after a restore. A chain endpoint may hold an API key, so a plain export must leave `onchain_chains.endpoint` out or say so.
- [ ] T8c Release: CI, docs, store listing, privacy policy.

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
- review: medium, reviewed and approved by native review (one lens); advisory R3-untested-error-clearing left as later work.

T4 done. Route: delegated direct; 2+ non-trivial files.

T4 evidence:

- RED, domain: 5 suites failed with `Cannot find module`. RED, application and storage: 91 failed of 91 across 2 suites. RED, UI model: its suite failed with `Cannot find module`.
- GREEN: `pnpm test`: 35 suites, 597 tests passed.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0.
- `pnpm expo export --platform android`: exit 0, one 3.1 MB Hermes bundle.
- Acceptance: a test snapshots every row of every table around a message from an unknown sender and finds no change, and another finds neither the body nor the sender in any column. Own-transfer tests cover both arrival orders, one source or two, a race, and a conversion with both amounts.
- Most of the application suite passed on its first run against real code, so these mutations were run, and each failed tests: `atomic` with no transaction (5), posted sides not offered as candidates (2), allowlist ignoring `enabled` (1), body kept on post (30), one-time code check removed (4), pairing ignoring the counterpart (1).
- Not run: no device run, Gradle build, or screen rendering test, since no render test library is installed. Migration 003 ran on `node:sqlite` over a version 1 database with data, never under `expo-sqlite`. Every new screen and `purgeExpired` at app start are compiled, never executed. `rules-model` is tested on its own.
- Decisions:
  - One source per normalized sender, so a message always resolves to one dedup scope and SMS plus paste counts as one. An SMS needs a source with channel `sms`. A paste can name any source, because a person chose it, and an unknown sender is still dropped.
  - `applySplit` was extracted from `applyStructure` and takes the repositories of a running write, because calling a service's `atomic` from inside another would deadlock on the driver queue. Posting and splitting are one write. A refused automatic split leaves the income posted, flagged for the user, with the reason in the note.
  - The first rule whose template fits decides, even when its amount then fails. Trying a looser rule on an amount its rule could not read would be a guess.
  - A currency other than the rule account's sends the message to unmatched, because income and expense post in the account's currency. `{currency}` reads ASCII letters only, so a code with digits cannot come from the text.
  - Thousands groups must be exactly 3 digits, so `1,00,000` is unreadable, and a leading `.50` is refused.
  - A template needs `{amount}` once and at least 3 fixed characters, so no rule can match everything. Free fields need text after them; `{amount}`, `{balance}`, and `{currency}` do not, which reads `COP150,000`.
  - Middle text uses `indexOf` from the current position, with no backtracking. The worst case is message length times template length, bounded by the caps of 2000 and 500 characters.
  - The one-time code check runs only on messages no rule matched, following the brief. Purchase notices often carry an authorization code, and dropping them would lose real transactions. So a user's rule that fits a one-time code does store it.
  - One-time detection errs towards privacy: a word such as `code` or `pin` next to 4 to 8 digits counts, so a real unmatched message of that shape is dropped.
  - Dedup compares only the normalized body, not an amount: the body holds the amount, and comparing would make an edited item's replay look new. The body key is a 64-bit FNV-1a hash, since no crypto library is installed. Outside the window, a message with no reference counts as new even on a replay, because it cannot be told from a repeated purchase. Defaults: 24 hours for duplicates, 72 for transfers.
  - Pairing needs the same two accounts mirrored. Across currencies amounts are free, so the oldest candidate wins. A side posted alone stays a candidate, so a late side joins that transfer. A deleted transfer stops being a candidate.
  - A pair posts by itself only when both rules have `autoPost`; otherwise it waits for one approval. Rejecting one side, or editing it, returns the other to waiting.
  - `inbox_items.transaction_id` is `ON DELETE SET NULL`, so `deleteTransaction` and `undoMove` keep working. A CHECK refuses a body on a resolved item.
  - Resolved items are never purged, because they are what makes a replay inert. They keep extracted fields such as the counterparty, but no body.
  - Building a rule from an item copies the message into the rule's samples, which outlive retention. T8 must keep samples out of shared rule packs or scrub them.
  - The main tab's composition moved from split to `src/features/rules/ui/main-screen.tsx`, because rules depends on split. A failed purge at start does not block the app and runs again on the next start.
- Known limit: two sides arriving outside the window can each be posted alone by the user, making two transfers. Each one is an explicit choice. Superseded in T4.1.
- review: medium, granted by the user, but native review refused with lens_context_budget_exceeded; independent verifier found 2 blockers and 5 majors, fixed in T4.1.

T4.1 done. Route: delegated direct; 2+ non-trivial files.

T4.1 evidence:

- RED: `pnpm test`: 83 failed of 676, 10 suites. All findings were written as tests first and ran against the T4 code.
- GREEN: `pnpm test`: 35 suites, 676 tests passed.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0.
- `pnpm expo export --platform android`: exit 0, one 3.1 MB Hermes bundle.
- Blockers fixed: `Your OTP 482913 for purchase of 250 USD at Amazon` with a matching `autoPost` rule now leaves every table unchanged, and `Tail {amount}{*}` on `Tail 1,500 USD` with `.` format no longer stores 1.00.
- Not run: no device run, Gradle build, or screen rendering test. `expo-crypto`, `secure_delete` under `expo-sqlite`, and `allowBackup` in a built manifest are compiled or configured, never executed. `assertSecureDeleteEnabled` ran against `node:sqlite` and fakes. `useApproveItem`, its `Alert`, the rule editor hint, and the copy warning's wiring are compiled, never executed; `templateCopyWarning` is tested on its own.
- Decisions:
  - Supersedes "the one-time code check runs only on messages no rule matched". It now runs on every message before rule selection. `auth code`, `authorization code`, `approval code`, and `código de autorización` are removed before the weak `code` plus digits test, because that test would otherwise drop purchase notices now that it runs first. Beyond the brief: `approval code` and the Spanish forms. A template whose literals read as a one-time code fails `compileTemplate`, so the editor shows it as well.
  - Migration 003 was not edited, which differs from the brief. The kind sits inside the keyed reference hash, so the existing `(source_id, reference_key)` index already keys on kind plus reference. A `kind` column in the index would break twice: rejecting clears `kind`, and an edit changes it, and either would let a replay back in. The schema is unreleased, so a later change would still edit 003 directly.
  - Supersedes "FNV-1a" and "outside the window a message with no reference counts as new". Both dedup keys are HMAC-SHA256 with a label, under `rules.dedup_secret` in `settings`. The secret is created on the first accepted message, outside any write, so a dropped sender or a one-time code writes nothing at all. A write settles a first-use race.
  - `@noble/hashes` is pinned at 1.8.0 because 2.x ships ESM only, which Jest would not transform without a `jest.config.js` change.
  - The reference key is hashed inside the ingest write, because the rule that reads the reference is chosen there. It is a synchronous call, so it awaits nothing and cannot hold the driver queue. The body hash and the secret are computed before the write opens.
  - Same text with no reference is never dropped and never posts by itself. It is held as `proposed` with `autoPost` off and a "Possible repeat" note, and it skips automatic pairing. The window now only changes the wording, "within 10 minutes" against "earlier". The setting became `dedupWindowMinutes` under a new key. A rejected message with no reference that returns therefore asks again, where it used to be inert.
  - Only a matching reference is a silent replay. A message first seen before its rule existed has no reference key to match, so it is held too.
  - A lone side being approved looks for an opposite side at any distance through `listUnpairedSides`. It answers `confirmation-required`, and `otherSide: 'same'` or `'different'` settles it, because a monthly transfer of the same amount may be a separate movement. Pair candidates now include lone `proposed` sides, so a side held as a repeat can be found. Confirming across currencies posts from both amounts without showing the implied rate first.
  - A side that disagrees with the amount of a movement posted alone stays `proposed` with a note, because a posted item is invisible in the inbox. Same-currency sides are covered too, for a transaction edited after posting.
  - The purge deletes unmatched rows only, and erases the body of `proposed` and `waiting_pair` items, which are never deleted. Pairs stay linked, so the code that returned a partner to waiting is gone.
  - Field cap: 64 characters for `{counterparty}`, `{reference}`, and `{balance}`, failing the match in `matchTemplate`, so no note is stored when no other rule fits. `{amount}` fails in `evaluateRule` with a note that does not repeat it.
  - Space thousands: each reading the text allows runs the rest of the template, and two that both fit are a no-match. `Paid {amount} days` on `Paid 500 300 days` has one reading, 500300, so it matches; `Paid {amount} {*}` does not. The field cap bounds the readings.
  - Supersedes "building a rule copies the message into the samples". The template is still prefilled, and the copy warning fires on a literal from the message with a digit or 12 or more characters. Short wording stays quiet, because every template must share some with its message.
  - Retention in hours may not be shorter than the transfer window.
  - An ingest failing after the secret was created keeps the secret, which holds nothing from the message. The two `atomic writes` tests ingest once first, so their snapshots stay exact.

T4.1 review evidence:

- review: medium, granted by the user. Native review found `R3-otp-auth-code-regression`, CRITICAL, introduced by removing `auth code` from the strong one-time-code words.
- The one bounded correction `82faf63` was rejected by the targeted validator, because `Your authorization code for this payment is 482913` still passed. The lineage ended escalated with `native_stop_required`, so no approval or receipt exists for this candidate.
- Follow-up outside the review lifecycle: an authorization code is exempt only with a purchase word and a separate amount. RED: 3 failed of 47. GREEN: `pnpm test`, 35 suites, 683 tests passed; typecheck and lint exit 0.
- Environment: mise `node@latest` points at an empty 26.5.0 install, so commands use 26.4.0 explicitly.

T5 code complete, not closed. Route: delegated direct; 2+ non-trivial files.

T5 evidence:

- RED: `pnpm test`: 5 suites failed, 20 failed of 722, with the Kotlin sources and modules absent.
- GREEN: `pnpm test`: 40 suites, 786 tests passed.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0.
- `pnpm expo export --platform android`, offline: exit 0, one 3.2 MB Hermes bundle, fetched nothing.
- `APP_VARIANT=play` and `APP_VARIANT=full` `pnpm expo config --type introspect`, offline, ran the plugin through Expo's own resolver on the real template manifest. Play: no SMS permission, no receiver, share filter present, `allowBackup` false. Full: only `RECEIVE_SMS`, the receiver with `BROADCAST_SMS`, share filter, `allowBackup` false.
- `expo-modules-autolinking search --platform android` finds `message-capture` under `modules/` with no `package.json`.
- Mutations, each failing tests: entry removed before ingest (2), no single-flight drain (1), `\uFEFF` and `\u00A0` removed from the Kotlin pattern (2), plugin adding SMS in both variants (3).
- Kotlin was checked against `node_modules/expo-modules-core` and the Android API by reading only. `java` exists here but `kotlinc` does not. The Kotlin sender pattern itself runs in Jest over the shared vectors, extracted from `SenderNormalizer.kt`, with `toLowerCase` standing in for `lowercase()`.
- Not run: Kotlin compile, Gradle build, APK, device run, or screen rendering test. The receiver, queue file, `AtomicFile` use, preferences, `OnNewIntent`, the `requestedPermissions` constant, `PermissionsAndroid`, `Linking.openSettings`, `CaptureHost`, the settings screen, and the paste screen's shared text are unproven at runtime. The `useRootNavigationState()?.key` wait in `CaptureHost` is the least certain piece: if it never fires, app start drains and shares stay stuck.
- Decisions:
  - `MAX_BODY_CHARS` is 2001, one past `MAX_MESSAGE_LENGTH`, so a long message still reaches ingest as too long instead of being cut into a valid one. A Jest test pins it to the JS limit.
  - A full queue refuses the new message and keeps what it holds, 200 entries or 256 KB. Nothing counts refusals, so that loss is silent, though the SMS stays in the default SMS app.
  - The queue is in `noBackupFilesDir`, not `filesDir`, because `allowBackup=false` does not cover device-to-device transfer on Android 12 and later. No extraction rules XML is needed. The sender allowlist in SharedPreferences is not excluded from that transfer.
  - Availability is read from the installed package's `requestedPermissions`, so the constant cannot disagree with the manifest and needs no second flag.
  - The plugin takes `variant` from `app.config.ts`, and also removes `RECEIVE_SMS` and the receiver in Play, so a stale full `android/` folder cannot leak them. Beyond the brief.
  - The receiver has `android:permission="android.permission.BROADCAST_SMS"`, so no other app can forge a message into the queue. Beyond the brief.
  - Permission and app info use React Native's `PermissionsAndroid` and `Linking.openSettings`, which keeps Kotlin smaller.
  - `drain` is single-flight, because an overlapping run would ingest the same entry twice, and a message with no reference would then be held as a possible repeat. An entry whose ingest throws stays queued and later entries continue, so a message that always fails holds a slot until something changes.
  - Turning capture off stops the receiver first, then drains, so what was accepted while on still reaches the inbox.
  - The share text lives in memory in `createMessageCapture`, not in route params. The paste screen copies it into state and clears it on mount.
  - `RuleDeps.onSourcesChanged` runs after a source is saved. A failed sync does not fail the save, and every foreground syncs again. A stale allowlist can only over-capture, and ingest still drops what the current sources refuse.
  - A message that arrives with the app open waits for the next foreground, as specified. An open inbox does not refresh after a foreground drain until it regains focus.
  - On a Play bundle, or any binary without the module, `requireOptionalNativeModule` returns null and `absentMessageCapture` makes everything inert. A deep link to `/rules/capture` redirects to `/rules`.
- `.gitignore` has `android/`, which also matches `modules/message-capture/android`, so those sources were added with `git add -f`. They stay tracked, but a new file there is ignored until `.gitignore` gets `!modules/**/android/` and `!modules/**/android/**`.
- Environment: text sent through this tool had `\uXXXX` escapes decoded into raw characters, so the Kotlin pattern and the fixture were rewritten from Python and checked to be ASCII.
- review: medium, approved by native review; advisories addressed in T5.1

T5.1 done. Route: delegated direct; 2+ non-trivial files.

T5.1 evidence:

- RED: `pnpm test --testPathPatterns 'capture-host-flow|domain/message'`: 2 suites failed, 8 failed of 64, the flow suite with `Cannot find module`. The Kotlin fixes have no test and were never compiled.
- GREEN: 13 rules suites, 432 tests passed. `pnpm test`: 41 suites, 810 tests passed; typecheck and lint exit 0.
- Decisions:
  - The queue treats only a missing file as empty. Any other read failure propagates, so `append`, `remove`, and `read` fail and leave the file. JSON that cannot be parsed moves to `message-capture-queue.corrupt.json`, the newest replacing an older one, so unreadable messages stay bounded. Nothing reads that file back.
  - The receiver's `runCatching` absorbs an `append` failure, so that SMS stays only in the default SMS app, and JS `drainQueue` reads a failed read as empty until the next drain.
  - A launch intent can replay after process death because Android saves it, so `takeSharedText` compares a SHA-256 digest of the text with a digest kept in preferences. `OnNewIntent` neither reads nor writes the digest, because a new intent cannot replay and writing it would lose the digest of the launch intent that can. Cost: launching the app by sharing the exact text of the last launch share opens nothing.
  - `hasMoneyAmount` replaces counting numbers. Currency codes are a known list, because any 3 letters would pass `REF 5521`. An obscure currency with no decimals and no amount word therefore fails toward privacy. The authorization code digits are removed first, so `authorization code of 884211` cannot prove itself. `de 2026`, `por 5 minutos`, and `of 6 digits` do not count. A year-shaped amount such as `of 2000` beside an authorization code is dropped, on the same privacy side.
  - Supersedes the T5 note on the `useRootNavigationState()?.key` wait. `createCaptureHostFlow` drains on start and foreground with no navigation, takes a share as soon as it arrives, and opens the paste screen once the navigator is ready. If the key never appears, draining still works and only the share waits. `CaptureHost` uses the imperative `router`, so the flow is not rebuilt.

T6 done. Route: delegated direct; 2+ non-trivial files.

T6 evidence:

- RED: domain, 6 suites failed with `Cannot find module`. Application, 52 failed of 70. UI model, its suite failed with `Cannot find module`.
- GREEN: `pnpm test`: 50 suites, 1004 tests passed.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0.
- `EXPO_OFFLINE=1 pnpm expo export --platform android`: exit 0, one 3.3 MB Hermes bundle.
- The planning suites also passed with `TZ` set to `America/New_York`, `Pacific/Auckland`, `Asia/Kolkata`, and `Pacific/Pago_Pago`, 194 of 194 each.
- A test caught `updateItem` keeping the old fields, because `existing` overwrote the input. Fixed.
- Mutations, each failing tests: confirm with no pending check (1), every month capped at 28 (4), missing rate read as zero (4), zero counted as negative (1), week start ignored (1), marker never written (3). Removing the occurrence lookup failed nothing at first, because the unique key covers races. A new test for a restart after a marker that was never written then failed on it (1).
- Tests prove exact bigint on 18 decimal amounts, both ends of each period kind, month-end clamping, leap years, no double materialization across restarts and overlap, balanced auto posts, missing rates reported, and first negative dates.
- Not run: no device run, Gradle build, or screen rendering test. Migration 004 ran on `node:sqlite` only, never under `expo-sqlite`. Every Plan screen, `ProgressBar`, `BalanceBars`, `ToggleChips`, the tab icon, and `materializeDue` at app start are compiled, never executed. `plan-model` is tested on its own.
- Decisions:
  - The ledger has no reversal kind. Spending is `kind = 'expense'` only, so transfers, conversions, adjustments, and transfer fees never count. A refund recorded as income does not lower a budget or history expense. A deleted expense leaves both.
  - A budget's categories include their subcategories. Beyond the brief. A cycle in parents ends the walk.
  - Budget conversion uses the rate of the expense day. `findRate` returns nothing for a rate dated later, so that currency is reported as missing even when a later rate exists.
  - Rollover carries surplus and overspend, starting with the period holding `startsOn`: the creation day, or a custom budget's own first day.
  - Yearly budgets take a start month as well as a start day, since a day alone cannot name a day of the year. Beyond the brief.
  - Occurrences copy the item, so an edit reaches only dates after `materialized_through`. Editing a schedule cannot add past dates.
  - A new item with a past start backfills from that start, in `auto` mode too, so a daily item started long ago posts many entries at once. There is no cap.
  - Each date is one write. A refused post writes pending with a note in that write, and a thrown failure rolls back whole and then writes pending in a second one. If even that fails, the date and later ones of that item wait, and the marker stays back. Other items continue.
  - `materialized_through` moves to today only after all of an item's dates exist. Restoring an archived item moves it to today, so archived time does not come back.
  - `materializeDue` also runs when the Plan tab gains focus and after saving an item, for an app left open across midnight. Beyond the brief.
  - Posted occurrences are dated at local noon of the due day, which always exists under daylight saving. A deleted transaction leaves the occurrence `posted` with no link, so the date does not return.
  - A recurring transfer needs one currency, because a conversion needs a rate that a template cannot know.
  - Income with `applySplit` uses `splitProposalFor`, extracted from `split-service.ts` so it runs inside the posting write. No default structure, or a refused split, leaves the income posted with a note.
  - Confirming edits amount, description, and date. Category and account are not editable there, and a skip is final, so a mistaken skip needs a manual entry.
  - Projection totals convert at today's rates. Pending and overdue dates count as due today. Archived accounts and their flows are left out. Pending split moves are not projected.
  - Budgets in the projection: only with opt-in, what remains of each current period leaves the total, never an account, once, on the day the period ends or on the horizon's last day. An overspent budget reserves nothing. Later periods are not reserved, and a recurring expense in a budgeted category counts twice under this option.
  - Planned one-offs dated before today are ignored, not moved up.
  - `ExpectedCashFlowSource` returns `ExpectedFlow`s in the account's currency, passed through `createAppServices` as `expectedSources`. T7 implements it.
- review: medium, granted by the user, native review refused with lens_context_budget_exceeded; independent verifier found 1 blocker and 4 majors, fixed in T6.1

T6.1 done. Route: delegated direct; 2+ non-trivial files.

T6.1 evidence:

- RED: `pnpm test --testPathPatterns features/planning`: 36 failed of 238, 6 suites, and the new reservation suite failed with `Cannot find module`. Finding 7 failed through the changed `stops while archived` test. Finding 13 is spacing only, with no behavior to test.
- GREEN: `pnpm test`: 51 suites, 1068 tests passed.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0.
- `EXPO_OFFLINE=1 pnpm expo export --platform android`: exported one 3.3 MB Hermes bundle.
- The planning suites also passed with `TZ` set to `America/New_York`, `Pacific/Auckland`, and `Pacific/Pago_Pago`, 258 of 258 each.
- Blocker fixed: a daily `auto` item with start 2016 now posts one entry, today's. The brief's scenario, 1000 with two 100 budgets on one category and a 40 recurring expense, ends at 900.
- No migration changed: migration 004 already held everything this needed.
- Not run: no device run, Gradle build, or screen rendering test. The Plan tab's notes section and dismiss, the editor notices, the refund chips, and the budget hints are compiled, never executed. `pastStartNotice` and `budgetRow` are tested on their own.
- Decisions:
  - Supersedes "a new item with a past start backfills from that start, in `auto` mode too". A new `auto` item starts with the marker on yesterday. An existing `auto` item still catches up after days away, with no cap.
  - The cap keeps the newest 60 dates of an `ask` item, and earlier dates are gone for good once the marker passes them. Keeping the oldest would add 60 more on every run, because `materializeDue` runs on each Plan tab focus, so a 2016 start would still end at 3653 rows. The notice is a note on the oldest kept occurrence, which survives the editor closing and clears when that date is confirmed. So a person away from a daily `ask` item for more than 60 days loses the older dates, with that note.
  - Beyond the brief: an `ask` item edited to `auto` moves its marker up to yesterday, so a backlog never posts.
  - Supersedes "a recurring expense in a budgeted category counts twice under this option". The reservation moved to the pure `reserveBudgets` in `domain/budget-reservation.ts`. Each budget subtracts all of its own expected outflows, not only unconsumed ones, plus what earlier budgets sharing a category reserved. That gives the brief's rule: the flow leaves once, and the 860 and 800 outcomes do not occur. Budgets go in name order.
  - Overlap shares the whole earlier reservation even when only one category is shared, so partly overlapping budgets can reserve less than the most they allow.
  - Only outflows reduce a reservation, and an overdue pending date counts against the current period, since the projection dates it today, even though confirming it would date it in its own period.
  - `ExpectedFlow.categoryId` is optional, so a T7 source does not have to supply one. Flows on accounts outside the projection cover nothing.
  - Supersedes "restoring moves it to today". The marker moves to yesterday, so a restore on a due date keeps that date.
  - Supersedes "a refund recorded as income does not lower a budget". Income in a budget's categories is negative spending, so `spent` can go below zero, and the bar then reads empty. History is unchanged.
  - Editing the amount, period, or rollover moves `startsOn` to today, or to a custom budget's own first day when that is later, and the carry starts from zero. Categories and currency do not restart it, as the brief lists; both also recompute past periods.
  - Posted notes show the newest 50. A pending note cannot be dismissed, because it explains what still needs doing.
  - `CurrencyUsageGuard` is a port on `LedgerRepositories`, defaulting to no other use, and `createAppServices` passes `planningCurrencyUsage`. Only the ledger service's store needs it, since only `updateCurrency` reads it. Planned rows have no currency, so that check joins their account.
  - `converterOn` resolves a rate once. A zero balance in a currency with no rate still does not report it.
- review: medium, approved by native review

T7a done. Route: delegated direct; 2+ non-trivial files.

T7a evidence:

- RED, planning follow-ups: `pnpm test --testPathPatterns features/planning`: 9 failed of 270, 3 suites. `keeps what carried over through a save with nothing changed` passed before the fix too: the round trip did not restart a carry, so it only guards the new comparisons.
- RED, assets: domain, 3 suites failed with `Cannot find module`. Application: every test failed, on `services.assets` missing.
- GREEN: `pnpm test`: 57 suites, 1177 tests passed.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0.
- `EXPO_OFFLINE=1 pnpm expo export --platform android`: exported one 3.4 MB Hermes bundle.
- The assets suites also passed with `TZ` set to `Pacific/Auckland`, `Pacific/Pago_Pago`, and `America/New_York`, 97 of 97 each.
- Mutations, each failing tests: no cover filter (4), sale ignored (4), sale day still expected (3), yield on a partial net (1), no `ON DELETE CASCADE` (1), rule hook never run (1).
- Tests prove exact bigint on 18 decimal values and ratios, valuations leaving `transactions`, `postings`, balances, and net worth unchanged, links surviving an edit and dropping on delete, streams in the projection with no double count including early payment and the rule path, sold assets stopping, and missing rates reported in reports, the portfolio, and net worth with assets.
- Over the 2500 line target: about 4130 authored lines, 1346 of them tests. Commits are sliced so review can take them apart: the planning fix, then domain to storage, then the UI.
- Not run: no device run, Gradle build, or screen rendering test. Migration 005 ran on `node:sqlite` only, over a version 1 database with data through the migrator test. Every Assets screen, `ScheduleFields`, `AssetLinkFields`, the entry form slot, the `home_work` tab icon, and the five tab bar are compiled, never executed. `asset-model` is tested on its own.
- Decisions:
  - Supersedes "categories and currency do not restart" from T6.1. Both restart the carry now. `periodKey` compares what a period means, so a blank start day equals the day it defaults to, and key order or stray keys change nothing. `categoryIds` compare as a set.
  - Supersedes the marker note on capped dates: `datesDue` in the domain decides which dates a run keeps, and the projection reads the same answer, so a date the cap drops is never projected, whether the run has not happened yet or failed.
  - A transfer flow carries no category, so it can never reduce a budget reservation.
  - A linked account must be in the asset's currency, and streams are written in that currency, because `ExpectedCashFlowSource` amounts are in the account's currency and that port has no way to report a missing rate. An asset whose rent lands in an account in another currency either uses that currency or has no linked account; its streams then still appear in reports but not in the projection.
  - The currency of an asset is fixed after creation, because values and streams store its minor units. `updateAsset` ignores a new one. `CurrencyUsageGuard` now combines planning and assets in `createAppServices`.
  - Default types are seeded by migration 005, so they run once and stay editable. Types are archived, not deleted. Assets cannot be deleted in this task.
  - `asset_transaction_links` is keyed by transaction, so one transaction links to one asset, and linking again moves it. Only income and expense link. An edit that later turns a linked entry into a transfer keeps the row, and reports ignore it.
  - No double count needs an explicit stream and date, not a guess from amounts: `due_on` holds the stream date a transaction fulfils, chosen by `nearestDue` as the closest date no other transaction took, within 3 steps either way, the earlier one on a tie. So rent received 2 days early covers its date, and a second payment takes the next open date. With no date in reach it links to the stream and covers nothing.
  - Only dates from today on are projected, so an unpaid past stream date is not carried as overdue, unlike a pending recurring date. Reports do count it as expected.
  - "By a rule" is the new `RulePostHook` port on `RuleRepositories`, a factory like `CurrencyUsageFactory`, run inside the posting write. `asset_rule_links` lives with assets, so rules stay unaware of them. Rules link from the asset's "Rules that link here" screen, not from the rule editor. A stream of the other kind falls back to the asset alone rather than refusing the post.
  - Current value is the latest by date, one per asset and day, and a later save replaces it. A future date is refused, so is a future sale date. A sale amount is an ordinary linked income.
  - `netYield` is empty while any linked currency has no rate, because a ratio of a partial net reads as a real figure. `actual` still shows what it could convert, with the missing rates reported. It is the period's net over the latest value, not annualized.
  - Actual totals convert at the rate of each entry's day into the asset's currency, through `summarizeHistory`, which expected amounts also go through. The portfolio converts values at today's rate and counts this calendar month's links, sold assets included, because that money really moved.
  - Net worth with assets is one more `computeNetWorth` call over balances plus values, so a total is never the sum of two rounded ones. It is off by default, and the choice is not stored.
  - The report offers this month, this year, and the last 12 months. `assetReport` takes any range, so a custom one needs only a UI.
  - `NewTransactionWithAsset`, `TransactionWithAsset`, and `MainScreenWithAssets` wrap the split and rules screens from `src/features/assets/ui`, so neither imports assets. A link after a recorded entry is a second write: a failure there shows "Saved, but this screen could not update".
- review: medium, granted by the user, native review refused with lens_context_budget_exceeded; independent verifier found 1 blocker and 4 majors, fixed in T7a.1

T7a.1 done. Route: delegated direct; 2+ non-trivial files.

T7a.1 evidence:

- Base: `aaa85ce`. Commit: `df4f609`.
- RED: `pnpm test --testPathPatterns features/assets`: 26 failed of 108, and the `asset-flows` suite failed to run on the missing `paymentMeasure`.
- GREEN: `pnpm test`: 57 suites, 1229 tests passed.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0.
- `EXPO_OFFLINE=1 pnpm expo export --platform android`: exported one 3.5 MB Hermes bundle.
- The assets suites also passed with `TZ` set to `Pacific/Auckland`, `Pacific/Pago_Pago`, and `America/New_York`, 149 of 149 each.
- Mutations, each failing tests: asset guard before the split guard (1), coverage ignoring the amount (4), no refresh on a stream edit (1), asset guard not wired (2).
- Migration 005 was edited directly, unreleased: `asset_streams.category_id`.
- Not run: no device run, Gradle build, or screen rendering test. `AssetProjectionNotices`, the stream category chips, the Plan cash flow wrapper, and the save alert are compiled, never executed. `projectionNotices`, `linkAfterSave`, and `droppedSelectionNotice` are tested on their own.
- Decisions:
  - Supersedes the `due_on` rule of T7a. `assignDueDates` places every payment of a stream, oldest first, and `refreshStream` writes the answer. It runs on link, unlink, a link moved away, a rule link, a stream edit of any field, and through `createAssetChangeGuard` on a transaction edit or delete. So the result does not depend on link order, and removing a payment gives its date back to the others.
  - Beyond the brief: delete and unlink also refresh, and a stream edit refreshes on any field, not only the schedule, because the amount decides which dates are full.
  - Coverage sums the current amounts stored dates hold, through `listPayments`, a join that reads kind, day, amount, and currency from the transaction. A payment of another kind is ignored and its `due_on` empties, and it returns if the kind does.
  - Beyond the brief: a linked amount in another currency is measured at the rate of its day. With no rate it counts as zero, so the date stays expected, because `ExpectedCashFlowSource` cannot report a missing rate.
  - A date with part of its amount paid still projects the whole stream amount, as the brief says a short amount covers nothing. So a 500 paid on a 1000 date overstates what is still due by 500 until the date is covered.
  - `transactionGuard` in `createAppServices` runs split first, since a refusal must come before any write, and assets never refuse. Only the ledger service runs guards, and it is the only caller of `updateTransaction`.
  - Supersedes "an unpaid past stream date is not carried as overdue". Uncovered expense dates from the last 90 days, from the stream's start and before a sale, are carried to today. The lookback lives in `expectedAssetFlows`, so `cash-flow-use-cases.ts` did not change. Income is not carried.
  - A late payment takes the most recent open date at or before its day when that is within half a step, `DAYS_PER_UNIT` times `every`. Otherwise the closest open date wins, as before.
  - A stream category must match its kind, as on recurring items. `categoryId` is required on `ExpectedStream` and empty by default.
  - "Overlapping schedule" means the same kind, amount, unit, and `every` on the same account, with overlapping date ranges. Two monthly items on different days match, since that is how a duplicate usually looks. A monthly and a weekly item of the same amount do not.
  - `projectionNotices` covers only active assets with a stream that has not ended. An asset with no streams shows no notice, so the old "Link an account" line no longer shows there.
  - `CashFlowScreen` takes `projectionExtra`, and `CashFlowWithAssets` wraps it, so planning still does not import assets.
  - `linkAfterSave` turns a refused or thrown link into an alert and always continues to the split proposal. Supersedes the last sentence of the T7a wrapper decision for a link failure. An alert, because the screen is about to leave.
  - `difference` is empty while rates are missing. The report's latest value is the latest by the end of its period.
- review: medium, approved by native review
- Advisories, with the warning text not exported, so each location was read on its own:
  - `asset-flows.ts:75-77`: a part paid date projected in full. `9893cf8` fixed it through `paidByDate`, and supersedes the T7a.1 decision that a date with part of its amount paid projects the whole amount. Nothing further is wrong here. An amount above a date's stream amount does not spill to the next date, on purpose: the excess may be a fee, and spilling would be a guess.
  - `asset-flows.ts:108-110`: `9893cf8` carries only what is left of an overdue date. One gap remained: an expense stream entered late counted up to 90 days of unlinked dates as owed, with nothing to warn the person. Fixed in `abdcd66` with `overdueStartNotice` in the stream editor. RED: 2 failed of 29. The carrying itself stays, as T7a.1 decided.
  - `asset-projection-notices.tsx:12-32`: a failed load showed nothing, and a repeated message repeated a key. `9893cf8` fixed both, through a notice and `shownNotices`. Nothing further is wrong here.

T7b done. Route: delegated direct; 2+ non-trivial files.

T7b evidence:

- RED: domain, 5 suites failed with `Cannot find module`. Client, its suite failed the same way. Service, 36 failed of 36. UI model, its suite failed with `Cannot find module`, and the rate limit message failed 1 of 37.
- GREEN: `pnpm test`: 65 suites, 1395 tests passed.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0.
- `EXPO_OFFLINE=1 pnpm expo export --platform android`: exported one 3.6 MB Hermes bundle.
- The on-chain suites also passed with `TZ` set to `Pacific/Auckland`, `Pacific/Pago_Pago`, and `America/New_York`, 159 of 159 each.
- Mutations, each failing tests: `refresh` ignoring the switch (2), `refreshAll` ignoring it (1), no secret refusal (6), `saveRead` with no row guard (3), no decimals check (1), network inside a write (4), no EIP-55 check (1), no token chain check (1), comparison ignoring finer digits (1).
- Live smoke, read-only, with the real client under Node and no key. Read each token contract's own balance. Tron at `api.trongrid.io`: USDT 9782781.902930, decimals 6. Ethereum at `ethereum-rpc.publicnode.com`: USDT 1216042.640875, decimals 6, chain ID 1. A wrong chain ID returned `chain-mismatch`.
- From that run: TronGrid answered 429 to the next two reads, so a keyless Tron refresh of several addresses can fail. The `CONTRACT_VALIDATE_ERROR` shape and a Tron owner with no activity were therefore never seen live; only fakes cover them.
- USDC on Ethereum was confirmed live before seeding: `symbol()` returned `USDC` and `decimals()` 6 at `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`.
- Over the 2000 line target: about 3270 authored lines, 1370 of them tests. Commits are sliced so review can take them apart: domain to storage at 2274 lines, then the UI.
- Not run: no device run, Gradle build, or screen rendering test. Migration 006 ran on `node:sqlite` only. `fetch` under Hermes, `AbortController` there, `redirect` and `credentials` handling in React Native, every On-chain screen, `ScreenedField`, the reconcile prefill, and `router.dismissTo` are compiled, never executed. `onchain-model` is tested on its own.
- Decisions:
  - The token's `symbol` must equal the linked account's currency code, because `compareBalance` means nothing across currencies. An account is optional. Editing a symbol later stops the comparison and keeps the link.
  - `LastRead` stores its own decimals, so editing a token cannot reinterpret an old amount. A new contract clears reads of that token. A new address or token on a watched row clears its read.
  - Beyond the brief: EVM endpoints must answer `eth_chainId` with the stored chain ID, so a pasted URL of another network cannot return a plausible balance. Tron has no such check, because a Tron read has no equivalent call in use here.
  - Beyond the brief: `saveRead` is a conditional update on id, token, address, contract, and time. The network runs outside any write, so a read of something edited or removed meanwhile is dropped, and an older answer cannot replace a newer one.
  - An EVM read costs 3 calls and a Tron read 2. Decimals come first, so a contract that cannot answer costs nothing more. Refresh all runs one address at a time.
  - Timeout 8 seconds per call, 2 attempts, retry only on timeout, connection failure, 429, or 5xx. The timer is raced as well as aborting, because a React Native body read may ignore abort. React Native's `text()` has no byte limit, so an undeclared large body is bounded by the timeout and refused after reading. Declared length is refused before reading.
  - Endpoint text is never shown. An RPC error shows its code only, and messages name the host only, because a path may hold an API key.
  - Endpoints must be `https://` with no credentials, parsed with a pattern, since React Native's `URL` has no hostname.
  - The secret guard runs first in every use case, on every typed field including the endpoint, so a 64 hex API key in an endpoint path is refused too. `ScreenedField` also drops such text before it reaches form state. Beyond the brief: extended private keys, 15, 18, and 21 words, and a key inside longer text. With no word list, 12 or more words of 3 to 8 letters are refused, which errs toward refusing a real sentence.
  - An amount finer than the account's decimals rounds down. If that is the only difference, the status is `within-precision` and nothing is offered, because reconcile refuses extra digits.
  - A stale read may still open reconcile, with the read time and a notice on screen. The form says it was filled in, and the person must press Reconcile.
  - Stale means older than one hour, a constant, not user data.
  - Chains and tokens can be added and edited, not deleted. A family and a token's chain are fixed once created.
- review: medium, approved by native review

T8a done. Route: delegated direct; 2+ non-trivial files.

T8a evidence:

- RED, advisories: `pnpm test --testPathPatterns features/onchain`: 13 failed of 173, 3 suites. RED, CSV: 3 suites failed with `Cannot find module`. RED, packs: the domain suite failed with `Cannot find module`, and 15 failed of 15 in the service suite.
- GREEN: `pnpm test`: 71 suites, 1601 tests passed.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0.
- `EXPO_OFFLINE=1 pnpm expo export --platform android`: exit 0, one 3.7 MB Hermes bundle.
- The transfer suites also passed with `TZ` set to `Pacific/Auckland`, `Pacific/Pago_Pago`, and `America/New_York`, 127 of 127 each.
- Mutations, each failing tests: `autoPost` on (2), unknown pack fields allowed (11), pack rules unchecked (9), a refused pack rule returned instead of thrown (1), pack rule dedup off (2), formulas not neutralized (9), known rows ignored (4), no repeat count (12), batch outside a transaction (1), zero amount allowed (1), BOM kept (2).
- Over the 2500 line target: about 3440 authored lines before this document, about 1240 of them tests. Commits are sliced: advisories, CSV, packs.
- Not run: no device run, Gradle build, or screen rendering test. Migration 007 ran on `node:sqlite` only. Every Data screen, the paste screen's CSV action, and `Share.share` with a large message are compiled, never executed. `transfer-model` is tested on its own.
- Advisories, each fixed:
  - `R3-chain-edit-keeps-reads`: a new endpoint or chain ID clears that chain's reads, a rename does not, and `saveRead` also matches the endpoint and chain ID, so a read in flight is dropped.
  - `R3-future-read-blocks-refresh`: supersedes the T7b rule that a later `readAt` always wins. `readAt` is now when the read started, and a stored time after now yields. So of two running reads, the one asked later wins, whichever answers last. A read dated in the future counts as stale.
  - `R3-refresh-all-ignores-switch-off`: the switch is asked before each address. Skipped addresses report the network-disabled message. A read already sent still lands.
  - `R3-tron-query-endpoint`: the call path goes before the query, and a fragment is dropped.
  - `R3-duplicate-failure-keys`: `refreshFailures` returns the address id with each message.
- Decisions:
  - Import is one atomic batch of the valid rows, not per row, so a retry never meets half a file. Invalid and duplicate rows are skipped and reported. A failure while writing throws inside the write, because a returned error commits. The plan is computed again inside the write, so the result can differ from the preview if data changed between them.
  - The fingerprint uses the install's `rules.dedup_secret`, under the label `csv-row`, so a backup has one secret to carry. `keyedHash` moved to `src/shared/keyed-hash.ts`. It covers account, day, kind, amount, and folded description, not text, so a re-export in another format still matches, and not category, so recategorizing does not duplicate. A repeat count keeps identical rows of one file apart.
  - Fingerprints live in `imported_rows`, deleted with their transaction, so a deleted row can be imported again. It shows in the preview as new. Entries typed by hand or posted from a message are not compared.
  - Nothing is detected: separator, columns, date order, number format, and the meaning of a positive amount are all chosen. A two-digit year, brackets, currency marks, and exponents are invalid. A time after a date is dropped. In debit and credit columns a zero counts as empty, because banks often fill the unused side with 0.00, and a negative is invalid.
  - Rows post at local noon. Imported income runs no split and rules run no hooks. Categories match by folded name within the kind: two matches or an archived match make the row invalid, since creating a twin would hide the problem. One import creates up to 100 categories. A fallback is chosen per kind, and empty means no category.
  - Caps: 1,000,000 characters, 5000 rows, 64 columns, 2000 characters a cell. The first row sets the column count. A row of another width is invalid.
  - Export uses `Share` with text. `expo-file-system` is present only through `expo`, and `expo-sharing` is absent, so no file is written. Past 200,000 characters it refuses and asks for a shorter range, because an Android intent fails near 1 MB. That limit is reasoned from Binder, never observed on a device.
  - Export writes one row per posting on a user account, so a transfer shows both sides and a fee sits inside the sending amount. Amounts use a point and are the only unneutralized cells that can start with a minus. A description such as `-5 apples` gains an apostrophe, and importing it back keeps that apostrophe.
  - The pack format has no field for auto-post, split mode, samples, or ids, so those are refused as unknown rather than reset. Import then sets `autoPost` off and `splitMode` to `ask` on income. Other kinds stay `none`, because `validateRule` allows a split only on income, which differs from the brief's plain `ask`.
  - The rule's `currencyCode` is left out of packs, because a stored value must equal the account's currency, so null means the same. Slots are derived from the rules, and export names them `Account 1` and `Income category 1`, because an account name can hold card digits. Templates and sender names are exported as written, with a warning to read them.
  - A rule counts as known by source, template, kind, and number format. An existing source keeps its own name, channel, and enabled state. A new source starts enabled, so the sender joins the allowlist on confirmation, and the preview says so. `onSourcesChanged` runs after the write.
  - Slot mappings are `Map`s, because a slot name comes from the pack and may be `__proto__`. Rule packs depend on no transfer code; `shareText` lives in `src/shared/ui`.
- review: medium, granted by the user, native review refused with lens_context_budget_exceeded; independent verifier found 3 majors, fixed in T8a.1

T8a.1 done. Route: delegated direct; 2+ non-trivial files. Migration 007 was edited in place because it is unreleased: `imported_rows` gained `batch_id` and an index.

T8a.1 evidence:

- RED: 7 suites, 72 failed of 276.
- GREEN: `pnpm test`: 71 suites, 1666 tests passed.
- `pnpm typecheck`: exit 0.
- `pnpm lint`: exit 0.
- `EXPO_OFFLINE=1 pnpm expo export --platform android`: exit 0, one 3.7 MB Hermes bundle.
- The transfer suites also passed with `TZ` set to `Pacific/Auckland`, `Pacific/Pago_Pago`, and `America/New_York`, 173 of 173 each.
- Mutations, each failing tests: undo confirming for the person (1), no priority shift (2), new sources on (4), capture told about sources left off (1), no apostrophe fold (1), any export refused (2), no change guard on the transfer store (1).
- About 1080 changed lines, about 560 of them tests.
- Not run: no device run, Gradle build, or screen rendering test. The new preview lines, toggles, and undo button are compiled, never executed. `previewLines` and `undoLines` are tested on their own. The export screen warning is copy, with no test. Migration 007 ran on `node:sqlite` only.
- Decisions:
  - Supersedes T8a: a new pack source starts off, not enabled. `enabledSenders` holds the normalized senders a person turned on in the preview. Capture is told only when one was.
  - Supersedes T4: `selectRule` no longer stops at a fitting rule that fails. The first rule that works decides, so a looser rule may now read an amount a stricter one refused. With none, the first failure stays as the inbox note.
  - New pack rules shift below the lowest stored rule as a group, not each clamped, so their order holds. A tie counts as taking over. Rules already lower stay. The preview uses the same code as the import, so it shows the final priority. It lists only rules that would be added.
  - Undo deletes through the same guards as a manual delete, wired from `transactionGuard`, which is now a required argument of the transfer store. It never passes `confirmed`, so a row with a split stays and is reported, and can be deleted by hand. Categories the import created stay.
  - Undo is offered only on the import screen, until the next import or until it is used. `batch_id` persists, but nothing lists past batches, so leaving the screen loses the button. Listing them needs an import time, and is a follow-up if wanted.
  - An all-accounts export is told from a one-account export by its rows, since the header is the same: the exact header plus two or more values in the account column. An all-accounts export that only ever touched one account passes, and is safe for the same reason.
  - A mapped currency column compares case-insensitively, and an empty cell is invalid.
  - Templates with a direction mark are refused in packs, including on export. An Arabic bank's template that holds U+200F must lose it first.
  - The control set also covers U+2029, U+200E, and all C1 controls, since they sit beside the ones asked for.
  - A category exported with a leading apostrophe still imports with it, as a name match. Only `rowIdentity` folds.
  - The batch test now forces a failure with a SQL trigger, because checking fallbacks in the plan removed the only way to fail mid-write. `BatchRefused` stays as a defensive path.

## Next step

T8b: encrypted backup, carrying `rules.dedup_secret` and `imported_rows`, including `batch_id`. T5 stays open until a toolchain exists: compile the Kotlin, build both variants with `APP_VARIANT`, inspect each merged manifest, and on a device test a share, a real SMS with the app closed, a multipart SMS, permission denial, restricted settings, and the drain. Also run the ledger, split, rules, Plan, and Assets screens there, including migrations 002 to 007 over an existing database under `expo-sqlite`. Also run the On-chain screens there, with `fetch`, timeouts, and the reconcile prefill under Hermes, and the Data screens, including `Share` with a large CSV.
