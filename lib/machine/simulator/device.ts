import type { EnvelopeError, RejectReason } from "@/lib/machine/intake";
import { clampSeverity, eventsBody, type SendPolicy, type WireEvent } from "@/lib/machine/simulator/events";
import {
  CALL_TIMEOUT_MS, DEFAULT_RETRY_AFTER_S, MAX_BACKOFF_MS, MAX_BODY_BYTES, MAX_EVENTS_PER_CALL, MAX_LOG_ENTRIES, MAX_LOG_TEXT, MAX_QUEUE, MAX_REJECTED_SHOWN,
  MAX_RETRY_AFTER_S, MIN_CALL_GAP_MS, MODULE_OFF_RETRY_MS, SOURCE_KEY_FORM,
} from "@/lib/machine/simulator/limits";
import { holdsKeyForm, MASKED_VALUE, maskText } from "@/lib/machine/simulator/mask";
import {
  backoffText, BODY_HOLDS_KEY_TEXT, CLOCK_HINT, ENVELOPE_ERROR_TEXT, KEY_NO_RETRY_TEXT, keyRefusedText, MODULE_OFF_TEXT, NETWORK_TEXT, oddAnswerText,
  rateLimitedText, rateLimitWaitText, REJECT_REASON_TEXT, STOPPED_IN_CALL_TEXT, TOO_LARGE_TEXT,
} from "@/lib/machine/simulator/words";

// PLC-simulatorn: a well-behaved device, comparable with scripts/pi/hintek-edge.mjs, written for pacing and a page. Pure answers
// (applyAnswer) and one pump around an injected transport, so it runs against the real handlers in a test exactly as it does
// against fetch on the page. One difference on purpose: the edge template retries a refused key each minute; this stops at the
// first 401, because refused keys count against a limit shared with everyone on the address. The key is never in the state: it is
// asked for at the moment of a call and goes straight into the header.

export const EVENTS_PATH = "/api/ingest/v1/events";
export type CallPath = typeof EVENTS_PATH;
export type TransportRequest = { path: CallPath; headers: Record<string, string>; body: string; signal?: AbortSignal };
export type TransportAnswer = { status: number; retryAfter: string | null; date: string | null; text: string };
export type Transport = (request: TransportRequest) => Promise<TransportAnswer>;

/** The real device's way out: same origin, no session cookie along, nothing cached. Fetch is injected so that a test can pass a handler. */
export function fetchTransport(fetchImpl: typeof fetch): Transport {
  return async ({ path, headers, body, signal }) => {
    const response = await fetchImpl(path, { method: "POST", credentials: "omit", cache: "no-store", headers, body, signal });
    return { status: response.status, retryAfter: response.headers.get("retry-after"), date: response.headers.get("date"), text: await response.text() };
  };
}

export const isSourceKey = (value: string) => SOURCE_KEY_FORM.test(value);
export type DeviceHalt =
  | { kind: "none" }
  | { kind: "key_refused"; text: string }
  | { kind: "module_off"; retryAtMs: number }
  | { kind: "paused"; untilMs: number; reason: "rate" | "network" | "server" | "odd_answer" }
  | { kind: "stopped" };

export type EventResultRow = { index: number; eventId: string | null; status: "accepted" | "duplicate" | "rejected"; reason?: string; text?: string };
export type LogEntry = {
  id: number; atMs: number; path: string; probe: boolean; status: number | null; code: string | null; summary: string; tone: "ok" | "warning" | "danger";
  counts: { accepted: number; duplicate: number; rejected: number } | null; results: EventResultRow[]; retryAfter: string | null;
  requestHeader: string; requestBody: string; responseBody: string;
};

export type DeviceState = {
  queue: WireEvent[]; dropped: number;
  halt: DeviceHalt; failures: number; nextCallMs: number;
  /** The server's Retry-After, kept apart from the halt: neither Stoppa, Starta nor a single call goes past it. Only another key does. */
  rateLimitedUntilMs: number;
  maxBatch: number; inFlight: boolean; notice: string | null;
  sentCalls: number; acceptedEvents: number; duplicateEvents: number; rejected: { eventId: string | null; reason: string; text: string }[];
  clockSkewMs: number | null; lastAnswer: { status: number; atMs: number } | null; log: LogEntry[];
};

