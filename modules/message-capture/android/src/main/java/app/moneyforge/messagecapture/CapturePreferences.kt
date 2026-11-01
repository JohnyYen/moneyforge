package app.moneyforge.messagecapture

import android.content.Context

private const val FILE_NAME = "message-capture"
private const val KEY_ENABLED = "enabled"
private const val KEY_SENDERS = "senders"
private const val KEY_CONSUMED_LAUNCH_SHARE = "consumed_launch_share"

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

  /** A digest only: the shared text itself is never stored until the user submits it. */
  var consumedLaunchShare: String?
    get() = preferences.getString(KEY_CONSUMED_LAUNCH_SHARE, null)
    set(digest) {
      preferences.edit().putString(KEY_CONSUMED_LAUNCH_SHARE, digest).commit()
    }

  fun allows(normalizedSender: String): Boolean =
    preferences.getStringSet(KEY_SENDERS, null)?.contains(normalizedSender) == true
}
