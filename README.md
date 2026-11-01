# MoneyForge

Open source personal finance app for Android. It is local-first: all data stays on the device in SQLite, and there is no server.

MoneyForge is built for people who keep money in several fiat currencies and stablecoins, split income by percentage, and want bank messages turned into transactions by rules they define themselves.

MoneyForge never moves real money and never holds custody of funds.

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

## Build variants

`app.config.ts` reads `APP_VARIANT`. Any other value fails the build.

| `APP_VARIANT`    | App name        | Android package       |
| ---------------- | --------------- | --------------------- |
| `play` (default) | MoneyForge      | `app.moneyforge`      |
| `full`           | MoneyForge Full | `app.moneyforge.full` |

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

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