export const createDeviceState = (): DeviceState => ({
  queue: [], dropped: 0, halt: { kind: "stopped" }, failures: 0, nextCallMs: 0, rateLimitedUntilMs: 0, maxBatch: MAX_EVENTS_PER_CALL, inFlight: false, notice: null,
  sentCalls: 0, acceptedEvents: 0, duplicateEvents: 0, rejected: [], clockSkewMs: null, lastAnswer: null, log: [],
});

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;

/** From the head while the count and the encoded body both fit: twenty full events can exceed 64 kB, so the count alone is not enough. */
export function nextBatch(state: Pick<DeviceState, "queue" | "maxBatch">): WireEvent[] {
  const limit = Math.min(state.maxBatch, MAX_EVENTS_PER_CALL);
  const batch: WireEvent[] = [];
  let bytes = byteLength(eventsBody([]));
  for (const event of state.queue) {
    if (batch.length >= limit) break;
    const size = byteLength(JSON.stringify(event)) + (batch.length ? 1 : 0);
    if (batch.length && bytes + size > MAX_BODY_BYTES) break;
    batch.push(event);
    bytes += size;
  }
  return batch;
}

export function backoffMs(failures: number, random: () => number) {
  const base = Math.min(MAX_BACKOFF_MS, 2000 * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (0.8 + 0.4 * random()));
}

/** Whole seconds left of the server's Retry-After, or 0. */
export const rateLimitWaitS = (state: Pick<DeviceState, "rateLimitedUntilMs">, nowMs: number) => Math.max(0, Math.ceil((state.rateLimitedUntilMs - nowMs) / 1000));

export function retryAfterSeconds(value: string | null) {
  const seconds = Number(value);
  return value !== null && Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds), MAX_RETRY_AFTER_S) : DEFAULT_RETRY_AFTER_S;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function readBody(text: string): Record<string, unknown> | null {
  try { const parsed: unknown = JSON.parse(text); return isRecord(parsed) ? parsed : null; } catch { return null; }
}
const codeOf = (body: Record<string, unknown> | null) => (typeof body?.code === "string" ? body.code : null);
const errorOf = (body: Record<string, unknown> | null) => (typeof body?.error === "string" ? body.error : "");
const isEnvelopeCode = (code: string | null): code is EnvelopeError => code !== null && Object.hasOwn(ENVELOPE_ERROR_TEXT, code);
const readResults = (body: Record<string, unknown> | null): { index?: unknown; eventId?: unknown; status?: unknown; reason?: unknown }[] | null =>
  Array.isArray(body?.results) ? body.results.filter(isRecord) : null;

export type Sent = { kind: "events"; batch: readonly WireEvent[] };
/** `status: null` is a call that got no answer: network, timeout or aborted. */
export type Answer = { status: number | null; retryAfter: string | null; date: string | null; text: string };

const rejectionText = (reason: unknown, live: boolean) => {
  const text = typeof reason === "string" && Object.hasOwn(REJECT_REASON_TEXT, reason) ? REJECT_REASON_TEXT[reason as RejectReason] : "Händelsen nekades.";
  return reason === "time_window" && live ? `${text} ${CLOCK_HINT}` : text;
};
const keepRejected = (list: DeviceState["rejected"], more: DeviceState["rejected"]) => [...list, ...more].slice(-MAX_REJECTED_SHOWN);
const without = (queue: readonly WireEvent[], leaving: ReadonlySet<WireEvent>) => queue.filter((event) => !leaving.has(event));

/**
 * What one answer does to the device. Same rule as applyResults in the edge template: a result counts only if its index and eventId
 * belong to the same event, and only accepted and duplicate are delivered. Everything not named stays in the queue.
 */
