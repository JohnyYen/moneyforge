# MoneyForge

Open source personal finance app for Android. It is local-first: all data stays on the device in SQLite, and there is no server.

MoneyForge is built for people who keep money in several fiat currencies and stablecoins, split income by percentage, and want bank messages turned into transactions by rules they define themselves.

MoneyForge never moves real money and never holds custody of funds.

## Stack

- Expo SDK 58 with Expo Router, React Native, and TypeScript in strict mode
- SQLite on the device
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

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
