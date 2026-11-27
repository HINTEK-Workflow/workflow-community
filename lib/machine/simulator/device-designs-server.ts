import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { DEVICE_KINDS, isDeviceKind } from "./surface/devices";
import { deviceDesignSchema, functionTerminals, isCustomKey, isDesignKey, parseDeviceFile, standardDesign, validateDesign, type DeviceDesign, type ImportedDevice, type PublishedDesign } from "./surface/device-designs";

/**
 * PLC-apparater on the server (2026-11-06): the product owner's device designs in the table PlcDeviceDesign, product-wide
 * (every simulator, the demo's too, draws with the published ones). A save writes the draft; Publicera makes it the one in use;
 * Återställ removes the row (a standard device goes back to the simulator's own look, a copy disappears from the palette, and a
 * placed copy falls back to its function's drawing). Read with parameterised SQL like PdfTemplateOverride; a database without the
 * table reads as "no designs". Every change: the revision the editor read (optimistic concurrency) and an audit event naming the
 * device, never the picture.
 */
type Row = { key: string; draft: unknown; published: unknown; revision: number; publishedAt: Date | null; updatedAt: Date };
export type Actor = { userId: string; organizationId: string };

const missingTable = (error: unknown) => /PlcDeviceDesign/.test(String((error as { message?: string })?.message ?? "")) && /does not exist|42P01/.test(String((error as { message?: string; code?: string })?.message ?? "") + String((error as { code?: string })?.code ?? ""));
const parseDesign = (value: unknown): DeviceDesign | null => { const parsed = deviceDesignSchema.safeParse(value); return parsed.success ? parsed.data : null; };