export function applyAnswer(state: DeviceState, sent: Sent, answer: Answer, nowMs: number, random: () => number): DeviceState {
  const next: DeviceState = { ...state, ...(answer.status === null ? {} : { lastAnswer: { status: answer.status, atMs: nowMs } }) };
  const dateMs = answer.date ? Date.parse(answer.date) : NaN;
  if (Number.isFinite(dateMs)) next.clockSkewMs = dateMs - nowMs;
  const backoff = (reason: "network" | "server" | "odd_answer", text: (seconds: number) => string): DeviceState => {
    const failures = state.failures + 1;
    const delay = backoffMs(failures, random);
    return { ...next, failures, halt: { kind: "paused", untilMs: nowMs + delay, reason }, notice: text(Math.round(delay / 1000)) };
  };
  const delivered = (change: Partial<DeviceState>): DeviceState => ({ ...next, failures: 0, maxBatch: MAX_EVENTS_PER_CALL, halt: { kind: "none" }, notice: null, ...change });
  const dropSent = (reason: string, text: string): DeviceState => {
    const rows = sent.batch.map((event) => ({ eventId: event.eventId, reason, text }));
    return { ...delivered({ queue: without(state.queue, new Set(sent.batch)), rejected: keepRejected(state.rejected, rows) }), notice: text };
  };

  const { status } = answer;
  if (status === null) return backoff("network", backoffText);
  const body = readBody(answer.text);
  const code = codeOf(body);
  if (status >= 200 && status < 300) {
    const results = readResults(body);
    if (!results) return backoff("odd_answer", () => oddAnswerText(status));
    const leaving = new Set<WireEvent>();
    let accepted = 0, duplicate = 0;
    const rejected: DeviceState["rejected"] = [];
    sent.batch.forEach((event, index) => {
      const result = results.find((item) => item.index === index && (item.eventId === null || item.eventId === undefined || item.eventId === event.eventId));
      if (result?.status === "accepted") { accepted += 1; leaving.add(event); }
      else if (result?.status === "duplicate") { duplicate += 1; leaving.add(event); }
      else if (result?.status === "rejected") {
        const reason = typeof result.reason === "string" ? result.reason : "rejected";
        rejected.push({ eventId: event.eventId, reason, text: rejectionText(result.reason, true) });
        leaving.add(event);
      }
    });
    // Nothing matched: a repeat would get the same answer every second.
    if (!leaving.size) return backoff("odd_answer", () => oddAnswerText(status));
    return delivered({ queue: without(state.queue, leaving), acceptedEvents: state.acceptedEvents + accepted, duplicateEvents: state.duplicateEvents + duplicate, rejected: keepRejected(state.rejected, rejected) });
  }
  if (status === 401 || status === 403) return { ...next, halt: { kind: "key_refused", text: maskText(keyRefusedText(errorOf(body))) }, notice: null };
  if (status === 429) {
    const seconds = retryAfterSeconds(answer.retryAfter);
    return { ...next, rateLimitedUntilMs: nowMs + seconds * 1000, halt: { kind: "paused", untilMs: nowMs + seconds * 1000, reason: "rate" }, notice: rateLimitedText(seconds) };
  }
  if (status === 409 && code === "module_off") return { ...next, halt: { kind: "module_off", retryAtMs: nowMs + MODULE_OFF_RETRY_MS }, notice: MODULE_OFF_TEXT };
  if (status === 413) {
    if (sent.batch.length > 1) return { ...next, maxBatch: Math.ceil(sent.batch.length / 2), notice: null };
    return dropSent("too_large", TOO_LARGE_TEXT);
  }
  if (status === 400) {
    // The same call would fail every time, so it leaves instead of blocking everything behind it.
    if (isEnvelopeCode(code)) return dropSent(code, ENVELOPE_ERROR_TEXT[code]);
  }
  if (status === 408 || status >= 500) return backoff("server", backoffText);
  return backoff("odd_answer", () => oddAnswerText(status));
}

