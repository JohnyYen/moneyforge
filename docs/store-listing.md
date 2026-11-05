# MoneyForge store listing

Draft copy for the Google Play listing. Every claim here comes from the [README](../README.md), the [privacy policy](privacy-policy.md), and the code. Update this file when either changes.

## Which variant goes where

| Variant | App name | Package | SMS | Store |
|---------|----------|---------|-----|-------|
| `play` (default) | MoneyForge | `app.moneyforge` | None. No SMS permission is declared. | Google Play |
| `full` | MoneyForge Full | `app.moneyforge.full` | `RECEIVE_SMS`, opt-in automatic capture | GitHub Releases |

Google Play restricts SMS permissions to apps whose core function needs them, such as default SMS handlers. MoneyForge is a finance app, so the Play variant declares no SMS permission and offers paste and share only. The full variant, with opt-in SMS capture, ships on GitHub Releases. Both are set in `app.config.ts` and `plugins/with-message-capture.js`.

This listing is for the Play variant. Do not mention automatic SMS capture as a feature of the Play build.

## App name

MoneyForge

## Short description

Limit: 80 characters. Count: 73.

```text
Local-first finance for multiple currencies and stablecoins. No accounts.
```

## Full description

Limit: 4000 characters. Count: 2406, measured on the text inside the block.

```text
MoneyForge is an open source personal finance app for people who keep money in several fiat currencies and stablecoins, split their income by percentage, and want bank messages turned into transactions by rules they write themselves.

Your data stays on your device. There is no account to create, no server, no analytics, and no ads. MoneyForge never moves real money and never holds keys or custody of funds.

LEDGER
- Accounts in any fiat currency or stablecoin, with transfers, conversions, fees, and reconciliation.
- Exact amounts: money is never stored as a floating-point number, and stablecoins keep up to 18 decimals.
- A hidden double-entry journal keeps every currency balanced.

INCOME SPLIT
- Define your own structure, such as 50% savings, 30% expenses, 20% investments.
- Each income becomes a list of moves to make. You mark them done when you make them.

MESSAGE RULES
- Paste a bank message, or share it from another app, and your rules turn it into a transaction.
- Rules use simple templates, not regular expressions, and you choose which senders to trust.
- Messages without a matching rule wait in an inbox. One-time codes are discarded.
- Rule packs let you share sources and rules for a bank without any personal data.

PLANNING
- Flexible budgets by category and period, with optional rollover.
- Recurring items that post automatically or wait for your confirmation.
- A day-by-day cash flow projection that shows when a balance would go negative.

ASSETS
- Track what you own beyond your accounts, with dated values and expected income or expenses.
- Compare expected and actual cash flow, and see a portfolio total.

ON-CHAIN BALANCES (OPTIONAL)
- Watch token balances for public addresses, read-only, and compare them with your ledger.
- Off by default. When you turn it on, balances are read only when you press Refresh, from endpoints you can change.
- MoneyForge refuses to store anything that looks like a private key or seed phrase.

YOUR DATA
- CSV import with a preview before anything is written, and undo for an import.
- CSV export through the Android share sheet.
- Encrypted backups (AES-GCM with a key derived from your passphrase) that you can restore on another device.
- Android cloud backup is turned off for the app's data.

OPEN SOURCE
MoneyForge is free software under the GPL-3.0-or-later license. The source code is public, and contributions are welcome.
```

## Feature bullets

For promotional text, screenshot captions, or a website.

- Multiple fiat currencies and stablecoins, with exact amounts.
- Income split by percentage into a list of moves to make.
- Bank messages turned into transactions by your own rules, through paste or share.
- Budgets, recurring items, and a cash flow projection.
- Assets with expected and actual cash flow.
- Optional read-only on-chain balances for public addresses.
- CSV import and export, shareable rule packs, and encrypted backups.
- No account, no server, no analytics, no ads. Open source under GPL-3.0-or-later.

## Data safety form

