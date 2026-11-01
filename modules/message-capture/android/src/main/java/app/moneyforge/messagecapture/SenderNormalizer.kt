package app.moneyforge.messagecapture

// The pattern spells out what `\s` and `trim` cover in JavaScript, because `\s` means less here.
// modules/message-capture/fixtures/sender-vectors.json runs this exact line through Jest.
private val IGNORED_CHARACTERS = Regex("""[\t\n\x0B\f\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\-().]""")

/** Must read a sender exactly like `normalizeSender` in `src/features/rules/domain/message.ts`. */
internal fun normalizeSender(sender: String): String =
  IGNORED_CHARACTERS.replace(sender.lowercase(), "")
