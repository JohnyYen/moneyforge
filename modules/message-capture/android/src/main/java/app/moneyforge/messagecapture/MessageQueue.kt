package app.moneyforge.messagecapture

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.io.IOException
import java.util.UUID
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

private const val FILE_NAME = "message-capture-queue.json"
private const val MAX_ENTRIES = 200
private const val MAX_BYTES = 256 * 1024

// One past MAX_MESSAGE_LENGTH in message.ts, so ingest can still tell the message was too long.
private const val MAX_BODY_CHARS = 2001

/**
 * Messages waiting for JavaScript to ingest them. The database is never opened here: a second
 * connection would escape the one write queue that deduplication relies on.
 *
 * The file sits in `noBackupFilesDir`, which backup and device transfer leave out. A one-time code
 * from an allowlisted sender stays in it until the next drain, where ingest discards it.
 *
 * The receiver and the module run on different threads of one process, so a lock is enough.
 */
internal object MessageQueue {
  /** Returns false when the queue is full. What it already holds is never pushed out. */
  @Synchronized
  fun append(context: Context, sender: String, body: String, receivedAt: Long): Boolean {
    val file = fileOf(context)
    val entries = load(file)
    if (entries.length() >= MAX_ENTRIES) return false
    entries.put(
      JSONObject()
        .put("id", UUID.randomUUID().toString())
        .put("sender", sender)
        .put("body", body.take(MAX_BODY_CHARS))
        .put("receivedAt", receivedAt)
    )
    val bytes = entries.toString().toByteArray(Charsets.UTF_8)
    if (bytes.size > MAX_BYTES) return false
    store(file, bytes)
    return true
  }

  @Synchronized
  fun read(context: Context): String = load(fileOf(context)).toString()

  /** Deletes the file along with its last entry, so an empty queue leaves nothing behind. */
  @Synchronized
  fun remove(context: Context, id: String) {
    val file = fileOf(context)
    val entries = load(file)
    val kept = JSONArray()
    for (index in 0 until entries.length()) {
      val entry = entries.optJSONObject(index) ?: continue
      if (entry.optString("id") != id) kept.put(entry)
    }
    if (kept.length() == 0) {
      file.delete()
    } else {
      store(file, kept.toString().toByteArray(Charsets.UTF_8))
    }
  }

  private fun fileOf(context: Context) = AtomicFile(File(context.noBackupFilesDir, FILE_NAME))

  private fun load(file: AtomicFile): JSONArray =
    try {
      JSONArray(String(file.readFully(), Charsets.UTF_8))
    } catch (error: IOException) {
      JSONArray()
    } catch (error: JSONException) {
      JSONArray()
    }

  private fun store(file: AtomicFile, bytes: ByteArray) {
    val stream = file.startWrite()
    try {
      stream.write(bytes)
      file.finishWrite(stream)
    } catch (error: IOException) {
      file.failWrite(stream)
      throw error
    }
  }
}
