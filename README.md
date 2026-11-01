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
  shared/                 code with no feature of its own
assets/                   icons and splash images
```

## Ledger

Accounts, categories, and currencies are user data. Defaults are seeded once and stay editable.

Every movement is a double-entry journal entry whose postings sum to zero per currency. Each currency has hidden system accounts for income, expense, equity, and conversion clearing. The app shows only user accounts.

Money is a `bigint` in minor units, stored as TEXT, because stablecoins reach 18 decimals. Exchange rates are exact decimal strings. Floats are never used for amounts or rates.

`src/shared/persistence` holds the `SqlDriver` port, the migrations, and the `expo-sqlite` and `node:sqlite` adapters. Tests run the production SQL on `node:sqlite`.

Net worth leaves archived accounts out. A currency with no stored rate to the base currency is reported as missing, not valued at zero.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