/** One call in words, for the log. Everything shown of the answer has been through the mask before it gets here. */
function describeAnswer(sent: Sent | { kind: "probe"; path: CallPath }, answer: Answer, networkNote: string | null): Pick<LogEntry, "code" | "summary" | "tone" | "counts" | "results"> {
  const empty = { counts: null, results: [] };
  if (answer.status === null) return { ...empty, code: null, summary: networkNote ?? NETWORK_TEXT, tone: "warning" };
  const body = readBody(answer.text);
  const code = codeOf(body);
  const results = readResults(body);
  if (answer.status >= 200 && answer.status < 300 && results) {
    const rows: EventResultRow[] = results.map((item) => ({
      index: typeof item.index === "number" ? item.index : -1, eventId: typeof item.eventId === "string" ? item.eventId : null,
      status: item.status === "accepted" || item.status === "duplicate" ? item.status : "rejected",
      ...(item.status === "rejected" ? { reason: typeof item.reason === "string" ? item.reason : "rejected", text: rejectionText(item.reason, sent.kind !== "probe") } : {}),
    }));
    const counts = { accepted: rows.filter((row) => row.status === "accepted").length, duplicate: rows.filter((row) => row.status === "duplicate").length, rejected: rows.filter((row) => row.status === "rejected").length };
    return { code: null, results: rows, counts, tone: counts.rejected ? "warning" : "ok", summary: `Mottagna ${counts.accepted}, dubbletter ${counts.duplicate}, nekade ${counts.rejected}.` };
  }
  const summary = (() => {
    if (answer.status === 401 || answer.status === 403) return `${maskText(errorOf(body)) || "Nyckeln nekades."} ${KEY_NO_RETRY_TEXT}`;
    if (answer.status === 429) return rateLimitedText(retryAfterSeconds(answer.retryAfter));
    if (answer.status === 409 && code === "module_off") return MODULE_OFF_TEXT;
    if (answer.status === 413) return TOO_LARGE_TEXT;
    if (isEnvelopeCode(code)) return ENVELOPE_ERROR_TEXT[code];
    return oddAnswerText(answer.status);
  })();
  return { ...empty, code, summary, tone: answer.status === 401 || answer.status === 403 ? "danger" : "warning" };
}

/** One call outside the queue, with the source's own key: the connection test. */
export type ProbeRequest = { path: CallPath; body: string };

export type DeviceDeps = { transport: Transport; getKey: () => string | null; clock: () => number; random: () => number };
export type Device = {
  getState(): DeviceState;
  subscribe(listener: () => void): () => void;
  /** Called with each finished call, for the scenario's verdicts. */
  onCall(listener: (entry: LogEntry) => void): () => void;
  enqueue(events: readonly WireEvent[]): void;
  /** At most one call, if the pacing and any pause allow it. */
  pump(): Promise<void>;
  /** A line in the log for something that is no call of the device's own: a failed step of the connection, as it was said. */
  note(entry: { path: string; status: number | null; summary: string; tone: LogEntry["tone"] }): void;
  /** One call outside the queue. Queue untouched; own-key answers that say stop still stop the device. */
  probe(request: ProbeRequest): Promise<LogEntry | { refused: string }>;
  start(): void;
  stop(): void;
  /** Only a new paste undoes a refused key. */
  rearm(): void;
  /** Another source's key, or none: what waits belongs to the old source, and so does its Retry-After. */
  keyChanged(): void;
  /** What waits is sent at no higher level than this. The eventId stays. */
  clampQueue(maxSeverity: SendPolicy["maxSeverity"]): void;
  retryNow(): void;
  clearQueue(): void;
  clearLog(): void;
  logFileText(): string;
};

const cutText = (text: string) => (text.length > MAX_LOG_TEXT ? `${text.slice(0, MAX_LOG_TEXT)}…` : text);

