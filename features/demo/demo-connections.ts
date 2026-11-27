import type { DemoDatabase } from "./demo-data";
import { DEMO_MACHINE_SOURCE_NAME } from "./machine/protocol";

/**
 * Kopplingar i demon (2026-11-04): /api/integration-keys and /api/machine-sources answered from memory, in the shapes of the
 * real routes, so Kopplingar's areas (API och MCP, Maskiner) read and behave like Cloud's. Everything is invented and harmless:
 * one example API key shown only as a masked hint, two made-up machine sources with recent made-up events (days relative to
 * today, so the page holds on every weekday). A key a person "creates" is a clearly fake placeholder text, never a working key;
 * what needs a server (profiles, signal rules, analysis) says plainly that it cannot be tried in the demo. Nothing leaves the
 * browser and a reload starts over.
 */
export class DemoConnectionsError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export const DEMO_CONNECTION_UNAVAILABLE = "Det här går inte att prova i demon. Det behöver en server och en riktig koppling.";
const FAKE_TOKEN = "EXEMPEL-endast-i-demon-fungerar-inte";

type Ctx = { db: DemoDatabase; user: { id: string; name: string }; admin: boolean; now: Date };
type Req = { method: string; url: URL; body: unknown };

type Source = {
  id: string; name: string; displayHint: string; status: "active" | "expired" | "revoked" | "inactive"; keyIssuedAt: string; keyExpiresAt: string | null;
  lastUsedAt: string | null; lastEventAt: string | null; alarmMode: "off" | "direct" | "approval"; cooldownMinutes: number;
  part: null; signals: { total: number; discovered: number; active: number; ignoredOverCap: number }; profileId: null; captureUntil: null;
};
type Event = { id: string; eventId: string; occurredAt: string; type: string; code: string; severity: string; state: string | null; text: string; basis: string | null; values: Record<string, number | boolean | string> | null };
type Signal = {
  id: string; key: string; kind: "number" | "boolean" | "text" | "code"; status: "discovered" | "active" | "ignored"; name: string; unit: string; partId: null; deadband: null; runHoursFeed: boolean;
  firstSeenAt: string; lastSeenAt: string; lastValue: unknown; lastValueAt: string | null; part: null;
};
/** The demo's own source (Prova maskinkopplingen): connected from the start, with no key at all. Only here, only in the browser's memory. */
export const DEMO_MACHINE_SOURCE_ID = "demo-source-demokoppling";
const DEMO_MACHINE_NO_KEY = "Demokopplingen har ingen nyckel. Den finns bara i den här webbläsaren.";

type Store = { sources: Source[]; events: Map<string, Event[]>; signals: Map<string, Signal[]>; sequence: number };
const stores = new WeakMap<DemoDatabase, Store>();

const MINUTE = 60_000;
const iso = (now: Date, minutesAgo: number) => new Date(now.getTime() - minutesAgo * MINUTE).toISOString();