async function rows(): Promise<Row[]> {
  try {
    return await prisma.$queryRaw<Row[]>`SELECT "key", "draft", "published", "revision", "publishedAt", "updatedAt" FROM "PlcDeviceDesign" ORDER BY "key"`;
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

const CACHE_MS = 30_000;

/**
 * The standard library (2026-11-09: "Släpp dessa som de nya versionen och skriv över de gamla alltså är dessa som gäller"): the
 * device pictures built from his front-view originals ship with the release in data/plc-apparater/standard.json. The first read after a
 * release with a new library version publishes every device in it over what was there (its draft too); a device without a picture of
 * its own goes back to the simulator's drawing. A marker row remembers the version, so it happens once per library, not per start.
 * Copies made in the editor are left alone. The Community edition has no such file and nothing happens.
 */
const LIBRARY_FILE = path.join(process.cwd(), "data", "plc-apparater", "standard.json");
const LIBRARY_MARKER = "__standardbibliotek";

type Library = { version: string; devices: ImportedDevice[]; byKey: Map<string, DeviceDesign> };
let library: Library | null | undefined;
/** The shipped library, read once per process (it changes only with a release). Null in Community or without a version. */
export function standardLibrary(): Library | null {
  if (library !== undefined) return library;
  library = null;
  if (!existsSync(LIBRARY_FILE)) return library;
  const { libraryVersion: version, ...file } = JSON.parse(readFileSync(LIBRARY_FILE, "utf8")) as Record<string, unknown> & { libraryVersion?: string };
  if (!version) return library;
  const parsed = parseDeviceFile(JSON.stringify(file));
  if (!parsed.ok) throw new Error(parsed.errors.join(" | "));
  const devices = parsed.devices.filter((device) => device.key && isDesignKey(device.key));
  library = { version, devices, byKey: new Map(devices.flatMap((device) => (device.design.image ? [[device.key!, device.design] as const] : []))) };
  return library;
}
/** The library's design of a device: its standard look (2026-11-09: "Dessa ska vara originalbilderna"). */
export const libraryDesign = (key: string): DeviceDesign | null => standardLibrary()?.byKey.get(key) ?? null;

/** JSON with sorted keys: a design read back from jsonb compares equal to the same design from the file. */
const canonical = (value: unknown): string => (Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(value));
export const sameDesign = (a: DeviceDesign | null, b: DeviceDesign | null) => Boolean(a && b && canonical(a) === canonical(b));

/**
 * The marker is checked at most once per cache period (2026-11-09): a table emptied under a running server (a test, a restore) gets the
 * library back within 30 s instead of after a restart. The check itself is one small SELECT.
 */
let libraryCheck: { at: number; done: Promise<void> } | null = null;
export const ensureStandardLibrary = () => {
  if (!libraryCheck || Date.now() - libraryCheck.at >= CACHE_MS) libraryCheck = { at: Date.now(), done: applyStandardLibrary().catch((error) => { console.error("PLC-apparater: standardbiblioteket kunde inte läggas in", error); }) };
  return libraryCheck.done;
};
/** Tests: the next read checks the marker again at once. */
export const recheckStandardLibrary = () => { libraryCheck = null; };
async function applyStandardLibrary() {
  const lib = standardLibrary();
  if (!lib) return;
  const version = lib.version;
  let marker: { draft: unknown }[];
  try { marker = await prisma.$queryRaw<{ draft: unknown }[]>`SELECT "draft" FROM "PlcDeviceDesign" WHERE "key" = ${LIBRARY_MARKER}`; } catch (error) { if (missingTable(error)) return; throw error; }
  if ((marker[0]?.draft as { version?: string } | null)?.version === version) return;
  const parsed = { devices: lib.devices };
  for (const device of parsed.devices) {
    if (!device.key || !isDesignKey(device.key)) continue;
    if (!device.design.image && isDeviceKind(device.key)) { await prisma.$executeRaw`DELETE FROM "PlcDeviceDesign" WHERE "key" = ${device.key}`; continue; }
    const json = JSON.stringify(device.design);
    await prisma.$executeRaw`INSERT INTO "PlcDeviceDesign" ("key", "published", "draft", "revision", "publishedAt", "createdAt", "updatedAt") VALUES (${device.key}, ${json}::jsonb, NULL, 1, NOW(), NOW(), NOW())
      ON CONFLICT ("key") DO UPDATE SET "published" = EXCLUDED."published", "draft" = NULL, "revision" = "PlcDeviceDesign"."revision" + 1, "publishedAt" = NOW(), "updatedAt" = NOW()`;
  }
  const stamp = JSON.stringify({ version });
  await prisma.$executeRaw`INSERT INTO "PlcDeviceDesign" ("key", "draft", "revision", "createdAt", "updatedAt") VALUES (${LIBRARY_MARKER}, ${stamp}::jsonb, 1, NOW(), NOW()) ON CONFLICT ("key") DO UPDATE SET "draft" = EXCLUDED."draft", "updatedAt" = NOW()`;
  cache = null;
  console.info(`PLC-apparater: standardbiblioteket ${version} är publicerat (${parsed.devices.length} apparater).`);
}

let cache: { at: number; designs: readonly PublishedDesign[] } | null = null;
export const clearDeviceDesignCache = () => { cache = null; };

/** What every simulator draws with: the published designs only. A failing read gives the simulator's own devices. */
export async function publishedDeviceDesigns(): Promise<readonly PublishedDesign[]> {
  await ensureStandardLibrary();
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.designs;
  try {
    const designs = (await rows()).flatMap((row) => { const design = isDesignKey(row.key) ? parseDesign(row.published) : null; return design ? [{ key: row.key, design }] : []; });
    cache = { at: Date.now(), designs };
    return designs;
  } catch {
    return [];
  }
}

export type DeviceEditorItem = {
  key: string; standard: boolean;
  /** The device ships in the standard library: its library design is its standard, and Återställ goes back to it. */
  library: boolean;
  /** What is published is the library's design, untouched (shown as "Standard", not as changed). */
  original: boolean;
  /** What the simulator draws today: the published design, else the standard one (a copy always has one of the two). */
  published: DeviceDesign | null;
  draft: DeviceDesign | null;
  standardDesign: DeviceDesign | null;
  revision: number; publishedAt: string | null; updatedAt: string | null;
};

/** The editor's list: every standard device (with its design, if any) and then the copies. */
export async function deviceEditorView(): Promise<{ items: DeviceEditorItem[] }> {
  await ensureStandardLibrary();
  const byKey = new Map((await rows()).map((row) => [row.key, row]));
  const item = (key: string): DeviceEditorItem => {
    const row = byKey.get(key);
    const standard = isDeviceKind(key);
    const own = libraryDesign(key);
    const published = row ? parseDesign(row.published) : null;
    return {
      key, standard, library: own !== null, original: own !== null && sameDesign(published, own), published, draft: row ? parseDesign(row.draft) : null,
      standardDesign: own ?? (standard ? standardDesign(key) : null), revision: row?.revision ?? 0,
      publishedAt: row?.publishedAt?.toISOString() ?? null, updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  };
  const copies = [...byKey.keys()].filter(isCustomKey).sort();
  return { items: [...DEVICE_KINDS.map(item), ...copies.map(item)] };
}

async function audit(actor: Actor, action: string, detail: string) {
  await prisma.administrationEvent.create({ data: { actorId: actor.userId, organizationId: actor.organizationId, action, detail: detail.slice(0, 500) } });
}

function checked(key: string, raw: unknown): DeviceDesign {
  const result = validateDesign(key, raw);
  if (!result.ok) throw new ApiError(400, result.reason);
  return result.design;
}

/** Spara som utkast: the draft only; what the simulators draw is unchanged until Publicera. */
export async function saveDeviceDraft(actor: Actor, key: string, revision: number, raw: unknown) {
  if (!isDesignKey(key)) throw new ApiError(404, "Apparaten finns inte.");
  const design = checked(key, raw);
  const json = JSON.stringify(design);
  const changed = revision === 0
    ? await prisma.$executeRaw`INSERT INTO "PlcDeviceDesign" ("key", "draft", "revision", "updatedById", "createdAt", "updatedAt") VALUES (${key}, ${json}::jsonb, 1, ${actor.userId}, NOW(), NOW()) ON CONFLICT ("key") DO NOTHING`
    : await prisma.$executeRaw`UPDATE "PlcDeviceDesign" SET "draft" = ${json}::jsonb, "revision" = "revision" + 1, "updatedById" = ${actor.userId}, "updatedAt" = NOW() WHERE "key" = ${key} AND "revision" = ${revision}`;
  if (!changed) throw new ApiError(409, "Apparaten har ändrats sedan du öppnade den. Ladda om och gör om ändringen.");
  await audit(actor, "plc_device_save", `PLC-apparat ${key} (${design.label}): utkast sparat.`);
  return deviceEditorView();
}

/** Publicera: the draft becomes what every simulator draws with. */
export async function publishDevice(actor: Actor, key: string, revision: number) {
  const changed = await prisma.$executeRaw`UPDATE "PlcDeviceDesign" SET "published" = "draft", "draft" = NULL, "revision" = "revision" + 1, "publishedById" = ${actor.userId}, "publishedAt" = NOW(), "updatedAt" = NOW()
    WHERE "key" = ${key} AND "revision" = ${revision} AND "draft" IS NOT NULL`;
  if (!changed) throw new ApiError(409, "Det finns inget utkast att publicera, eller så har apparaten ändrats. Ladda om sidan.");
  clearDeviceDesignCache();
  await audit(actor, "plc_device_publish", `PLC-apparat ${key}: publicerad.`);
  return deviceEditorView();
}

/**
 * Återställ till standard or Ta bort (a copy): a device in the standard library goes back to the library's design, published, without a
 * draft (2026-11-09: "Dessa ska vara originalbilderna"); any other standard device loses its row and is drawn as the simulator's
 * own; a copy of one's own disappears.
 */
export async function resetDevice(actor: Actor, key: string, revision: number) {
  if (!isDesignKey(key)) throw new ApiError(404, "Apparaten finns inte.");
  const own = libraryDesign(key);
  const json = own ? JSON.stringify(own) : "";
  const changed = !own
    ? await prisma.$executeRaw`DELETE FROM "PlcDeviceDesign" WHERE "key" = ${key} AND "revision" = ${revision}`
    : revision === 0
      ? await prisma.$executeRaw`INSERT INTO "PlcDeviceDesign" ("key", "published", "revision", "publishedById", "publishedAt", "createdAt", "updatedAt") VALUES (${key}, ${json}::jsonb, 1, ${actor.userId}, NOW(), NOW(), NOW()) ON CONFLICT ("key") DO NOTHING`
      : await prisma.$executeRaw`UPDATE "PlcDeviceDesign" SET "published" = ${json}::jsonb, "draft" = NULL, "revision" = "revision" + 1, "publishedById" = ${actor.userId}, "publishedAt" = NOW(), "updatedAt" = NOW() WHERE "key" = ${key} AND "revision" = ${revision}`;
  if (!changed) throw new ApiError(409, "Apparaten har ändrats sedan du öppnade den. Ladda om sidan.");
  clearDeviceDesignCache();
  const removed = isCustomKey(key) && !own;
  await audit(actor, removed ? "plc_device_remove" : "plc_device_reset", `PLC-apparat ${key}: ${removed ? "borttagen" : "återställd till standard"}.`);
  return deviceEditorView();
}

const newKey = () => `egen-${randomBytes(5).toString("hex").slice(0, 8)}`;

async function insertDraft(actor: Actor, design: DeviceDesign) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const key = newKey();
    const changed = await prisma.$executeRaw`INSERT INTO "PlcDeviceDesign" ("key", "draft", "revision", "updatedById", "createdAt", "updatedAt") VALUES (${key}, ${JSON.stringify(design)}::jsonb, 1, ${actor.userId}, NOW(), NOW()) ON CONFLICT ("key") DO NOTHING`;
    if (changed) return key;
  }
  throw new ApiError(500, "Apparaten kunde inte skapas. Försök igen.");
}

/** Kopiera som ny apparat: a draft copy with its own key, optionally with another function (then the function's terminals). */
export async function copyDevice(actor: Actor, from: DeviceDesign, fn: string | null) {
  const changeTo = fn && (DEVICE_KINDS as readonly string[]).includes(fn) ? (fn as DeviceDesign["function"]) : from.function;
  const base = { ...from, name: `${from.name} (kopia)`.slice(0, 24), label: `${from.label} (kopia)`.slice(0, 60), hidden: false };
  const design = checked("egen-copy000", changeTo === from.function ? base : { ...base, function: changeTo, terminals: functionTerminals(changeTo) });
  const key = await insertDraft(actor, design);
  await audit(actor, "plc_device_copy", `PLC-apparat ${key} (${design.label}): skapad som kopia.`);
  return { key, view: await deviceEditorView() };
}

/** Import: each device becomes a draft – over an existing device ("replace") or as a new copy ("new"); never published directly. */
export async function importDevices(actor: Actor, devices: readonly (ImportedDevice & { mode: "replace" | "new" })[]) {
  const existing = new Map((await rows()).map((row) => [row.key, row.revision]));
  const keys: string[] = [];
  for (const device of devices) {
    if (device.mode === "replace" && device.key && isDesignKey(device.key)) {
      const design = checked(device.key, device.design);
      const json = JSON.stringify(design);
      if (existing.has(device.key)) await prisma.$executeRaw`UPDATE "PlcDeviceDesign" SET "draft" = ${json}::jsonb, "revision" = "revision" + 1, "updatedById" = ${actor.userId}, "updatedAt" = NOW() WHERE "key" = ${device.key}`;
      else await prisma.$executeRaw`INSERT INTO "PlcDeviceDesign" ("key", "draft", "revision", "updatedById", "createdAt", "updatedAt") VALUES (${device.key}, ${json}::jsonb, 1, ${actor.userId}, NOW(), NOW()) ON CONFLICT ("key") DO UPDATE SET "draft" = EXCLUDED."draft", "revision" = "PlcDeviceDesign"."revision" + 1, "updatedAt" = NOW()`;
      keys.push(device.key);
    } else {
      keys.push(await insertDraft(actor, checked("egen-import0", device.design)));
    }
  }
  await audit(actor, "plc_device_import", `PLC-apparater importerade som utkast: ${keys.join(", ")}.`.slice(0, 500));
  return { keys, view: await deviceEditorView() };
}

/** Ny apparat: a draft of its own from a function's standard device, with the name the person gave (2026-11-07). */
export async function createDevice(actor: Actor, fn: string, name: string) {
  if (!isDeviceKind(fn)) throw new ApiError(400, "Välj en funktion.");
  const base = standardDesign(fn);
  const label = name.trim().slice(0, 60) || `Ny ${base.label.toLowerCase()}`;
  const design = checked("egen-create0", { ...base, name: label.slice(0, 24), label });
  const key = await insertDraft(actor, design);
  await audit(actor, "plc_device_create", `PLC-apparat ${key} (${design.label}): skapad.`);
  return { key, view: await deviceEditorView() };
}
