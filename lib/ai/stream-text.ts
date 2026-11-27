// Strömning av svaret (2026-10-24, svar 6). Pure helpers, no provider: the provider sends the structured answer
// ({"answer": "...", "citations": [...]}) as JSON text in pieces; these turn those pieces into the answer's own text, piece by piece,
// with the placeholders turned back into the real names – what the chat shows while the answer is written. The final answer is
// still the whole, schema-checked one; the pieces are only a preview of it.

const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
const ANSWER_KEY = /"answer"\s*:\s*"/;

/** Reads the "answer" string out of JSON that arrives in pieces, and hands on its decoded text as it comes. */
export function answerFieldStreamer(onText: (text: string) => void) {
  let buffer = "";
  let start = -1;   // where the answer's characters begin in the buffer
  let read = 0;     // how far into the buffer has been decoded
  let done = false;
  return {
    push(chunk: string) {
      if (done || !chunk) return;
      buffer += chunk;
      if (start < 0) {
        const match = ANSWER_KEY.exec(buffer);
        if (!match) return;
        start = match.index + match[0].length;
        read = start;
      }
      let out = "";
      while (read < buffer.length) {
        const char = buffer[read];
        if (char === '"') { done = true; break; }
        if (char !== "\\") { out += char; read += 1; continue; }
        const next = buffer[read + 1];
        if (next === undefined) break; // the escape's second half is in the next piece
        if (next === "u") {
          const hex = buffer.slice(read + 2, read + 6);
          if (hex.length < 4) break;
          out += /^[0-9a-fA-F]{4}$/.test(hex) ? String.fromCharCode(parseInt(hex, 16)) : "";
          read += 6;
          continue;
        }
        out += ESCAPES[next] ?? next;
        read += 2;
      }
      if (out) onText(out);
    },
    /** A turn ended with tool calls instead of an answer: start over with the next turn's text. */
    reset() { buffer = ""; start = -1; read = 0; done = false; },
  };
}

const PLACEHOLDER_START = /\[[^\]]{0,40}$/;

/**
 * Turns placeholders back into the real names while text streams: a "[" that may be the start of "[Kund 1]" is held back until its
 * "]" has arrived (or it clearly is not one), so the person never sees a placeholder, and never half of one.
 */
export function aliasStreamRestorer(restore: (text: string) => string, emit: (text: string) => void) {
  let pending = "";
  const send = (text: string) => { if (text) emit(restore(text)); };
  return {
    push(text: string) {
      pending += text;
      const open = PLACEHOLDER_START.exec(pending);
      if (open) { send(pending.slice(0, open.index)); pending = pending.slice(open.index); }
      else { send(pending); pending = ""; }
    },
    flush() { send(pending); pending = ""; },
    reset() { pending = ""; },
  };
}
