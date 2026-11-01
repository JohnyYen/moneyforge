package app.moneyforge.messagecapture

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicReference

class MessageCaptureModule : Module() {
  private val pendingSharedText = AtomicReference<String?>(null)

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("MessageCapture")

    Constant("smsCaptureAvailable") { declaresReceiveSms() }

    Events("onSharedText")

    AsyncFunction("isEnabled") { CapturePreferences(context).enabled }

    AsyncFunction("setEnabled") { enabled: Boolean ->
      CapturePreferences(context).setEnabled(enabled)
    }

    AsyncFunction("setSenders") { senders: List<String> ->
      CapturePreferences(context).setSenders(senders)
    }

    AsyncFunction("readQueue") { MessageQueue.read(context) }

    AsyncFunction("removeQueued") { id: String ->
      MessageQueue.remove(context, id)
    }

    AsyncFunction("takeSharedText") {
      pendingSharedText.getAndSet(null)
        ?: appContext.currentActivity?.intent?.let { takeLaunchShare(it) }
    }

    // The activity is `singleTask`, so a share into a running app arrives here, not in `intent`.
    OnNewIntent { intent ->
      extractSharedText(intent)?.let {
        pendingSharedText.set(it)
        sendEvent("onSharedText")
      }
    }
  }

  /** The manifest decides, so this cannot disagree with what the variant really declares. */
  private fun declaresReceiveSms(): Boolean {
    val context = appContext.reactContext ?: return false
    val info = context.packageManager.getPackageInfo(
      context.packageName,
      PackageManager.GET_PERMISSIONS
    )
    return info.requestedPermissions?.contains(Manifest.permission.RECEIVE_SMS) == true
  }

  /**
   * After process death Android recreates the activity from the launch intent it saved, extra
   * included, so `removeExtra` alone would bring a consumed share back. The digest outlives the
   * process. Only a launch intent can replay, so `OnNewIntent` neither reads nor writes it. The
   * cost: launching the app by sharing the exact text of the last launch share opens nothing.
   */
  private fun takeLaunchShare(intent: Intent): String? {
    val text = extractSharedText(intent) ?: return null
    val preferences = CapturePreferences(context)
    val digest = digestOf(text)
    if (preferences.consumedLaunchShare == digest) return null
    preferences.consumedLaunchShare = digest
    return text
  }

  /** Removes the text from the intent, so reading it twice cannot open the paste screen twice. */
  private fun extractSharedText(intent: Intent): String? {
    if (intent.action != Intent.ACTION_SEND) return null
    // Reading or removing an extra can throw on a malformed parcel from another app.
    return runCatching {
      val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
      intent.removeExtra(Intent.EXTRA_TEXT)
      text
    }.getOrNull()
  }

  private fun digestOf(text: String): String =
    MessageDigest.getInstance("SHA-256")
      .digest(text.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it) }
}
