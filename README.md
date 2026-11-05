# MoneyForge

Open source personal finance app for Android. It is local-first: all data stays on the device in SQLite, and there is no server.

MoneyForge is built for people who keep money in several fiat currencies and stablecoins, split income by percentage, and want bank messages turned into transactions by rules they define themselves.

MoneyForge never moves real money and never holds custody of funds.

## Status

Pre-release. The JavaScript is type-checked, linted, and tested. Both Android variants, including the SMS capture module, build and are signed on GitHub Actions, but the app has not yet been verified on a device. Android is the only target.

## Install

Download the latest APK from [GitHub Releases](https://github.com/JohnyYen/moneyforge/releases/latest):

- [`moneyforge-full.apk`](https://github.com/JohnyYen/moneyforge/releases/latest/download/moneyforge-full.apk): everything, plus opt-in SMS capture. It asks for permission to receive SMS and reads nothing until you turn capture on.
- [`moneyforge-play.apk`](https://github.com/JohnyYen/moneyforge/releases/latest/download/moneyforge-play.apk): the same app without SMS capture. You add movements by hand or by sharing a bank message to MoneyForge.

Both links always point to the newest release. Android asks you to allow installs from your browser the first time. Each release lists SHA-256 checksums in `SHA256SUMS.txt`, and every APK is signed with the same key (certificate SHA-256 `9C:F3:34:A2:28:C7:5E:DF:AB:E7:DD:59:54:EC:4E:6A:C5:5F:1C:0C:6D:BA:83:40:B3:2C:4C:95:97:4F:93:B2`), so updates install over the previous version.

## Release

Bump `version` in `app.config.ts`, commit, then push a matching tag:

```sh
git tag v0.2.0 && git push origin v0.2.0
```

The `Release` workflow refuses a tag that does not match `version`, builds and signs both variants, checks the signing certificate, and publishes the release with both APKs and `SHA256SUMS.txt`. Pushes to other branches that touch native code build unsigned check APKs only.

## Features

| Area | What it does |
|------|--------------|
| [Ledger](#ledger) | Accounts in several fiat currencies and stablecoins, transfers, conversions, and reconciliation, on a hidden double-entry journal. |
| [Income split](#income-split) | Split an income by percentage into a list of moves to make. |
| [Message rules](#message-rules) and [capture](#message-capture) | Turn bank messages into transactions with rules you write, through paste, share, or opt-in SMS capture. |
| [Planning](#planning) | Flexible budgets, recurring items, and a cash flow projection. |
| [Assets](#assets) | Assets with expected and actual cash flow, reports, and a portfolio total. |
| [On-chain balances](#on-chain-balances) | Read-only token balances by public address, from endpoints you configure. |
| [Data](#data) | CSV import and export, shareable rule packs, and encrypted backups. |

## Privacy

- Your data stays in a database on your device. There are no accounts, analytics, or ads.
- The only network requests are on-chain balance reads. They are off until you turn them on, and run only when you press Refresh.
- Android cloud backup is turned off for the app's data.
- Exports leave the device only through the share sheet, to where you choose. Backups are encrypted with your passphrase.

Read the full [privacy policy](docs/privacy-policy.md).

## Stack

- Expo SDK 58 with Expo Router, React Native, and TypeScript in strict mode
- SQLite on the device through `expo-sqlite`, with handwritten versioned migrations
- Jest for tests, ESLint with the Expo config for linting
- pnpm with the hoisted node linker

## Run it

Requires Node.js with `node:sqlite` support (used by the tests) and pnpm.

```sh
pnpm install
pnpm start      # Expo dev server
pnpm android    # dev server, opening on a connected device or emulator
```

Checks:

```sh
pnpm test
pnpm typecheck
pnpm lint
```

CI runs the same checks on every push and pull request, then exports the Android bundle with `EXPO_OFFLINE=1 pnpm expo export --platform android`. See [the workflow](.github/workflows/ci.yml).

## Build variants

`app.config.ts` reads `APP_VARIANT`. Any other value fails the build.

| `APP_VARIANT`    | App name        | Android package       |
| ---------------- | --------------- | --------------------- |
| `play` (default) | MoneyForge      | `app.moneyforge`      |
| `full`           | MoneyForge Full | `app.moneyforge.full` |

Both variants accept text shared from other apps. Only `full` declares `RECEIVE_SMS` and the SMS receiver, through `plugins/with-message-capture.js`. The Play variant declares no SMS permission.

## Architecture

Screaming and hexagonal: the folder tree names what the app does, and dependencies point inward.

```text
app/                      Expo Router routes, kept thin
src/
  features/<feature>/
    domain/               pure business rules
    application/          use cases and ports
    infrastructure/       adapters, such as SQLite
    ui/                   screens and components
  app-services/           wires the features together, the one place that knows them all
  shared/                 code with no feature of its own
assets/                   icons and splash images
```

## Ledger

Accounts, categories, and currencies are user data. Defaults are seeded once and stay editable.

Every movement is a double-entry journal entry whose postings sum to zero per currency. Each currency has hidden system accounts for income, expense, equity, and conversion clearing. The app shows only user accounts.

Money is a `bigint` in minor units, stored as TEXT, because stablecoins reach 18 decimals. Exchange rates are exact decimal strings. Floats are never used for amounts or rates.

`src/shared/persistence` holds the `SqlDriver` port, the migrations, and the `expo-sqlite` and `node:sqlite` adapters. Tests run the production SQL on `node:sqlite`.

Editing a transaction rebuilds it through the same factories and validation as recording it, then replaces its postings in one write, so every saved entry still balances. Deleting removes its postings with it. Opening balances change only through their account, and reconciliations can be deleted but not edited.

An amount with more fractional digits than its currency allows is rejected, even when the extra digits are zeros, because `1,500` typed on a comma keyboard reaches the parser as `1.500`. Currencies with 3 or more decimals stay ambiguous, so every amount and rate field previews what will be stored.

A conversion given both a received amount and a rate is rejected when they disagree beyond the precision the rate was written with: a rate of `0.92` accepts anything from `0.915` to `0.925`. Leave the received amount empty to calculate it from the rate.

Net worth leaves archived accounts out. A currency with no stored rate to the base currency is reported as missing, not valued at zero.

## Income split

A split records a plan for an income and lists the moves to make. It never moves money.

- A structure is your own data: named lines, each with a label, a target account, and an exact percentage. They total 100%, or one line takes the remainder.
- Applying a structure stores a snapshot of its lines, so later edits never rewrite past runs. An income can have one run.
- Allocation uses bigint arithmetic and the largest-remainder method, so the amounts sum exactly to the income.
- A line targeting the income's own account stays in place and creates no move. A line in another currency becomes a conversion, and you enter the amount received when you complete it.
- Completing a move records a real transfer or conversion, with the actual amount and fee, in one write. Undoing it deletes that transaction.
- Editing the amount, account, or kind of a split income, or deleting it, is refused while a move is done. With no move done, it cancels the split once you confirm. Deleting a linked transfer returns its move to pending.
- A default structure per income category or account is proposed when you record income. The category wins.

## Message rules

Bank messages become transactions through rules you write. Everything starts with `ingestMessage({ channel, sender, body, receivedAt })`, which both the paste screen and SMS capture call.

- A source is a sender you trust, matched exactly after ignoring case, spaces, and dashes. A message from anyone else is discarded before anything is written. An SMS needs a source that accepts SMS. A paste can name any source, so the same message by SMS and by paste counts as one.
- Rules use safe templates, never regular expressions, so an imported rule cannot hang the app: `You received {amount} {currency} from {counterparty}. Ref {reference}`. Placeholders are `{amount}`, `{currency}`, `{reference}`, `{counterparty}`, `{balance}`, and `{*}`. Matching walks the message once and never backtracks, and a message over 2000 characters is never matched and its text is not kept. A named field over 64 characters fails the match. With space as the thousands separator, `500 300 days` is one number only if the template leaves no other reading; otherwise nothing matches. Write a literal brace as `{{` or `}}`.
- Each rule has a number format, so `1.500,25` and `1,500.25` become the same exact amount. An amount the format cannot read, or a currency other than the account's, sends the message to the inbox as unmatched. Nothing is guessed, and a lower-priority rule does not get a second try.
- The highest priority wins among rules that fit, and ties go to the lowest id.
- Every message is checked for a one-time code before any rule runs. Those are not stored in any form, not even as a hash, whatever a rule would say, and a template that reads like one cannot be saved. An authorization code counts as a purchase detail only when the notice also states a separate amount.
- A message with no rule stays in the inbox so you can build a rule from it. Building a rule shows the message as a guide and warns about values left in the template. The message is never saved as a sample: samples are only what you type.
- A message's text is erased as soon as it is posted or rejected, and rejecting clears everything but the dedup keys. After 30 days, on app start, unmatched messages are deleted and pending items lose their text, keeping their amounts and dedup keys, so pending money is never discarded. Erased text is overwritten on disk, and the database stays out of cloud backup.
- Dedup keys are HMAC-SHA256 under a secret generated on each install, so they reveal nothing and cannot be compared across devices. One source, kind, and reference is one message, so a replay creates nothing, while a reversal with the reference of its purchase is kept. With no reference, text seen before is never dropped and never posts by itself: it waits for review with a "possible repeat" note, called a likely copy within the duplicate window of 10 minutes.
- A `transfer_out` and a `transfer_in` between the same two accounts become one movement: one transfer when the amounts match in one currency, and one conversion with both amounts when the currencies differ. A pair across currencies always waits for your approval, showing the implied rate. They can arrive in either order, from one source or two. A side with no pair waits and posts nothing, and it surfaces after the transfer window. If you post it alone, a side arriving later joins that transfer instead of adding another, unless its amount disagrees, which goes to review. Approving a lone side looks for an opposite side at any distance and asks whether they are the same transfer.
- Posting builds the entry through the ledger's own validation, in one write with any split. `splitMode` `auto` applies the structure, and if it can no longer apply, the income stays recorded and the split is offered instead. `ask` offers it in the inbox. `none` does nothing.

## Message capture

`modules/message-capture` is a local Expo module in Kotlin. Nothing SMS-related lives in its own manifest, because that merges into both variants.

Share target: sharing text into the app opens the paste screen prefilled, and you pick the source. The text stays in memory and goes through `ingestMessage` only when you submit it.

Automatic capture is in the full variant only, off by default, and turned on under Messages and rules. The app asks for `RECEIVE_SMS`, never `READ_SMS` or `SEND_SMS`.

- JavaScript copies the senders of enabled SMS sources and an on/off flag to SharedPreferences. The receiver normalizes senders exactly like `normalizeSender`; `modules/message-capture/fixtures/sender-vectors.json` holds the shared vectors.
- The receiver only accepts the `BROADCAST_SMS`-protected system broadcast, joins multipart messages, and drops anything from a sender off the allowlist without writing or logging. It never logs a body or a sender.
- Accepted messages go to an app-private queue file in `noBackupFilesDir`, written atomically and capped at 200 entries and 256 KB. A full queue refuses new messages and keeps what it holds. Bodies are cut at one character past the rule limit, so ingest still reports them as too long.
- Kotlin never opens the database, because a second connection would escape the one write queue that dedup relies on. JavaScript drains the queue on app start and on foreground, through `ingestMessage`, removing each entry only after ingest resolves. A crash replays the entry into dedup. The file is deleted when the queue is empty.

A one-time code from an allowlisted sender sits in app-private storage until the next drain, where the one-time code check discards it. A message that arrives while the app stays open waits for the next foreground. Android delivers nothing to an app that was force-stopped until it is opened again.

Android restricts SMS permissions for apps installed outside a store. The settings screen explains how to allow restricted settings and links to App info.

The Kotlin code has never been compiled here. See `odd/tasks/moneyforge-app.md` for what is proven.

## Planning

The Plan tab holds budgets, recurring items, and cash flow.

- A budget has one or more categories, including their subcategories, a currency, and a period: weekly, monthly, yearly, or a custom start and length. Expenses count, and income in one of its categories counts as a refund, which lowers spending. Transfers and conversions never do. Other currencies convert at the stored rate of the expense day, and a currency with no rate there is reported, never read as zero.
- With rollover on, what was left or overspent carries from the period the budget started in. Changing the amount, currency, categories, period, or rollover starts the carry again from zero on the day of the edit.
- A recurring item turns each date into one occurrence at app start. In `ask` mode you confirm, edit, or skip it. In `auto` mode it posts through the ledger, and stays pending with a note if posting fails. Occurrences keep their own copy, so editing an item only changes dates still to come. A new `auto` item never posts dates before today. A past date of an `ask` item stays pending, with at most the latest 60 added in one run. A note on a posted occurrence shows on the Plan tab until you dismiss it. Schedules run on local calendar days, and a monthly date clamps at short months.
- History totals income, expense, and net per period and currency, plus the base currency.
- The projection runs day by day from current balances, adding pending and future occurrences, planned one-offs, and any `ExpectedCashFlowSource`. It shows the first date each balance goes negative. Budgets stay out unless you opt in: then what remains of each current period leaves the total, not any one account, on the day that period ends or on the last day of the horizon. Expected expenses in a budget come off what it reserves, because they already leave their accounts. Budgets sharing a category reserve once: the first by name takes the expected expenses and shares its reservation, and a later one reserves only what it has beyond that.

## Assets

The Assets tab holds what you own beyond your accounts. Asset types are user data, seeded with defaults.

- An asset has a type, a currency, an optional linked account in that currency, and notes. Its currency stays fixed once created. Marking it sold stops its expected flows from that date.
- Values are dated manual entries, and the latest one is the current value. A value is not cash, so it never reaches the ledger.
- Expected flows are income or expense streams with the same schedule as recurring items. An expense stream can carry a category, so a budget on that category does not reserve the same money again.
- Actual cash flow is the income and expenses linked to an asset: from the transaction form, later from the transaction's screen, or by a message rule. A link survives edits to the transaction and goes when it is deleted. A link to a stream also places the transaction on a stream date: an open date within half a step before it, otherwise the closest open date. A date is covered once linked amounts of the stream's kind reach the stream amount, so two payments of 500 cover a date of 1000, and until then further payments stay on that date. Dates follow edits to the transaction or to the stream.
- A report for a period shows actual and expected income, expense, and net, plus net yield on the latest value by the end of the period. Linked entries in another currency convert at the rate of their day into the currency of the asset. A currency with no rate is reported, never read as zero, and the yield and the difference from expected stay empty until it has one.
- The portfolio totals active assets at today's rate and nets this month's linked cash flow, in the base currency. Net worth stays accounts only, and "Include assets" shows a second total.
- The cash flow projection adds streams of assets with a linked account, except covered dates. Uncovered expense dates from the last 90 days count today. Past income does not. A date with part of its amount paid projects only what is left of it. The stream editor warns when an expense starts in the past, because those recent dates then count as owed.
- The asset and the projection show a notice when a stream stays out: an archived account, no linked account, or no account in the asset's currency. They also show one when a stream looks like a recurring item on the same account: same kind, amount, and cadence, in overlapping date ranges. Nothing merges them.

## On-chain balances

More, then On-chain balances, reads token balances by public address. MoneyForge never holds keys, signs, or sends anything. It is read-only by construction: the client port has one method, which reads a balance.

- A watched address has a chain, a token, a public address, a label, and optionally an account to compare with. Chains and tokens are user data, seeded with USDT on Tron, USDT on Ethereum, and USDC on Ethereum, and every endpoint is editable.
- Tron addresses are checked by base58check, EVM addresses by EIP-55 when mixed case. Anything that looks like a private key or a seed phrase is refused and never stored: 64 hex characters, WIF or extended keys, or 12 or more words of 3 to 8 letters. There is no word list, so an ordinary sentence of that shape is refused too.
- Nothing is contacted until you turn network reads on in network settings, and then only when you press Refresh. There is no background polling. The endpoint learns the address and your IP address, and can tie them together. Addresses are public by design.
- Each read confirms the chain ID on EVM endpoints and checks the stored decimals against the contract. Amounts are exact, and a malformed or oversized answer is refused. Calls time out after 8 seconds, with one retry.
- The last amount and time stay available offline, marked stale after an hour.
- With a linked account, an address shows how the amount compares with the ledger, and a difference offers the reconcile form, filled in. Nothing is recorded until you press Reconcile. An account must be in a currency whose code is the token's symbol. An amount finer than the account's decimals is rounded down, and counts as a match when that is the only difference.
- Public endpoints limit keyless requests, and TronGrid does so quickly. Point a chain at your own endpoint if a refresh is refused.

## Data

Under More, Data.

CSV import reads pasted or shared text into one account. The person picks the separator, the columns, and the date and number formats, because `03/04` and `1.500` each have two readings. A row that does not fit is shown as invalid and is never guessed at. Nothing is written before the preview is confirmed. The valid rows then post in one atomic batch through the ledger, and a failure leaves nothing. Invalid and duplicate rows are skipped and reported. The preview shows the first rows as read, the date range, and the totals in and out. After importing, "Undo this import" removes that batch in one write, except rows another feature depends on, such as a split, which stay and are reported. An optional currency column makes a row in another currency invalid. An export of all accounts is refused, since its rows belong to several accounts.

Each imported row keeps a keyed fingerprint of its account, day, kind, amount, and description, so importing a file again adds nothing. Identical rows in one file stay separate entries. Deleting a transaction releases its fingerprint, so that row can return.

CSV export writes one row per account a transaction touched, with exact amounts. Text that a spreadsheet would run as a formula is neutralized with an apostrophe, also after a `;`, and importing an export back still matches the original rows. It uses the system share sheet, so it carries text and refuses more than 200,000 characters rather than cutting it short.

Rule packs share sources and rules with no personal data. See [rule-packs](rule-packs/README.md).

An encrypted backup holds all app data in one file, sealed with AES-GCM under a key derived from your passphrase with scrypt. Messages still awaiting a decision travel without their text. A backup is read back before it is shared. Restoring checks the file with the passphrase, shows what it holds, and replaces everything only after you type `REPLACE`.

## Contributing

Issues and pull requests are welcome. Before opening a pull request:

1. Keep the change inside its feature folder, following the [architecture](#architecture).
2. Add tests for domain and application behavior.
3. Run `pnpm test`, `pnpm typecheck`, and `pnpm lint`.
4. Write commit messages as [Conventional Commits](https://www.conventionalcommits.org/).

To share rules for a bank, see [contributing a pack](rule-packs/README.md#contributing-a-pack).

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
