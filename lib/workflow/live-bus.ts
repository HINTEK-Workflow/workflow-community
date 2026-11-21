import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { nodePgConfig } from "@/lib/database-url";
import { env } from "@/lib/env";

/**
 * Live sync for tasks (2026-10-04): who has a task open and what changed, pushed from our own server to the
 * browsers with Server-Sent Events – no outside service. Each app process keeps its own connections; the processes of
 * one installation tell each other through PostgreSQL's LISTEN/NOTIFY on the database they already share, so two
 * people reach each other whichever process serves them. Only ids, a version and a name travel, never task content.
 * A browser that misses an event still has the server's version check, so nothing is ever written over in silence.
 */
export type LiveEditor = { connectionId: string; userId: string; name: string; since: number };
export type TaskChangeEvent = { type: "changed"; version: number; byUserId: string; byName: string; status?: string; reason: "save" | "reopen" | "timer" | "attachment" | "delete" };
export type TaskLiveEvent = { type: "presence"; editors: { userId: string; name: string }[] } | TaskChangeEvent;
type Listener = (event: TaskLiveEvent) => void;
type Person = { userId: string; name: string };
type Wire =
  | { kind: "changed"; process: string; taskId: string; event: TaskChangeEvent }
  | { kind: "presence"; process: string; taskId: string; editors: Person[]; ask?: boolean };

const CHANNEL = "workflow_live";
// Another process's editors count while it keeps announcing them; a stopped process drops out after a minute.
const REMOTE_TTL_MS = 60_000;
const ANNOUNCE_MS = 20_000;

type Bus = {
  process: string;
  listeners: Map<string, Map<string, Listener>>;
  editors: Map<string, Map<string, LiveEditor>>;
  remote: Map<string, Map<string, { editors: Person[]; at: number }>>;
  client: Client | null;
  connecting: Promise<Client | null> | null;
  retryAt: number;
  timer: ReturnType<typeof setInterval> | null;
  /** The last queued notify; sends wait for it so the client never runs two queries at once. */
  queue?: Promise<void>;
};
const globalBus = globalThis as typeof globalThis & { __workflowLiveBus?: Bus };
const bus: Bus = globalBus.__workflowLiveBus ??= { process: randomUUID(), listeners: new Map(), editors: new Map(), remote: new Map(), client: null, connecting: null, retryAt: 0, timer: null };

const localPeople = (taskId: string) => [...(bus.editors.get(taskId)?.values() ?? [])].map(({ userId, name }) => ({ userId, name }));

/** The people with the task open in any process, once each (a person with two tabs counts once). */
export function taskEditors(taskId: string) {
  const seen = new Map<string, Person>();
  const now = Date.now();
  for (const person of localPeople(taskId)) if (!seen.has(person.userId)) seen.set(person.userId, person);
  for (const [process, entry] of bus.remote.get(taskId) ?? []) {
    if (now - entry.at > REMOTE_TTL_MS) { bus.remote.get(taskId)?.delete(process); continue; }
    for (const person of entry.editors) if (!seen.has(person.userId)) seen.set(person.userId, person);
  }
  return [...seen.values()];
}

function emit(taskId: string, event: TaskLiveEvent) {
  for (const listener of bus.listeners.get(taskId)?.values() ?? []) {
    try { listener(event); } catch { /* a closed stream is removed by its own cleanup */ }
  }
}
const emitPresence = (taskId: string) => emit(taskId, { type: "presence", editors: taskEditors(taskId) });

