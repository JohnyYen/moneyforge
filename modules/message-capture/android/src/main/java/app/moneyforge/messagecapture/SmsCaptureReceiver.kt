package app.moneyforge.messagecapture

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/**
 * Declared by the config plugin in the full variant only. It runs with the app closed, so it may
 * only touch app-private files. Nothing here logs: a log line could carry a sender or a body.
 */
class SmsCaptureReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    // A failure leaves the SMS in the default SMS app, where the user can still share it.
    runCatching { capture(context, intent) }
  }

  private fun capture(context: Context, intent: Intent) {
    val preferences = CapturePreferences(context)
    if (!preferences.enabled) return

    // The system hands over one logical message, split into parts from the same sender.
    val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent).filterNotNull()
    val sender = normalizeSender(parts.firstOrNull()?.originatingAddress ?: return)
    if (!preferences.allows(sender)) return

    val body = parts.joinToString("") { it.messageBody.orEmpty() }
    if (body.isEmpty()) return
    MessageQueue.append(context, sender, body, System.currentTimeMillis())
  }
}
