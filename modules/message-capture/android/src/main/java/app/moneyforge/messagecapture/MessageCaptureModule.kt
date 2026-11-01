package app.moneyforge.messagecapture

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
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
        ?: appContext.currentActivity?.intent?.let { extractSharedText(it) }
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

  /** Removes the text from the intent, so reading it twice cannot open the paste screen twice. */
  private fun extractSharedText(intent: Intent): String? {
    if (intent.action != Intent.ACTION_SEND) return null
    val text = runCatching { intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString() }.getOrNull()
    intent.removeExtra(Intent.EXTRA_TEXT)
    return text
  }
}
