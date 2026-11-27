import path from "node:path";
import { mkdir, open, readdir, readFile, rm, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { localRoleQaEnabled } from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { centralSecrets, saveCentralSecret, type CentralActor } from "@/lib/secrets/central-store";
import { RemoteGeoPackage, RemoteSqlite, type TileSet } from "./sqlite-remote";
import { MAP_LAYERS, type MapLayer, type MapStatus } from "./attribution";

/**
 * Karta från Lantmäteriet (2026-10-04): Topografisk webbkarta Nedladdning, raster, CC BY 4.0. Lantmäteriet
 * publishes it through a STAC API (https://api.lantmateriet.se/stac-karta/v1, collection "topowebb", from 2026-10-06) as
 * one GeoPackage per layer and coordinate system for the whole country (about 140–175 GB, behind HTTP Basic sign-in with
 * the Geotorget account that has the product). This server reads only the tiles someone needs, by byte ranges, keeps
 * them on its own disk under a size limit and serves them itself; the browser never contacts Lantmäteriet. The Web
 * Mercator file (EPSG:3857) is used, so tiles are shown as they are – no reprojection.
 */
const STAC_ITEMS = "https://api.lantmateriet.se/stac-karta/v1/collections/topowebb/items";
const CACHE_ROOT = path.resolve(env.STORAGE_ROOT, "map-tiles");
const WORLD = 20037508.342789244;
export const DEFAULT_CACHE_MB = 1024;
export const MAX_CACHE_MB = 20_000;

type Stored = {
  userCipher?: string; passwordCipher?: string; userHint?: string;
  layer?: MapLayer; capMb?: number;
  /** The file's address from the STAC catalogue, per layer, found by the last check. */
  sources?: Partial<Record<MapLayer, string>>;
  zoom?: { min: number; max: number };
  lastCheck?: { ok: boolean; message: string; at: string };
  updatedAt?: string; updatedBy?: string;
  /** Alarm already sent for the current failure (keys:alerts), so it is sent once. */
  alertedAt?: string;
};

/**
 * The Geotorget sign-in is two central keys (lib/secrets/central-store.ts, 2026-10-25). Within this module userCipher and
 * passwordCipher are only markers that a value is in place; the opened pair is kept beside the object it was read with,
 * and the raw JSON's old sealed values are left as they are until moved (or changed).
 */
const MARK = "central";
const opened = new WeakMap<Stored, { user: string; password: string }>();
async function rawStored(): Promise<Stored> {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { map: true } });
  return (row?.map ?? {}) as Stored;
}
async function stored(): Promise<Stored> {
  const [raw, values] = await Promise.all([rawStored(), centralSecrets(["lantmateriet.mapUser", "lantmateriet.mapPassword"] as const)]);
  const user = values["lantmateriet.mapUser"];
  const password = values["lantmateriet.mapPassword"];
  const value: Stored = { ...raw, userCipher: user ? MARK : undefined, passwordCipher: password ? MARK : undefined };
  opened.set(value, { user, password });
  return value;
}
async function save(next: Stored, changed: { user?: boolean; password?: boolean } = {}) {
  // The address lookup's settings in the same JSON (map.addressLookup) and the old sealed values are kept as they are.
  const raw = await rawStored();
  const map = { ...raw, ...next, userCipher: changed.user ? undefined : raw.userCipher, passwordCipher: changed.password ? undefined : raw.passwordCipher } as Stored;
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { map }, create: { id: "global", map } });
  readers.clear();
}

const credentials = (value: Stored) => {
  const pair = opened.get(value);
  return pair?.user && pair.password ? pair : null;
};

/**
 * The map's Geotorget sign-in for the address lookup's "Samma inloggning som kartan" (2026-10-15): one Geotorget
 * account may hold both products. Server only; never sent to the browser. Null when the map has no sign-in.
 */
export async function mapSignIn() {
  return credentials(await stored());
}

