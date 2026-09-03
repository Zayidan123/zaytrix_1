/**
 * aiStream — QA8-C shared frontend SSE consumer
 * ---------------------------------------------
 * Generic reader for the ZAYTRIX SSE streaming contract (QA7-F1 / QA8-C):
 *
 *   Content-Type: text/event-stream
 *   Frame:        data: {"type":"token","text":"<chunk>"}\n\n
 *                 data: {"type":"done", ...payload-final}\n\n
 *                 data: {"type":"error","error":"<pesan>"}\n\n
 *   Keep-alive:   ": keep-alive\n\n" (comment frames — ignored)
 *
 * The parser is tolerant of:
 *   - keep-alive comment frames (": ...")
 *   - frames split across multiple network chunks (partial buffering)
 *   - blank lines / CRLF line endings / trailing frames without a final "\n\n"
 *   - malformed JSON lines (skipped, stream continues)
 *   - unknown event types (e.g. "start" — ignored, only the contract
 *     token/done/error events are dispatched)
 *
 * The promise resolves after a terminal event ("done" / "error") or after the
 * stream body ends. Handlers may throw — the exception propagates out of
 * consumeAIStream so callers can apply their own error/fallback policy.
 */

export interface AIStreamHandlers {
  /** Progressive content chunk (may be called many times). */
  onToken(text: string): void;
  /** Terminal success — payload is the endpoint's final, authoritative JSON
   *  (same fields as its non-streaming response, plus `type: "done"`). */
  onDone(payload: any): void;
  /** Terminal failure — sanitized message from the server. */
  onError(msg: string): void;
}

export async function consumeAIStream(res: Response, handlers: AIStreamHandlers): Promise<void> {
  if (!res.body) {
    throw new Error("Body respons tidak dapat dibaca (streaming tidak didukung browser/proxy).");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal = false;

  const dispatchFrame = (frame: string): void => {
    for (const rawLine of frame.split("\n")) {
      const line = rawLine.replace(/\r$/, "").trim();
      // Blank lines and SSE comments (": keep-alive") are ignored.
      if (!line || line.startsWith(":")) continue;
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      // OpenAI-style terminal sentinel (defensive — our servers don't send it).
      if (!payload || payload === "[DONE]") continue;
      let ev: any;
      try {
        ev = JSON.parse(payload);
      } catch {
        continue; // tolerate malformed SSE line
      }
      if (!ev || typeof ev.type !== "string") continue;
      if (ev.type === "token") {
        if (typeof ev.text === "string" && ev.text) handlers.onToken(ev.text);
      } else if (ev.type === "done") {
        terminal = true;
        handlers.onDone(ev);
      } else if (ev.type === "error") {
        terminal = true;
        handlers.onError(typeof ev.error === "string" && ev.error ? ev.error : "Kesalahan stream tidak diketahui.");
      }
      // "start" and future event types are intentionally ignored here.
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line ("\n\n"). A frame may arrive
      // split across several chunks — keep the trailing partial in `buffer`.
      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        dispatchFrame(frame);
        if (terminal) {
          try {
            await reader.cancel();
          } catch {}
          return;
        }
        sep = buffer.indexOf("\n\n");
      }
    }

    // Flush the decoder and process a trailing frame that ended without a
    // final "\n\n" (e.g. a server that closed the socket right after done).
    buffer += decoder.decode();
    if (buffer.trim()) {
      dispatchFrame(buffer);
    }
  } finally {
    // Release the connection if the caller never saw a terminal event
    // (e.g. an exception escaped from a handler).
    if (!terminal) {
      try {
        reader.cancel().catch(() => {});
      } catch {}
    }
  }
}