Derived from the [privacy policy](privacy-policy.md). Confirm against Google's current Data safety guidance before submitting.

| Question | Answer |
|----------|--------|
| Does your app collect or share any of the required user data types? | No. See the note on on-chain reads below. |
| Is all user data encrypted in transit? | On-chain reads use the endpoint URL the user sets. The suggested endpoints use HTTPS. A user can enter any URL, so this depends on the user's choice. |
| Do you provide a way for users to request that their data be deleted? | Not applicable: no data reaches the developer. Uninstalling the app, or clearing its storage, deletes all data. |
| Committed to the Play Families Policy? | No. The app is not directed at children. |
| Independent security review? | No. |

What leaves the device, and when:

- **On-chain balance reads.** Off by default. Once the user turns them on, a read happens only when the user presses Refresh, with no background polling. Each request goes to the endpoint the user set for that chain (suggested defaults: TronGrid for Tron, PublicNode for Ethereum). It sends the public address and the token contract being read, and the endpoint sees the device's IP address. The developer receives none of it.
- **Exports and backups.** Sent only through the Android share sheet, to a destination the user picks. CSV exports and rule packs are plain text. Backups are encrypted with the user's passphrase.
- Nothing else. There are no accounts, analytics, advertising, or crash reporting libraries.

On-chain reads go to a third-party endpoint the user configures, at the user's explicit request. Under Google's definitions this may still count as collection or sharing of "Financial info" or "Device or other IDs" (IP address). See the open questions.

## Permissions rationale

| Permission | Variant | Rationale |
|------------|---------|-----------|
| Internet | Both | Reads token balances for public addresses the user watches. Off until the user turns on network reads, then only when the user presses Refresh. |
| Receive SMS | Full only | Automatic capture of bank messages from senders the user trusts. Off until the user turns it on. Messages from other senders are discarded without being written or logged. Never reads the existing SMS inbox. Not declared in the Play variant. |

## Category and rating

- Category: Finance.
- Tags: budget, personal finance, multi-currency, expense tracker.
- Content rating (IARC questionnaire): no violence, sexual content, profanity, controlled substances, gambling, or user-to-user communication. No user-generated content is shared with other users. No location sharing. No purchases. Expected result: Everyone, or the lowest rating in each region.
- Contains ads: No. In-app purchases: No. Price: Free.
- Financial features declaration: the app is a personal budgeting and tracking tool. It provides no banking, lending, payments, crypto exchange, or wallet services, and never holds funds or keys.

## Contact and links

- Contact: <https://github.com/JohnyYen/moneyforge/issues> (Google Play also requires a contact email address; still to be decided)
- Privacy policy URL: <https://github.com/JohnyYen/moneyforge/blob/main/docs/privacy-policy.md>
- Website or source repository: <https://github.com/JohnyYen/moneyforge>

## Required assets

- [ ] TODO App icon, 512 x 512 PNG, 32-bit, up to 1 MB.
- [ ] TODO Feature graphic, 1024 x 500 PNG or JPEG, no transparency.
- [ ] TODO Phone screenshots, 2 to 8, PNG or JPEG, from a device build of the Play variant: ledger, income split, message inbox, planning, assets, and Data.
- [ ] TODO Optional: 7-inch and 10-inch tablet screenshots.

## Open questions

- Data safety: whether user-directed on-chain reads to an endpoint the user chose count as collection or sharing under Google's current definitions. This was not checked against current Play documentation.
- The privacy policy says building a rule from a message copies it into the rule's samples. The code does not: `src/features/rules/ui/rules-model.ts` keeps samples to what the user types, and the README agrees. The policy line needs correcting before publication.
- The merged release manifest is not verified. The Expo template prebuild also declares `SYSTEM_ALERT_WINDOW`, `VIBRATE`, and legacy storage permissions. Confirm the final set before filling the permissions declaration.
- Google Play registration from Cuba is unresolved.
- The package id `app.moneyforge` needs confirming before the first upload.
- Fill the contact email, privacy policy URL, and repository URL.