/** What the product owner sees: never the user name or the password, only that they are set. */
export async function mapSettingsView() {
  const value = await stored();
  const usage = await cacheUsage();
  return {
    configured: Boolean(value.userCipher && value.passwordCipher), userHint: value.userHint ?? null,
    layer: value.layer ?? "topowebb", capMb: value.capMb ?? DEFAULT_CACHE_MB, zoom: value.zoom ?? null,
    lastCheck: value.lastCheck ?? null, updatedAt: value.updatedAt ?? null, updatedBy: value.updatedBy ?? null,
    cache: usage,
  };
}

/** For every signed-in person: whether there is a map, its zoom range and nothing else. */
export async function mapStatus(): Promise<MapStatus> {
  const value = await stored();
  const enabled = Boolean(value.userCipher && value.passwordCipher && value.lastCheck?.ok);
  return { enabled, layer: value.layer ?? "topowebb", minZoom: value.zoom?.min ?? 5, maxZoom: value.zoom?.max ?? 17 };
}

export async function saveMapSettings(input: { user?: string | null; password?: string | null; layer?: MapLayer; capMb?: number }, actor: CentralActor) {
  const current = await stored();
  const next: Stored = { ...current, updatedAt: new Date().toISOString(), updatedBy: actor.label };
  // The sign-in first (in the key vault too, where the installation has one): when that fails nothing of the save is kept.
  if (input.user !== undefined) { await saveCentralSecret("lantmateriet.mapUser", input.user?.trim() || null, actor); next.userHint = input.user ? `${input.user.trim().slice(0, 2)}…` : undefined; }
  if (input.password !== undefined) await saveCentralSecret("lantmateriet.mapPassword", input.password || null, actor);
  // Removing the sign-in removes the map: nothing is fetched and the viewer disappears.
  if (input.user === null || input.password === null) { next.lastCheck = undefined; next.alertedAt = undefined; }
  if (input.layer) next.layer = input.layer;
  if (input.capMb !== undefined) next.capMb = Math.max(50, Math.min(MAX_CACHE_MB, Math.round(input.capMb)));
  if (input.user !== undefined || input.password !== undefined) next.lastCheck = undefined;
  await save(next, { user: input.user !== undefined, password: input.password !== undefined });
  if (input.capMb !== undefined) await enforceCap(next.capMb ?? DEFAULT_CACHE_MB);
}

// ---------- reading Lantmäteriet's file ----------

class RangeUnsupported extends Error {}
const MAX_PARALLEL = 4;
let running = 0;
const waiting: (() => void)[] = [];
async function limited<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try { return await work(); } finally { running -= 1; waiting.shift()?.(); }
}

