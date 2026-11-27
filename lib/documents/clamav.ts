import { connect, type Socket } from "node:net";

/**
 * A small client for clamd (ClamAV's daemon) over TCP (Dokument, 0.87.0). The file is sent with INSTREAM – never written where
 * the scanner reads – in chunks of a four-byte big-endian length followed by the bytes, ended by a zero length; clamd answers
 * one line ("stream: OK", "stream: <signature> FOUND" or "... ERROR"). The z-prefixed commands end with a NUL byte, and so do
 * the answers. No dependency: node:net only. The orchestration (statuses, retries) is lib/documents/scan.ts.
 */
export type ClamConfig = { host: string; port: number; timeoutMs: number };
export type ScanVerdict =
  | { result: "clean" }
  | { result: "infected"; signature: string }
  /** The scanner could not give an answer: the file stays waiting, and is scanned again later. */
  | { result: "error"; reason: ScanErrorReason };
export type ScanErrorReason = "unreachable" | "timeout" | "too-large" | "scanner-error" | "unreadable-answer";

/** clamd's default StreamMaxLength is 25 MB; our documents are at most 10 MB, so one chunk size well below it. */
const CHUNK = 64 * 1024;

/** clamd's answer as a verdict. Exported for the tests. */
export function parseClamReply(raw: string): ScanVerdict {
  const text = raw.replace(/\0/g, "").trim();
  // An INSTREAM answer is "stream: …"; some versions put "1: " in front when the session is numbered.
  const body = text.replace(/^\d+:\s*/, "").replace(/^stream:\s*/, "");
  if (body === "OK") return { result: "clean" };
  const found = /^(.+?)\s+FOUND$/.exec(body);
  if (found) return { result: "infected", signature: found[1]!.slice(0, 200) };
  if (/size limit exceeded/i.test(body)) return { result: "error", reason: "too-large" };
  if (/ERROR$/.test(body)) return { result: "error", reason: "scanner-error" };
  return { result: "error", reason: "unreadable-answer" };
}

/** Sends one command and reads the answer to its end (the NUL byte or the scanner closing the connection). */
function exchange(config: ClamConfig, write: (socket: Socket) => void): Promise<{ ok: true; text: string } | { ok: false; reason: ScanErrorReason }> {
  return new Promise((resolve) => {
    let done = false;
    const chunks: Buffer[] = [];
    const socket = connect({ host: config.host, port: config.port });
    const finish = (value: { ok: true; text: string } | { ok: false; reason: ScanErrorReason }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), config.timeoutMs);
    socket.once("connect", () => { try { write(socket); } catch { finish({ ok: false, reason: "unreachable" }); } });
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (chunk.includes(0)) finish({ ok: true, text: Buffer.concat(chunks).toString("utf8") });
    });
    socket.once("end", () => finish(chunks.length ? { ok: true, text: Buffer.concat(chunks).toString("utf8") } : { ok: false, reason: "unreachable" }));
    socket.once("error", () => finish({ ok: false, reason: chunks.length ? "unreadable-answer" : "unreachable" }));
  });
}

/** Scans the bytes. Never throws: an answer that cannot be had is a verdict of its own ("error"). */
export async function clamScan(config: ClamConfig, bytes: Uint8Array): Promise<ScanVerdict> {
  const answer = await exchange(config, (socket) => {
    socket.write("zINSTREAM\0");
    for (let offset = 0; offset < bytes.byteLength; offset += CHUNK) {
      const part = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.byteLength));
      const length = Buffer.alloc(4);
      length.writeUInt32BE(part.byteLength, 0);
      socket.write(length);
      socket.write(part);
    }
    socket.write(Buffer.alloc(4));
  });
  if (!answer.ok) return { result: "error", reason: answer.reason };
  return parseClamReply(answer.text);
}

/** Whether clamd answers PING with PONG (the runbook's and the health check's question). */
export async function clamPing(config: ClamConfig): Promise<boolean> {
  const answer = await exchange(config, (socket) => socket.write("zPING\0"));
  return answer.ok && answer.text.replace(/\0/g, "").trim() === "PONG";
}
