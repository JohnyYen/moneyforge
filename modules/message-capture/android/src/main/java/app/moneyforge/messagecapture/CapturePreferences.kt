package app.moneyforge.messagecapture

import android.content.Context

private const val FILE_NAME = "message-capture"
private const val KEY_ENABLED = "enabled"
private const val KEY_SENDERS = "senders"

/** What JavaScript last told the receiver. Absent values mean capture is off. */
internal class CapturePreferences(context: Context) {
  private val preferences = context.getSharedPreferences(FILE_NAME, Context.MODE_PRIVATE)

  val enabled: Boolean
    get() = preferences.getBoolean(KEY_ENABLED, false)

  fun setEnabled(enabled: Boolean) {
    preferences.edit().putBoolean(KEY_ENABLED, enabled).commit()
  }

  fun setSenders(senders: List<String>) {
    preferences.edit().putStringSet(KEY_SENDERS, senders.toSet()).commit()
  }

  fun allows(normalizedSender: String): Boolean =
    preferences.getStringSet(KEY_SENDERS, null)?.contains(normalizedSender) == true
}
