import { countResults, MAX_BODY_BYTES, parseBatch, type BatchItem } from "../lib/machine/intake";
import { createDevice, type Device, type LogEntry, type Transport, type TransportRequest } from "../lib/machine/simulator/device";
import { SOURCE_CALL_LIMIT, SOURCE_KEY_FORM } from "../lib/machine/simulator/limits";
import { seededRandom } from "../lib/machine/simulator/random";

// PLC-simulatorn: a stand-in for the events route with the real parsing behind it (parseBatch), the same order of checks and the same
// answers. tests/plc-simulator-connection.integration.ts proves the real handlers.

export const FIRST_KEY = `hwf_mch_${"a".repeat(25)}_${"S".repeat(43)}`;
export const NOW = Date.parse("2026-11-02T08:00:00.000Z");

export type Call = TransportRequest & { atMs: number };

type ForcedAnswer = { status: number; retryAfter?: string | null; date?: string | null; text: string };
export type FakeIntake = {
  calls: Call[];
  /** Items that were saved, in order, with the time of the call: what the server's later steps would see. */
  stored: { items: Extract<BatchItem, { kind: "valid" }>["event"][]; atMs: number }[];
  revoked: boolean; moduleOff: boolean;
  /** When set, answers instead of the logic below: for the device's own answer table. */
  answer: ((request: TransportRequest) => ForcedAnswer | Error) | null;
  transport: Transport;
};

export function fakeIntake(clock: () => number): FakeIntake {
  const seen = new Set<string>();
  const windowStart = { at: 0, calls: 0 };
  const intake: FakeIntake = {
    calls: [], stored: [],
    revoked: false, moduleOff: false,
    answer: null,
    transport: async (request) => {
      const atMs = clock();
      intake.calls.push({ ...request, atMs });
      if (intake.answer) {
        const forced = intake.answer(request);
        if (forced instanceof Error) throw forced;
        return { status: forced.status, retryAfter: forced.retryAfter ?? null, date: forced.date ?? null, text: forced.text };
      }
      const json = (status: number, body: unknown, retryAfter: string | null = null) => ({ status, retryAfter, date: null, text: JSON.stringify(body) });
      const key = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? "")?.[1] ?? "";
      if (!key) return json(401, { error: "Nyckel saknas.", code: "invalid_key" });
      if (!SOURCE_KEY_FORM.test(key) || key !== FIRST_KEY) return json(401, { error: "Nyckeln är ogiltig.", code: "invalid_key" });
      if (intake.revoked) return json(401, { error: "Nyckeln är återkallad. Skapa en ny för källan.", code: "invalid_key" });
      if (atMs - windowStart.at >= 60_000) { windowStart.at = atMs; windowStart.calls = 0; }
      windowStart.calls += 1;
      if (windowStart.calls > SOURCE_CALL_LIMIT) return json(429, { error: "För många anrop från den här källan. Vänta och skicka igen.", code: "rate_limited" }, String(Math.ceil((windowStart.at + 60_000 - atMs) / 1000)));
      if (intake.moduleOff) return json(409, { error: "Underhåll är avstängt.", code: "module_off" });
      if (new TextEncoder().encode(request.body).length > MAX_BODY_BYTES) return json(413, { error: "Kroppen är för stor (högst 64 kB).", code: "too_large" });
      const now = new Date(atMs);
      let parsed: unknown;
      try { parsed = JSON.parse(request.body); } catch { return json(400, { error: "Kroppen är inte giltig JSON.", code: "invalid_json" }); }
      const batch = parseBatch(parsed, now);
      if (!batch.ok) return json(400, { error: batch.error, code: batch.error });
      const results = batch.items.map((item) => {
        if (item.kind === "rejected") return { index: item.index, eventId: item.eventId, status: "rejected" as const, reason: item.reason };
        const id = item.kind === "duplicate" ? item.eventId : item.event.eventId;
        const isNew = item.kind === "valid" && !seen.has(id);
        seen.add(id);
        return { index: item.index, eventId: id, status: isNew ? "accepted" as const : "duplicate" as const };
      });
      const fresh = batch.items.filter((item, index): item is Extract<BatchItem, { kind: "valid" }> => item.kind === "valid" && results[index].status === "accepted");
      if (fresh.length) intake.stored.push({ items: fresh.map((item) => item.event), atMs });
      return json(202, { schemaVersion: 1, results, counts: countResults(results) });
    },
  };
  return intake;
}

export type Harness = {
  clock: { now: number };
  intake: FakeIntake;
  device: Device;
  key: { value: string | null };
  /** Moves the clock and does what the page's tick does. */
  advance(ms: number): Promise<void>;
  log(): LogEntry[];
};

export function makeHarness(options: { nowMs?: number; seed?: number; key?: string | null } = {}): Harness {
  const clock = { now: options.nowMs ?? NOW };
  const key = { value: options.key === undefined ? FIRST_KEY : options.key };
  const now = () => clock.now;
  const random = seededRandom(options.seed ?? 7);
  const intake = fakeIntake(now);
  const device = createDevice({ transport: intake.transport, getKey: () => key.value, clock: now, random });
  return {
    clock, intake, device, key,
    async advance(ms) { clock.now += ms; await device.pump(); },
    log: () => device.getState().log,
  };
}
