# MoneyForge privacy policy

Effective date: 2026-11-05

MoneyForge keeps your financial data on your device. It has no accounts, no server, no analytics, and no ads. Data leaves your device only when you turn on on-chain balance reads, or when you share an export yourself.

## Summary

| Question | Answer |
|----------|--------|
| Where is my data stored? | In a database on your device, private to the app. |
| Does MoneyForge send my data anywhere? | No. The only network requests are on-chain balance reads, which are off until you turn them on. |
| Do I need an account? | No. |
| Are there analytics, ads, or crash reporting? | No. The app includes no analytics, advertising, or crash reporting software. |
| Can MoneyForge move money? | No. It never holds keys, signs, or sends transactions. |
| Who can see my data? | Only you, and whoever you send an export to. |

## Data stored on your device

MoneyForge stores what you enter or import: accounts, currencies, exchange rates, transactions, categories, income split structures, budgets, recurring items, assets, message sources and rules, watched public addresses, and settings.

The app turns off Android cloud backup for its data. On Android 12 and later, a device-to-device transfer that you start when setting up a new phone may still copy app data.

## Bank messages

Message capture turns bank messages into transactions through rules you write.

- **Paste and share.** You can paste a message, or share text from another app to MoneyForge. Nothing is read unless you do this.
- **Automatic SMS capture.** Only the full variant, distributed outside Google Play, can read incoming SMS. It asks for the `RECEIVE_SMS` permission and is off until you turn it on. The Google Play variant declares no SMS permission. Capture never reads your existing SMS inbox.
- **Only senders you trust.** A message is kept only when its sender matches a source you created. Messages from any other sender are discarded without being written or logged.
- **One-time codes are discarded.** A message that looks like a one-time or verification code, with no money amount, is dropped.
- **Message text is short-lived.** When a message becomes a transaction, or you reject it, its text is erased. Messages no rule could read, and the text of messages still waiting for you, are removed after a retention period. It is 30 days by default, and you can change it in the message settings.
- **Rules keep only what you save.** If you build a rule from a message, its template is prefilled from that message, and the app warns you when the template would keep digits or long text from it. A rule's test samples are only what you type yourself. Whatever you save in a rule stays until you edit or delete it.

## Network requests

MoneyForge contacts the internet only to read token balances for public addresses you choose to watch.

- Network reads are off by default. When you turn them on, a read happens only when you press Refresh. There is no background polling.
- Each request goes to the endpoint set for that chain. The app suggests public endpoints (TronGrid for Tron, PublicNode for Ethereum), and you can replace each with your own.
- The endpoint receives the public address and token contract being read, and sees your IP address. It can link the two. Its own privacy policy applies to what it does with them.
- MoneyForge refuses to store anything that looks like a private key or seed phrase.

## Exports and backups

You decide what leaves your device. Exports are handed to the Android share sheet, and you pick where they go.

| Export | What it contains | Protection |
|--------|------------------|------------|
| CSV export | Transactions of one account or of all accounts: date, kind, description, category, account, currency, and amount. | None. It is plain text. |
| Rule pack | Message sources and rules. No samples, inbox messages, accounts, or categories. | None. It is plain text. |
| Encrypted backup | All app data, including the chain endpoints you set. Messages still awaiting a decision are included without their text. | Encrypted with AES-GCM using a key derived from your passphrase with scrypt. Without the passphrase it cannot be opened. |

Restoring a backup replaces all data in the app.

## Permissions

| Permission | Variant | Why |
|------------|---------|-----|
| Internet | Both | On-chain balance reads, only when you turn them on. |
| Receive SMS | Full only | Automatic capture of bank messages, only when you turn it on. |

## Deleting your data

All data lives on your device. Uninstalling MoneyForge, or clearing its storage in Android settings, deletes it. Backups and exports you shared are outside the app, and you delete them where you saved them.

## Children

MoneyForge is not directed at children and collects no data from anyone.

## Changes to this policy

Changes are published in this file, in the MoneyForge source repository, with a new effective date.

## Contact

Questions about this policy: `<contact email>`
