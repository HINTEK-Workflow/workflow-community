import { z } from "zod";
import {
  normalizeControl,
  RULE_VERSION,
  sectionKeys,
  type ControlData,
} from "@/lib/kfid/model";

export const PORTABLE_FORMAT = "KFID_CONTROL";
export const PORTABLE_SCHEMA_VERSION = 1;
export const MAX_PORTABLE_JSON_BYTES = 2_000_000;
/** A control's JSON file handed over from the Import page to the control editor (2026-10-02), in sessionStorage. */
export const PENDING_CONTROL_IMPORT_KEY = "hintek.import.control-json";

export type PortableControlExport = {
  format: typeof PORTABLE_FORMAT;
  schemaVersion: typeof PORTABLE_SCHEMA_VERSION;
  ruleVersion: string;
  exportedAt: string;
  data: ControlData;
};

export type PortableControlPreview = {
  data: ControlData;
  source: "KFID V3" | "Äldre/V1-format";
  schemaVersion: number | null;
  ruleVersion: string | null;
  project: string;
  rowCount: number;
  ignored: string[];
  warnings: string[];
};

export function createPortableControlExport(
  input: unknown,
  exportedAt = new Date(),
): PortableControlExport {
  return {
    format: PORTABLE_FORMAT,
    schemaVersion: PORTABLE_SCHEMA_VERSION,
    ruleVersion: RULE_VERSION,
    exportedAt: exportedAt.toISOString(),
    data: normalizeControl(input),
  };
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function ignoredFields(
  root: Record<string, unknown>,
  data: Record<string, unknown>,
  envelope: boolean,
  legacyWrapped: boolean,
) {
  const ignored = new Set<string>();
  const allowedRoot = envelope
    ? new Set(["format", "schemaVersion", "ruleVersion", "exportedAt", "data"])
    : legacyWrapped
      ? new Set(["data"])
      : new Set(["meta", "active", "iso", "cont", "volt", "rcd", "vis"]);
  for (const key of Object.keys(root)) {
    if (!allowedRoot.has(key)) ignored.add(`Toppfältet ”${key}”`);
  }

  const meta = record(data.meta);
  const allowedMeta = new Set([
    "proj",
    "perf",
    "ctrl",
    "client",
    "addr",
    "date",
    "instr",
    "sn",
    "cal",
    "autoOn",
    "name",
  ]);
  if (meta) {
    for (const key of Object.keys(meta)) {
      if (!allowedMeta.has(key)) ignored.add(`Grunduppgiften ”meta.${key}”`);
    }
    if ("customer_id" in meta)
      ignored.add("Kundkoppling från ursprungssystemet");
  }

  const visual = record(data.vis);
  if (visual) {
    for (const key of ["images", "documents", "image_tags", "attachments"])
      if (key in visual) ignored.add("Bilagereferenser från JSON-filen");
  }
  for (const key of ["customerId", "organizationId", "attachments", "files"])
    if (key in root)
      ignored.add(
        key === "customerId"
          ? "Kundkoppling från ursprungssystemet"
          : key === "organizationId"
            ? "Företagskoppling från ursprungssystemet"
            : "Bilagereferenser från JSON-filen",
      );
  return [...ignored];
}

export function parsePortableControl(
  input: unknown,
): PortableControlPreview {
  const root = record(input);
  if (!root) throw new Error("JSON-filen måste innehålla ett kontrollobjekt.");

  const envelope = "format" in root || "schemaVersion" in root;
  let legacyWrapped = false;
  let rawData: unknown;
  let schemaVersion: number | null = null;
  let ruleVersion: string | null = null;
  if (envelope) {
    const header = z
      .object({
        format: z.literal(PORTABLE_FORMAT),
        schemaVersion: z.number().int().positive(),
        ruleVersion: z.string().min(1).max(100),
        data: z.unknown(),
      })
      .passthrough()
      .safeParse(root);
    if (!header.success)
      throw new Error("Filen har inte ett giltigt KFID-exporthuvud.");
    if (header.data.schemaVersion > PORTABLE_SCHEMA_VERSION)
      throw new Error(
        `Filen använder schema ${header.data.schemaVersion}. Den här versionen av KFID stöder högst schema ${PORTABLE_SCHEMA_VERSION}.`,
      );
    if (header.data.schemaVersion !== PORTABLE_SCHEMA_VERSION)
      throw new Error(`Schema ${header.data.schemaVersion} stöds inte.`);
    schemaVersion = header.data.schemaVersion;
    ruleVersion = header.data.ruleVersion;
    rawData = header.data.data;
  } else {
    // Older KFID/V1 files were either raw control data or wrapped in { data }.
    const wrapped = record(root.data);
    legacyWrapped = Boolean(wrapped && record(wrapped.meta));
    rawData = legacyWrapped ? wrapped : root;
  }

  const rawRecord = record(rawData);
  if (!rawRecord)
    throw new Error("JSON-filen saknar kontrollens formulärdata.");
  const data = normalizeControl(rawRecord);
  const ignored = ignoredFields(root, rawRecord, envelope, legacyWrapped);
  const warnings: string[] = [];
  if (!envelope)
    warnings.push(
      "Äldre format saknar schema- och regelversion. Kontrollera mätvärdena före sparande.",
    );
  if (ruleVersion && ruleVersion !== RULE_VERSION)
    warnings.push(
      `Filen bedömdes med ${ruleVersion}; KFID använder nu ${RULE_VERSION}. Resultaten räknas om med aktuell profil.`,
    );
  if (ignored.some((item) => item.includes("Kundkoppling")))
    warnings.push("Välj kund på nytt i det aktuella företaget.");
  warnings.push("Bilder och dokument importeras aldrig från JSON och läggs till separat.");

  return {
    data,
    source: envelope ? "KFID V3" : "Äldre/V1-format",
    schemaVersion,
    ruleVersion,
    project: data.meta.proj,
    rowCount: sectionKeys.reduce(
      (total, section) => total + data[section].rows.length,
      0,
    ),
    ignored,
    warnings,
  };
}

export function parsePortableControlJson(text: string) {
  if (new TextEncoder().encode(text).byteLength > MAX_PORTABLE_JSON_BYTES)
    throw new Error("JSON-filen är för stor. Maximal storlek är 2 MB.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Filen innehåller inte giltig JSON.");
  }
  try {
    return parsePortableControl(parsed);
  } catch (error) {
    // A schema error is a list of technical issues; the person gets one readable sentence (2026-10-02).
    if (error && typeof error === "object" && "issues" in error)
      throw new Error("Filen är inte en giltig kontrollfil: uppgifter saknas eller har fel form.");
    throw error;
  }
}