export function createDevice(deps: DeviceDeps): Device {
  let state = createDeviceState();
  let nextLogId = 1;
  let controller: AbortController | null = null;
  let current: Promise<unknown> | null = null;
  // A stop makes an answer still on its way count for nothing: the call may have arrived, so a later resend gives duplicate.
  let generation = 0;
  const listeners = new Set<() => void>();
  const callListeners = new Set<(entry: LogEntry) => void>();
  const setState = (next: DeviceState) => { state = next; for (const listener of listeners) listener(); };

  const addLog = (request: { path: CallPath; probe: boolean; header: string; body: string }, sent: Sent | { kind: "probe"; path: CallPath }, answer: Answer, atMs: number, networkNote: string | null) => {
    const key = deps.getKey();
    const described = describeAnswer(sent, answer, networkNote);
    const entry: LogEntry = {
      id: nextLogId++, atMs, path: request.path, probe: request.probe, status: answer.status, retryAfter: answer.retryAfter, ...described, summary: maskText(described.summary, key),
      requestHeader: request.header, requestBody: maskText(cutText(request.body), key), responseBody: maskText(cutText(answer.text), key),
    };
    state = { ...state, log: [...state.log, entry].slice(-MAX_LOG_ENTRIES) };
    return entry;
  };

  /** The one place a call leaves the device. The key meets the header here and nowhere else. */
  async function call(path: CallPath, headers: Record<string, string>, body: string): Promise<{ answer: Answer; note: string | null; mine: boolean }> {
    const mine = generation;
    const abort = new AbortController();
    controller = abort;
    const timer = setTimeout(() => abort.abort(), CALL_TIMEOUT_MS);
    try {
      const answer = await deps.transport({ path, headers, body, signal: abort.signal });
      return { answer, note: null, mine: mine === generation };
    } catch {
      return { answer: { status: null, retryAfter: null, date: null, text: "" }, note: null, mine: mine === generation };
    } finally {
      clearTimeout(timer);
      if (controller === abort) controller = null;
    }
  }

  const headersFor = (key: string): Record<string, string> => ({ "content-type": "application/json", authorization: `Bearer ${key}` });
  const HEADER_TEXT = `Authorization: Bearer ${MASKED_VALUE}`;
  const usableKey = () => { const key = deps.getKey(); return key && isSourceKey(key) ? key : null; };

  const canCall = (nowMs: number) => {
    if (state.inFlight || nowMs < state.nextCallMs || nowMs < state.rateLimitedUntilMs) return false;
    const { halt } = state;
    if (halt.kind === "stopped" || halt.kind === "key_refused") return false;
    if (halt.kind === "paused") return nowMs >= halt.untilMs;
    if (halt.kind === "module_off") return nowMs >= halt.retryAtMs;
    return true;
  };

  async function pump(): Promise<void> {
    const startedMs = deps.clock();
    if (!canCall(startedMs)) return;
    const key = usableKey();
    if (!key) return;
    if (!state.queue.length) return;
    const batch = nextBatch(state);
    const sent: Sent = { kind: "events", batch };
    const path = EVENTS_PATH;
    const body = eventsBody(batch);
    setState({ ...state, inFlight: true, nextCallMs: startedMs + MIN_CALL_GAP_MS, sentCalls: state.sentCalls + 1 });
    const running = call(path, headersFor(key), body);
    current = running;
    const { answer, note, mine } = await running;
    current = null;
    const entry = addLog({ path, probe: false, header: HEADER_TEXT, body }, sent, answer, startedMs, mine ? note : STOPPED_IN_CALL_TEXT);
    if (!mine) { setState({ ...state, inFlight: false }); return; }
    setState({ ...applyAnswer(state, sent, answer, deps.clock(), deps.random), inFlight: false });
    for (const listener of callListeners) listener(entry);
  }

  async function probe(request: ProbeRequest): Promise<LogEntry | { refused: string }> {
    if (holdsKeyForm(request.body)) return { refused: BODY_HOLDS_KEY_TEXT };
    const useKey = usableKey();
    if (!useKey) return { refused: "Klistra in nyckeln först." };
    if (state.halt.kind === "key_refused") return { refused: state.halt.text };
    // The source is over its limit: another call only gets another 429.
    if (rateLimitWaitS(state, deps.clock()) > 0) return { refused: rateLimitWaitText(rateLimitWaitS(state, deps.clock())) };
    if (current) await current;
    const startedMs = deps.clock();
    setState({ ...state, inFlight: true, nextCallMs: startedMs + MIN_CALL_GAP_MS, sentCalls: state.sentCalls + 1 });
    const running = call(request.path, headersFor(useKey), request.body);
    current = running;
    const { answer, note, mine } = await running;
    current = null;
    const entry = addLog({ path: request.path, probe: true, header: HEADER_TEXT, body: request.body }, { kind: "probe", path: request.path }, answer, startedMs, note);
    // A probe's own body says nothing about the queue. Only what concerns the key itself carries over.
    let next: DeviceState = { ...state, inFlight: false, ...(answer.status === null ? {} : { lastAnswer: { status: answer.status, atMs: deps.clock() } }) };
    // A single call counts in the same counters as the queue, so the bar and the log agree.
    if (entry.counts) {
      const rejected = entry.results.filter((row) => row.status === "rejected").map((row) => ({ eventId: row.eventId, reason: row.reason ?? "rejected", text: row.text ?? "" }));
      next = { ...next, acceptedEvents: next.acceptedEvents + entry.counts.accepted, duplicateEvents: next.duplicateEvents + entry.counts.duplicate, rejected: keepRejected(next.rejected, rejected) };
    }
    if (mine && (answer.status === 401 || answer.status === 403 || answer.status === 429 || (answer.status === 409 && codeOf(readBody(answer.text)) === "module_off"))) {
      const wasStopped = state.halt.kind === "stopped";
      next = { ...applyAnswer(next, { kind: "events", batch: [] }, answer, deps.clock(), deps.random), inFlight: false };
      // A single call from a stopped device must not set it going when the pause ends.
      if (wasStopped && next.halt.kind !== "key_refused") next = { ...next, halt: { kind: "stopped" } };
    }
    setState(next);
    for (const listener of callListeners) listener(entry);
    return entry;
  }

  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    onCall(listener) { callListeners.add(listener); return () => { callListeners.delete(listener); }; },
    enqueue(events) {
      if (!events.length) return;
      const queue = [...state.queue, ...events];
      const over = Math.max(0, queue.length - MAX_QUEUE);
      setState({ ...state, queue: over ? queue.slice(over) : queue, dropped: state.dropped + over });
    },
    pump,
    probe,
    note({ path, status, summary, tone }) {
      const entry: LogEntry = { id: nextLogId++, atMs: deps.clock(), path, probe: false, status, code: null, summary: maskText(summary, deps.getKey()), tone, counts: null, results: [], retryAfter: null, requestHeader: "", requestBody: "", responseBody: "" };
      setState({ ...state, log: [...state.log, entry].slice(-MAX_LOG_ENTRIES) });
    },
    start() {
      if (state.halt.kind === "stopped") setState({ ...state, halt: { kind: "none" }, notice: null });
    },
    stop() {
      generation += 1;
      controller?.abort();
      if (state.halt.kind !== "key_refused") setState({ ...state, halt: { kind: "stopped" }, notice: null, failures: 0 });
    },
    rearm() {
      if (state.halt.kind === "key_refused") setState({ ...state, halt: { kind: "stopped" }, notice: null });
    },
    keyChanged() {
      setState({ ...state, queue: [], rateLimitedUntilMs: 0, notice: null, ...(state.halt.kind === "key_refused" ? { halt: { kind: "stopped" as const } } : {}) });
    },
    clampQueue(maxSeverity) {
      const queue = state.queue.map((event) => { const severity = clampSeverity(event.severity, { maxSeverity }); return severity === event.severity ? event : { ...event, severity }; });
      if (queue.some((event, index) => event !== state.queue[index])) setState({ ...state, queue });
    },
    retryNow() {
      const { halt } = state;
      if (halt.kind === "module_off") setState({ ...state, halt: { ...halt, retryAtMs: 0 } });
      // Retry-After is the server's word and is not overruled by a button.
      else if (halt.kind === "paused" && halt.reason !== "rate") setState({ ...state, halt: { ...halt, untilMs: 0 } });
    },
    clearQueue() { setState({ ...state, queue: [], notice: null }); },
    clearLog() { setState({ ...state, log: [] }); },
    logFileText() { return maskText(JSON.stringify({ format: "hintek-plc-simulator-log", entries: state.log }, null, 2), deps.getKey()); },
  };
}