function receive(raw: string | undefined) {
  let wire: Wire;
  try { wire = JSON.parse(raw ?? "") as Wire; } catch { return; }
  if (!wire || wire.process === bus.process || typeof wire.taskId !== "string") return;
  if (wire.kind === "changed") { emit(wire.taskId, wire.event); return; }
  if (wire.kind !== "presence" || !Array.isArray(wire.editors)) return;
  const entries = bus.remote.get(wire.taskId) ?? new Map();
  if (wire.editors.length) entries.set(wire.process, { editors: wire.editors.slice(0, 50), at: Date.now() }); else entries.delete(wire.process);
  if (entries.size) bus.remote.set(wire.taskId, entries); else bus.remote.delete(wire.taskId);
  // Someone just opened the task elsewhere: tell them who is here at once instead of at the next announcement.
  if (wire.ask && bus.editors.get(wire.taskId)?.size) void send({ kind: "presence", process: bus.process, taskId: wire.taskId, editors: localPeople(wire.taskId) });
  if (bus.listeners.get(wire.taskId)?.size) emitPresence(wire.taskId);
}

async function connection(): Promise<Client | null> {
  if (bus.client) return bus.client;
  if (bus.connecting) return bus.connecting;
  if (Date.now() < bus.retryAt) return null;
  bus.connecting = (async () => {
    const client = new Client(nodePgConfig(env.DATABASE_URL));
    try {
      await client.connect();
      client.on("notification", (message) => { if (message.channel === CHANNEL) receive(message.payload); });
      // A lost connection falls back to this process alone until the next attempt (in 30 seconds at the earliest).
      client.on("error", () => { if (bus.client === client) bus.client = null; bus.retryAt = Date.now() + 30_000; void client.end().catch(() => undefined); });
      client.on("end", () => { if (bus.client === client) bus.client = null; });
      await client.query(`LISTEN ${CHANNEL}`);
      bus.client = client;
      bus.timer ??= setInterval(() => {
        for (const taskId of bus.editors.keys()) void send({ kind: "presence", process: bus.process, taskId, editors: localPeople(taskId) });
      }, ANNOUNCE_MS);
      bus.timer.unref?.();
      return client;
    } catch {
      bus.retryAt = Date.now() + 30_000;
      await client.end().catch(() => undefined);
      return null;
    } finally { bus.connecting = null; }
  })();
  return bus.connecting;
}

async function send(wire: Wire) {
  const client = await connection();
  if (!client) return;
  // One query at a time on the listening client (quality check 2026-10-05: concurrent pg_notify calls gave pg's
  // "client is already executing a query" deprecation warning, an error from pg 9 on).
  const queued = (bus.queue ?? Promise.resolve()).then(() => client.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify(wire)]))
    .then(() => undefined, () => undefined /* the version check still protects the data */);
  bus.queue = queued;
  await queued;
}

/** Opens a connection to a task; returns the function that closes it. Everyone with the task open hears who joined. */
export function joinTask(taskId: string, user: { id: string; name: string }, listener: Listener) {
  const connectionId = randomUUID();
  const listeners = bus.listeners.get(taskId) ?? new Map<string, Listener>();
  listeners.set(connectionId, listener);
  bus.listeners.set(taskId, listeners);
  const editors = bus.editors.get(taskId) ?? new Map<string, LiveEditor>();
  editors.set(connectionId, { connectionId, userId: user.id, name: user.name, since: Date.now() });
  bus.editors.set(taskId, editors);
  emitPresence(taskId);
  void send({ kind: "presence", process: bus.process, taskId, editors: localPeople(taskId), ask: true });
  return () => {
    bus.listeners.get(taskId)?.delete(connectionId);
    bus.editors.get(taskId)?.delete(connectionId);
    if (!bus.listeners.get(taskId)?.size) bus.listeners.delete(taskId);
    if (!bus.editors.get(taskId)?.size) bus.editors.delete(taskId);
    emitPresence(taskId);
    void send({ kind: "presence", process: bus.process, taskId, editors: localPeople(taskId) });
  };
}

/** Tells everyone with the task open that a newer version is saved; they read it and merge it with their own. */
export function publishTaskChange(taskId: string, change: Omit<TaskChangeEvent, "type">) {
  const event: TaskChangeEvent = { type: "changed", ...change };
  emit(taskId, event);
  void send({ kind: "changed", process: bus.process, taskId, event });
}
