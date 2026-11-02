# Rule packs

A rule pack shares the message sources and rules for a bank, so nobody has to write them twice. Import one under More, Data, Import a rule pack.

## What a pack holds

A pack is one JSON file with sources and their rules. [`example-bank.json`](example-bank.json) shows the format, using an invented bank.

A pack never holds samples, inbox items, accounts, or categories. Rules name slots instead, such as `Everyday account`, and the person importing maps each slot to their own account or category.

A pack also has no way to say that a rule posts by itself or which split to apply. Importing always turns auto-post off and sets income rules to ask about a split, because a pack is untrusted. Anyone who wants more can change the rule afterwards.

## Fields

| Field | Meaning |
| --- | --- |
| `format` | Always `moneyforge-rule-pack`. |
| `version` | Always `1`. |
| `name`, `description` | Shown in the preview. `description` is optional. |
| `sources[].name`, `channel`, `sender` | `channel` is `sms` or `paste`. One source per sender. |
| `rules[].name`, `priority` | Higher priority is tried first, within 1,000,000 either way. |
| `rules[].template` | The message, with `{amount}` once and `{currency}`, `{reference}`, `{counterparty}`, `{balance}`, or `{*}` where needed. |
| `rules[].format` | `decimal` and `thousands` separators. |
| `rules[].kind` | `income`, `expense`, `transfer_out`, or `transfer_in`. |
| `rules[].account` | An account slot. |
| `rules[].category` | A category slot, optional. Transfers have none, and one slot serves one kind. |
| `rules[].counterpart` | The other account slot, on transfers only. |

Import refuses any other field, more than 50 sources or 500 rules, more than 50 slots, text over 200,000 characters, and any template that reads like a one-time code.

## Contributing a pack

1. Build and test the rules in the app, then use More, Data, Export a rule pack.
2. Read every template. Replace names, card digits, balances, and references with placeholders.
3. Check that the file holds nothing from a real message that identifies a person.
4. Name the file after the bank and country, in lowercase with hyphens, and open a pull request here.

Importing the same pack twice adds nothing: a rule counts as known when its source already has one with the same template, kind, and number format.