function rangeReader(url: string, auth: { user: string; password: string }) {
  const authorization = `Basic ${Buffer.from(`${auth.user}:${auth.password}`).toString("base64")}`;
  return (offset: number, length: number) => limited(async () => {
    const controller = new AbortController();
    const response = await fetch(url, { headers: { authorization, range: `bytes=${offset}-${offset + length - 1}` }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
    if (response.status === 401 || response.status === 403) { controller.abort(); throw new Error("Lantmäteriet godtar inte inloggningen."); }
    // Never the whole file: a server that ignores the range would send 150 GB.
    if (response.status === 200) { controller.abort(); throw new RangeUnsupported("Lantmäteriets server lämnar inte ut delar av filen."); }
    if (response.status !== 206) { controller.abort(); throw new Error(`Lantmäteriet svarade ${response.status}.`); }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > length ? bytes.subarray(0, length) : bytes;
  });
}

/**
 * Loopback QA only (kfid_v3_test, KFID_LOCAL_ROLE_QA): a small GeoPackage generated by the browser test in the test
 * storage stands in for Lantmäteriet's file, so the whole way – check, byte ranges, cache, tile route, attribution – is
 * tested without Lantmäteriet's sign-in. Never on any other installation.
 */
const QA_FILE = path.resolve(env.STORAGE_ROOT, "qa-map", "topowebb-3857.gpkg");
const qaSource = async () => localRoleQaEnabled() && (await stat(QA_FILE).catch(() => null)) ? `file:${QA_FILE}` : null;
function fileReader(file: string) {
  return async (offset: number, length: number) => {
    const handle = await open(file, "r");
    try { const buffer = Buffer.alloc(length); const { bytesRead } = await handle.read(buffer, 0, length, offset); return new Uint8Array(buffer.subarray(0, bytesRead)); } finally { await handle.close(); }
  };
}

const readers = new Map<string, RemoteGeoPackage>();
function geoPackage(url: string, auth: { user: string; password: string }) {
  let reader = readers.get(url);
  if (!reader) { reader = new RemoteGeoPackage(new RemoteSqlite(url.startsWith("file:") ? fileReader(url.slice(5)) : rangeReader(url, auth))); readers.set(url, reader); }
  return reader;
}

/** The file's address for a layer from Lantmäteriet's STAC catalogue (the catalogue itself is open). */
async function sourceUrl(layer: MapLayer): Promise<string> {
  const qa = await qaSource();
  if (qa) return qa;
  const response = await fetch(`${STAC_ITEMS}/${layer}-3857`, { headers: { accept: "application/geo+json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Lantmäteriets katalog svarade ${response.status}.`);
  const item = await response.json() as { assets?: Record<string, { href?: string; type?: string }> };
  const asset = Object.values(item.assets ?? {}).find((entry) => entry.type?.includes("geopackage") || entry.href?.endsWith(".gpkg"));
  if (!asset?.href || !/^https:\/\/[a-z0-9.-]+\.lantmateriet\.se\//.test(asset.href)) throw new Error("Lantmäteriets katalog angav ingen fil för kartan.");
  return asset.href;
}

/**
 * Kontrollera: the sign-in, that the file can be read in parts, and its tile pyramid. Also the nightly key check
 * (keys:alerts) uses it; the result is stored and shown under Servernycklar.
 */
export async function checkMap(): Promise<{ ok: boolean; message: string; at: string }> {
  const value = await stored();
  const auth = credentials(value);
  const at = new Date().toISOString();
  let result: { ok: boolean; message: string; at: string };
  if (!auth) result = { ok: false, message: "Ingen inloggning för Lantmäteriet är inlagd.", at };
  else {
    try {
      const layer = value.layer ?? "topowebb";
      const url = await sourceUrl(layer);
      readers.delete(url);
      const set = await geoPackage(url, auth).tileSet();
      const zooms = set.matrices.map((matrix) => matrix.zoom);
      if (set.srsId !== 3857) throw new Error("Filen är inte i Web Mercator (EPSG:3857).");
      value.sources = { ...value.sources, [layer]: url };
      value.zoom = { min: Math.min(...zooms), max: Math.max(...zooms) };
      result = { ok: true, message: `Lantmäteriet svarar. Kartan finns i nivåerna ${value.zoom.min}–${value.zoom.max}.`, at };
    } catch (cause) {
      result = { ok: false, message: cause instanceof RangeUnsupported ? `${cause.message} Kartan kan inte hämtas utan att hela filen laddas ned (140–175 GB), så den är avstängd.` : (cause as Error).message || "Lantmäteriet svarade inte.", at };
    }
  }
  await save({ ...value, lastCheck: result, ...(result.ok ? { alertedAt: undefined } : {}) });
  return result;
}

/** Whether the last check failed and an alarm is due (keys:alerts sends it, then marks it): once when it fails, then weekly
 *  while it keeps failing (2026-10-26: repeated until fixed). */
export async function mapAlarmDue(now = new Date()) {
  const value = await stored();
  if (!value.userCipher || !value.lastCheck || value.lastCheck.ok) return null;
  if (value.alertedAt && now.getTime() - Date.parse(value.alertedAt) < 7 * 86_400_000) return null;
  return value.lastCheck;
}
export async function markMapAlarmSent() {
  const value = await stored();
  await save({ ...value, alertedAt: new Date().toISOString() });
}

// ---------- the tile cache on our own disk ----------

const tileFile = (layer: MapLayer, z: number, x: number, y: number) => path.join(CACHE_ROOT, layer, String(z), String(x), `${y}.png`);
// A tile Lantmäteriet does not have (sea, outside Sweden) is remembered as an empty file, so it is not asked for again.
const EMPTY = new Uint8Array(0);

/** The tile in the file's own grid for a Web Mercator XYZ tile. */
function gridCell(set: TileSet, z: number, x: number, y: number) {
  const matrix = set.matrices.find((item) => item.width === 2 ** z && Math.abs((set.maxX - set.minX) - 2 * WORLD) < 1);
  if (matrix) return { zoom: matrix.zoom, column: x, row: y };
  // A grid that is not the whole world: place the XYZ tile's corner in it.
  const size = (2 * WORLD) / 2 ** z;
  const candidate = set.matrices.find((item) => Math.abs((set.maxX - set.minX) / item.width - size) < 0.01);
  if (!candidate) return null;
  const column = Math.round((-WORLD + x * size - set.minX) / size);
  const row = Math.round((set.maxY - (WORLD - y * size)) / size);
  return column >= 0 && row >= 0 && column < candidate.width && row < candidate.height ? { zoom: candidate.zoom, column, row } : null;
}

const inFlight = new Map<string, Promise<Uint8Array | null>>();

/** A tile for the map viewer: from our disk, or read once from Lantmäteriet and kept. Null when there is none. */
export async function mapTile(z: number, x: number, y: number): Promise<Uint8Array | null> {
  const value = await stored();
  const layer = (MAP_LAYERS as readonly string[]).includes(value.layer ?? "") ? value.layer as MapLayer : "topowebb";
  const file = tileFile(layer, z, x, y);
  const cached = await readFile(file).catch(() => null);
  if (cached) {
    // Recently used tiles stay when the limit is reached; the date is touched at most once a day.
    stat(file).then((info) => { if (Date.now() - info.mtimeMs > 86_400_000) void utimes(file, new Date(), new Date()).catch(() => undefined); }).catch(() => undefined);
    return cached.length ? new Uint8Array(cached) : null;
  }
  const auth = credentials(value);
  const url = value.sources?.[layer];
  if (!auth || !url || !value.lastCheck?.ok) return null;
  const key = `${layer}/${z}/${x}/${y}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = (async () => {
      const gpkg = geoPackage(url, auth);
      const cell = gridCell(await gpkg.tileSet(), z, x, y);
      const tile = cell ? await gpkg.tile(cell.zoom, cell.column, cell.row) : null;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, tile ?? EMPTY);
      added += tile?.length ?? 0;
      if (added > 32 * 1024 * 1024) { added = 0; void enforceCap(value.capMb ?? DEFAULT_CACHE_MB); }
      return tile;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}
let added = 0;

async function cacheFiles() {
  const files: { file: string; size: number; time: number }[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else { const info = await stat(full).catch(() => null); if (info) files.push({ file: full, size: info.size, time: info.mtimeMs }); }
    }
  };
  await walk(CACHE_ROOT);
  return files;
}

export async function cacheUsage() {
  const files = await cacheFiles();
  return { tiles: files.filter((item) => item.size > 0).length, bytes: files.reduce((sum, item) => sum + item.size, 0) };
}

/** Keeps the cache under the limit: the tiles used longest ago go first, down to 90 % of it. */
export async function enforceCap(capMb: number) {
  const files = await cacheFiles();
  let total = files.reduce((sum, item) => sum + item.size, 0);
  const limit = capMb * 1024 * 1024;
  if (total <= limit) return;
  for (const item of files.sort((a, b) => a.time - b.time)) {
    if (total <= limit * 0.9) break;
    await unlink(item.file).catch(() => undefined);
    total -= item.size;
  }
}

export async function clearMapCache() {
  await rm(CACHE_ROOT, { recursive: true, force: true });
}
