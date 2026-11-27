// Dokument (0.87.0): the clamd client against a fake clamd on loopback – INSTREAM framing, the answers OK / FOUND / ERROR, a scanner
// that is not there, one that never answers – and the rules around it: which scan the settings give, and what a verdict changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { clamPing, clamScan, parseClamReply } from "../lib/documents/clamav";
import { scanSettingOf, scanUpdate } from "../lib/documents/scan-config";

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

type Fake = { server: Server; port: number; received: Buffer[]; commands: string[] };
/** A fake clamd: reads zINSTREAM\0 and the chunks, and answers like clamd (FOUND for the EICAR test string, or what `answer` says). */
async function fakeClamd(answer?: (content: Buffer) => string | null): Promise<Fake> {
  const received: Buffer[] = [];
  const commands: string[] = [];
  const server = createServer((socket: Socket) => {
    let buffer = Buffer.alloc(0);
    let command: string | null = null;
    const chunks: Buffer[] = [];
    socket.on("data", (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      if (command === null) {
        const end = buffer.indexOf(0);
        if (end < 0) return;
        command = buffer.subarray(0, end).toString();
        commands.push(command);
        buffer = buffer.subarray(end + 1);
        if (command === "zPING") { socket.end("PONG\0"); return; }
      }
      // Chunks: a four-byte big-endian length and the bytes; a zero length ends the stream.
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (length === 0) {
          const content = Buffer.concat(chunks);
          received.push(content);
          const reply = answer ? answer(content) : content.includes(Buffer.from(EICAR)) ? "stream: Eicar-Test-Signature FOUND" : "stream: OK";
          if (reply !== null) socket.end(`${reply}\0`);
          buffer = buffer.subarray(4);
          return;
        }
        if (buffer.length < 4 + length) return;
        chunks.push(buffer.subarray(4, 4 + length));
        buffer = buffer.subarray(4 + length);
      }
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as AddressInfo).port, received, commands };
}
const close = (fake: Fake) => new Promise<void>((resolve) => fake.server.close(() => resolve()));
const config = (port: number, timeoutMs = 2000) => ({ host: "127.0.0.1", port, timeoutMs });

test("a clean file: the bytes arrive whole over INSTREAM, in chunks, and the verdict is clean", async () => {
  const fake = await fakeClamd();
  try {
    // Bigger than one chunk (64 kB), so the framing is tested over several.
    const bytes = new Uint8Array(200_000).map((_, index) => index % 251);
    assert.deepEqual(await clamScan(config(fake.port), bytes), { result: "clean" });
    assert.deepEqual(fake.commands, ["zINSTREAM"]);
    assert.equal(fake.received.length, 1);
    assert.ok(Buffer.from(bytes).equals(fake.received[0]!), "the scanner saw exactly the file");
  } finally { await close(fake); }
});

test("an infected file gives the scanner's signature", async () => {
  const fake = await fakeClamd();
  try {
    assert.deepEqual(await clamScan(config(fake.port), Buffer.from(`prefix ${EICAR} suffix`)), { result: "infected", signature: "Eicar-Test-Signature" });
  } finally { await close(fake); }
});

test("the scanner's errors, a scanner that is not there and one that never answers are errors – never clean", async () => {
  const tooLarge = await fakeClamd(() => "INSTREAM size limit exceeded. ERROR");
  try { assert.deepEqual(await clamScan(config(tooLarge.port), Buffer.from("x")), { result: "error", reason: "too-large" }); } finally { await close(tooLarge); }
  const failing = await fakeClamd(() => "stream: Can't allocate memory ERROR");
  try { assert.deepEqual(await clamScan(config(failing.port), Buffer.from("x")), { result: "error", reason: "scanner-error" }); } finally { await close(failing); }
  const silent = await fakeClamd(() => null);
  try { assert.deepEqual(await clamScan(config(silent.port, 300), Buffer.from("x")), { result: "error", reason: "timeout" }); } finally { await close(silent); }
  // A port nobody listens on: take one, then free it.
  const gone = await fakeClamd();
  const port = gone.port;
  await close(gone);
  assert.deepEqual(await clamScan(config(port), Buffer.from("x")), { result: "error", reason: "unreachable" });
});

test("PING answers PONG", async () => {
  const fake = await fakeClamd();
  try { assert.equal(await clamPing(config(fake.port)), true); } finally { await close(fake); }
});

test("clamd's answer is read with and without the session number and the NUL", () => {
  assert.deepEqual(parseClamReply("stream: OK\0"), { result: "clean" });
  assert.deepEqual(parseClamReply("1: stream: Win.Test.EICAR_HDB-1 FOUND\0"), { result: "infected", signature: "Win.Test.EICAR_HDB-1" });
  assert.deepEqual(parseClamReply("something else"), { result: "error", reason: "unreadable-answer" });
});

test("the settings: auto scans only with a host, off never, clamav with the host and port given", () => {
  const base = { CLAMAV_PORT: 3310, CLAMAV_TIMEOUT_MS: 30_000 };
  assert.deepEqual(scanSettingOf({ ...base, DOCUMENT_SCAN: "auto" }), { mode: "off" });
  assert.deepEqual(scanSettingOf({ ...base, DOCUMENT_SCAN: "auto", CLAMAV_HOST: " clamav " }), { mode: "clamav", clam: { host: "clamav", port: 3310, timeoutMs: 30_000 } });
  assert.deepEqual(scanSettingOf({ ...base, DOCUMENT_SCAN: "off", CLAMAV_HOST: "clamav" }), { mode: "off" });
  assert.deepEqual(scanSettingOf({ DOCUMENT_SCAN: "clamav", CLAMAV_HOST: "10.0.0.5", CLAMAV_PORT: 3311, CLAMAV_TIMEOUT_MS: 5000 }), { mode: "clamav", clam: { host: "10.0.0.5", port: 3311, timeoutMs: 5000 } });
});

test("a verdict's change: clean is served, infected loses its bytes, an error leaves the file as it was", () => {
  const now = new Date("2026-11-26T10:00:00Z");
  assert.deepEqual(scanUpdate({ result: "clean" }, "pending", now), { removeFile: false, data: { scanStatus: "clean", scanSignature: null, scanError: null, scannedAt: now } });
  const infected = scanUpdate({ result: "infected", signature: "Eicar" }, "pending", now);
  assert.equal(infected.removeFile, true);
  assert.equal(infected.data.scanStatus, "infected");
  assert.equal((infected.data as { storagePath?: null }).storagePath, null, "the row keeps no file");
  const waiting = scanUpdate({ result: "error", reason: "unreachable" }, "pending", now);
  assert.equal(waiting.removeFile, false);
  assert.equal(waiting.data.scanStatus, "pending", "still waiting, never clean");
  assert.equal(scanUpdate({ result: "error", reason: "timeout" }, "unscanned", now).data.scanStatus, "unscanned");
});