function seed(now: Date): Store {
  const source = (id: string, name: string, hint: string, lastMinutes: number, count: number): Source => ({
    id, name, displayHint: hint, status: "active", keyIssuedAt: iso(now, 60 * 24 * 40), keyExpiresAt: new Date(now.getTime() + 300 * 86_400_000).toISOString(),
    lastUsedAt: iso(now, lastMinutes), lastEventAt: iso(now, lastMinutes), alarmMode: "approval", cooldownMinutes: 30, part: null,
    signals: { total: count, discovered: 1, active: count - 1, ignoredOverCap: 0 }, profileId: null, captureUntil: null,
  });
  const sources = [
    source("demo-source-ventilation", "Ventilationsaggregat TA1", "••••demo1", 4, 3),
    source("demo-source-kompressor", "Kompressorrum, styrsystem", "••••demo2", 55, 3),
    // 1 minute is the shortest rest the product allows; a new source there has 30.
    { ...source(DEMO_MACHINE_SOURCE_ID, DEMO_MACHINE_SOURCE_NAME, "Ingen nyckel", 0, 1), lastUsedAt: null, lastEventAt: null, alarmMode: "direct" as const, cooldownMinutes: 1, keyExpiresAt: null, signals: { total: 0, discovered: 0, active: 0, ignoredOverCap: 0 } },
  ];
  const events = new Map<string, Event[]>();
  events.set(DEMO_MACHINE_SOURCE_ID, []);
  const event = (id: string, minutesAgo: number, type: string, code: string, severity: string, text: string, state: string | null = null, values: Event["values"] = null): Event =>
    ({ id: `demo-event-${id}`, eventId: `evt-${id}`, occurredAt: iso(now, minutesAgo), type, code, severity, state, text, basis: null, values });
  events.set(sources[0].id, [
    event("v1", 4, "state", "RUN", "info", "Aggregatet går i normaldrift.", "running", { tilluft_c: 19.4 }),
    event("v2", 190, "alarm", "FILTER_TRYCK", "warning", "Högt tryckfall över tilluftsfiltret.", null, { tryckfall_pa: 212 }),
    event("v3", 60 * 26, "diagnosis", "FLÄKT_VIBRATION", "info", "Vibrationen i tilluftsfläkten är något förhöjd men stabil.", null, { vibration_mm_s: 3.1 }),
  ]);
  events.set(sources[1].id, [
    event("k1", 55, "state", "LAST", "info", "Kompressorn har gått i lastläge i 42 minuter.", "loaded", { tryck_bar: 7.4 }),
    event("k2", 60 * 5, "alarm", "TEMP_OLJA", "warning", "Oljetemperaturen närmar sig larmgränsen.", null, { olja_c: 94 }),
    event("k3", 60 * 49, "state", "STOPP", "info", "Planerat stopp för filterbyte.", "stopped"),
  ]);
  const signal = (id: string, key: string, kind: Signal["kind"], status: Signal["status"], name: string, unit: string, value: unknown, minutesAgo: number): Signal =>
    ({ id: `demo-signal-${id}`, key, kind, status, name, unit, partId: null, deadband: null, runHoursFeed: false, firstSeenAt: iso(now, 60 * 24 * 30), lastSeenAt: iso(now, minutesAgo), lastValue: value, lastValueAt: iso(now, minutesAgo), part: null });
  const signals = new Map<string, Signal[]>([
    [sources[0].id, [signal("v1", "tilluft_c", "number", "active", "Tilluftstemperatur", "°C", 19.4, 4), signal("v2", "tryckfall_pa", "number", "active", "Tryckfall filter", "Pa", 212, 4), signal("v3", "fran_bms", "text", "discovered", "", "", "ok", 4)]],
    [sources[1].id, [signal("k1", "tryck_bar", "number", "active", "Systemtryck", "bar", 7.4, 55), signal("k2", "olja_c", "number", "active", "Oljetemperatur", "°C", 88, 55), signal("k3", "lastlage", "boolean", "discovered", "", "", true, 55)]],
  ]);
  return { sources, events, signals, sequence: 10 };
}
const storeOf = (ctx: Ctx) => { let store = stores.get(ctx.db); if (!store) { store = seed(ctx.now); stores.set(ctx.db, store); } return store; };
const admin = (ctx: Ctx) => { if (!ctx.admin) throw new DemoConnectionsError(403, "Bara en företagsadministratör kan göra det."); };
const input = (body: unknown) => (body && typeof body === "object" ? body as Record<string, unknown> : {});

/** API och MCP: the company's keys and connected apps. One example key, masked; nothing can be issued here. */
export function demoIntegrationKeys(ctx: Ctx, request: Req) {
  admin(ctx);
  if (request.method !== "GET") throw new DemoConnectionsError(403, "Nycklar skapas inte i demon. I Workflow visas en ny nyckel en enda gång.");
  if (request.url.searchParams.get("scope") === "server") throw new DemoConnectionsError(403, "Serverns nycklar hör till produktägarens sidor.");
  const iso1 = (days: number) => new Date(ctx.now.getTime() - days * 86_400_000).toISOString();
  return {
    keys: [{
      id: "demo-key-rapport", kind: "API", name: "Exempel: egen rapportvy", provider: null, scopes: ["projects:read", "tasks:read"], displayHint: "••••demo", expiresAt: new Date(ctx.now.getTime() + 200 * 86_400_000).toISOString(),
      lastUsedAt: iso1(1), revokedAt: null, createdAt: iso1(60), updatedAt: iso1(60), createdBy: ctx.user.name,
    }],
    revoked: [],
    members: ctx.db.users.map((user) => ({ id: user.id, name: user.name, admin: user.role === "ADMIN" })),
    currentUserId: ctx.user.id,
    connections: [],
  };
}

const eventsOf = (store: Store, id: string) => store.events.get(id) ?? [];
const view = (store: Store) => store.sources.map((source) => ({ ...source, events24h: eventsOf(store, source.id).filter((item) => Date.parse(item.occurredAt) > Date.now() - 86_400_000).length }));