export type DeviceStatus = { word: string; tone: "neutral" | "success" | "warning" | "danger"; waitS: number | null };

/** The status row's state, in one place. A countdown is a separate number, so the page can hold its width still. */
export function deviceStatus(state: DeviceState, nowMs: number): DeviceStatus {
  const { halt } = state;
  if (halt.kind === "key_refused") return { word: "Nekad: nyckeln", tone: "danger", waitS: null };
  if (halt.kind === "stopped") return { word: "Stoppad", tone: "neutral", waitS: null };
  if (halt.kind === "module_off") return { word: "Underhåll är av", tone: "warning", waitS: Math.max(0, Math.ceil((halt.retryAtMs - nowMs) / 1000)) };
  if (rateLimitWaitS(state, nowMs) > 0) return { word: "Väntar: taket", tone: "warning", waitS: rateLimitWaitS(state, nowMs) };
  if (halt.kind === "paused" && nowMs < halt.untilMs) {
    const word = halt.reason === "rate" ? "Väntar: taket" : halt.reason === "odd_answer" ? "Väntar: oväntat svar" : "Väntar: nätet";
    return { word, tone: "warning", waitS: Math.ceil((halt.untilMs - nowMs) / 1000) };
  }
  return { word: "Kör", tone: "success", waitS: null };
}