/** Maskiner: sources, their events and signals, alarm responsibility. Reads answer fully; analysis, profiles and rules need a server. */
export function demoMachineSource(db: DemoDatabase, now: Date) {
  const store = storeOf({ db, user: { id: "", name: "" }, admin: true, now });
  return store.sources.find((item) => item.id === DEMO_MACHINE_SOURCE_ID)!;
}
/** An event from the Demokoppling, already checked by the intake's own parseEvent; it shows under Händelser as any other. */
export function demoMachineIngest(db: DemoDatabase, event: Omit<Event, "id">, now: Date) {
  const store = storeOf({ db, user: { id: "", name: "" }, admin: true, now });
  const source = demoMachineSource(db, now);
  const list = store.events.get(source.id) ?? [];
  list.unshift({ ...event, id: `demo-event-${++store.sequence}` });
  store.events.set(source.id, list);
  source.lastEventAt = source.lastUsedAt = now.toISOString();
}
export const demoMachineEvents = (db: DemoDatabase, now: Date) => eventsOf(storeOf({ db, user: { id: "", name: "" }, admin: true, now }), DEMO_MACHINE_SOURCE_ID);

export function demoMachineSources(ctx: Ctx, request: Req) {
  admin(ctx);
  const store = storeOf(ctx);
  const params = request.url.searchParams;
  if (request.method === "GET") {
    if (params.get("profiles") === "1") return { profiles: [], example: { name: "Exempelprofil", definition: {} }, limit: 50 };
    if (params.get("alarms") === "1") return {
      settings: { hours: "daytime", escalationMinutes: 15 }, people: ctx.db.users.map((user) => ({ userId: user.id, name: user.name })), objects: [],
      safety: "Larm till en person går alltid via en bekräftelse. Demon skickar inga meddelanden.",
    };
    const sourceId = params.get("sourceId");
    if (sourceId) {
      const source = store.sources.find((item) => item.id === sourceId);
      if (!source) throw new DemoConnectionsError(404, "Källan hittades inte.");
      if (params.get("signals") === "1") return { source: { id: source.id, name: source.name, ignoredSignals: 0 }, signals: store.signals.get(sourceId) ?? [], rules: [], limits: { perSource: 200, perCompany: 1000, companyCount: store.sources.length * 3 } };
      if (params.get("samples") === "1") return { samples: [], captureUntil: null };
      return { events: eventsOf(store, sourceId) };
    }
    return { sources: view(store), waiting: [], suggestions: [] };
  }
  const body = input(request.body);
  const id = String(body.id ?? "");
  const source = store.sources.find((item) => item.id === id);
  if (id === DEMO_MACHINE_SOURCE_ID && (body.action === "rotate" || body.action === "revoke" || body.action === "remove")) throw new DemoConnectionsError(403, DEMO_MACHINE_NO_KEY);
  if (id === DEMO_MACHINE_SOURCE_ID && body.action === "set_alarm" && body.alarmMode === "approval") throw new DemoConnectionsError(403, "Väntar på godkännande provas inte i Demokopplingen. Välj Av eller Märkt arbetsorder direkt.");
  switch (body.action) {
    case "create": {
      const name = String(body.name ?? "").trim().slice(0, 80);
      if (!name) throw new DemoConnectionsError(400, "Skriv ett namn på källan.");
      const sourceId = `demo-source-${++store.sequence}`;
      store.sources.push({ id: sourceId, name, displayHint: "••••demo", status: "active", keyIssuedAt: ctx.now.toISOString(), keyExpiresAt: new Date(ctx.now.getTime() + 365 * 86_400_000).toISOString(), lastUsedAt: null, lastEventAt: null, alarmMode: "approval", cooldownMinutes: 30, part: null, signals: { total: 0, discovered: 0, active: 0, ignoredOverCap: 0 }, profileId: null, captureUntil: null });
      return { token: FAKE_TOKEN };
    }
    case "rotate": if (!source) break; source.status = "active"; source.keyIssuedAt = ctx.now.toISOString(); return { token: FAKE_TOKEN };
    case "revoke": if (!source) break; source.status = "revoked"; return { ok: true };
    case "remove": if (!source) break; store.sources.splice(store.sources.indexOf(source), 1); return { ok: true };
    case "set_alarm": {
      if (!source) break;
      if (body.alarmMode === "off" || body.alarmMode === "direct" || body.alarmMode === "approval") source.alarmMode = body.alarmMode;
      return { ok: true };
    }
    case "test_event": {
      if (!source) break;
      const list = store.events.get(source.id) ?? [];
      list.unshift({ id: `demo-event-${++store.sequence}`, eventId: `evt-test-${store.sequence}`, occurredAt: ctx.now.toISOString(), type: "state", code: "TEST", severity: "info", state: null, text: "Testhändelse från demon.", basis: null, values: null });
      store.events.set(source.id, list);
      source.lastEventAt = source.lastUsedAt = ctx.now.toISOString();
      return { ok: true };
    }
    case "set_part": if (!source) break; if (body.partId) throw new DemoConnectionsError(403, DEMO_CONNECTION_UNAVAILABLE); return { ok: true };
    default: throw new DemoConnectionsError(403, DEMO_CONNECTION_UNAVAILABLE);
  }
  throw new DemoConnectionsError(404, "Källan hittades inte.");
}
