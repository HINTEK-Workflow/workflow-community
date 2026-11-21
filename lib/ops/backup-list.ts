/**
 * Backuplistan (2026-11-14): the list the database server's root writes every hour (Workflow's ops/ folder) into the
 * storage's .host-status/backups.list, read here defensively for Installation → Drift och säkerhet → Serverjobb.
 * Only names, times, sizes and results; the app never changes, removes, restores or downloads a backup. A line of any other
 * shape is left out, and a file that is not a list is no list. Pure, so the tests read the same rules.
 */
export const BACKUP_LIST_FILE = "backups.list";
export const BACKUP_LIST_MAX_BYTES = 256 * 1024;
export const BACKUP_LIST_STALE_HOURS = 3;
export const BACKUP_LIST_MISSING_TEXT = "Listan saknas än – installeras på databasservern.";

export type BackupPart = "db" | "files";
export type BackupKind = "daily" | "weekly" | "predeploy";
export const BACKUP_PARTS: readonly BackupPart[] = ["db", "files"];
export const BACKUP_KINDS: readonly BackupKind[] = ["daily", "weekly", "predeploy"];
export const BACKUP_PART_LABEL: Record<BackupPart, string> = { db: "Databasen", files: "Filerna" };
export const BACKUP_KIND_LABEL: Record<BackupKind, string> = { daily: "Daglig", weekly: "Veckovis", predeploy: "Före släpp" };

export type BackupCopy = { part: BackupPart; kind: BackupKind; name: string; time: string | null; bytes: number | null; verified: string | null; tables: number | null };
export type BackupStatus = { result: string; time: string | null; file: string | null; bytes: number | null; verified: string | null; tables: number | null; step: string | null };
export type BackupKeep = { daily: number | null; weekly: number | null; predeploy: number | null; predeployMaxDays: number | null };
export type BackupList = {
  host: string;
  generatedAt: string;
  disk: { usedPercent: number | null; freeBytes: number | null };
  keep: Record<BackupPart, BackupKeep>;
  totals: Record<BackupPart, Record<BackupKind, { count: number; bytes: number }>>;
  status: { "db.daily": BackupStatus | null; "db.predeploy": BackupStatus | null; "files.daily": BackupStatus | null; "files.predeploy": BackupStatus | null; offsite: BackupStatus | null };
  offsite: { configured: boolean; pruneDays: number | null };
  copies: BackupCopy[];
};

const NAME = /^[A-Za-z0-9._-]{1,160}$/;
const WORD = /^[a-z_-]{1,30}$/;
const iso = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null);
const int = (value: string | undefined) => (value && /^\d{1,18}$/.test(value) ? Number(value) : null);
const MAX_COPIES = 200;

/** The file's text as a list, or null when it is not one (no schema 1, no host or time, too large). */
export function parseBackupList(raw: string): BackupList | null {
  if (raw.length > BACKUP_LIST_MAX_BYTES) return null;
  const values = new Map<string, string>();
  const files: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at < 1) continue;
    const key = line.slice(0, at), value = line.slice(at + 1);
    if (key === "file") { if (files.length < MAX_COPIES) files.push(value); }
    else if (/^[a-z_.]{1,60}$/.test(key) && !values.has(key)) values.set(key, value);
  }
  const host = values.get("host") ?? "";
  const generatedAt = iso(values.get("generated"));
  if (values.get("schema") !== "1" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(host) || !generatedAt) return null;
  const status = (prefix: string): BackupStatus | null => {
    const result = values.get(`status.${prefix}.result`);
    if (!result || !WORD.test(result) || result === "missing") return null;
    const file = values.get(`status.${prefix}.file`);
    const verified = values.get(`status.${prefix}.verified`);
    const step = values.get(`status.${prefix}.step`);
    return {
      result, time: iso(values.get(`status.${prefix}.time`)), file: file && NAME.test(file) ? file : null, bytes: int(values.get(`status.${prefix}.bytes`)),
      verified: verified && WORD.test(verified) ? verified : null, tables: int(values.get(`status.${prefix}.tables`)), step: step && WORD.test(step) ? step.replaceAll("_", " ") : null,
    };
  };
  const statuses = { "db.daily": status("db.daily"), "db.predeploy": status("db.predeploy"), "files.daily": status("files.daily"), "files.predeploy": status("files.predeploy"), offsite: status("offsite") };
  const keep = (part: BackupPart): BackupKeep => ({
    daily: int(values.get(`keep.${part}.daily`)), weekly: int(values.get(`keep.${part}.weekly`)), predeploy: int(values.get(`keep.${part}.predeploy`)), predeployMaxDays: int(values.get(`keep.${part}.predeploy_max_days`)),
  });
  const totals = Object.fromEntries(BACKUP_PARTS.map((part) => [part, Object.fromEntries(BACKUP_KINDS.map((kind) => [kind, {
    count: int(values.get(`total.${part}.${kind}.count`)) ?? 0, bytes: int(values.get(`total.${part}.${kind}.bytes`)) ?? 0,
  }]))])) as BackupList["totals"];
  const copies: BackupCopy[] = [];
  for (const value of files) {
    const [part, kind, name, time, bytes, ...rest] = value.split("|");
    if (rest.length || !BACKUP_PARTS.includes(part as BackupPart) || !BACKUP_KINDS.includes(kind as BackupKind) || !NAME.test(name ?? "")) continue;
    // Read back: the database script keeps a copy only after pg_restore read it, and its status names the newest and its tables.
    const newest = part === "db" ? (kind === "predeploy" ? statuses["db.predeploy"] : statuses["db.daily"]) : null;
    const known = newest && newest.file === name && newest.result === "ok" ? newest : null;
    copies.push({ part: part as BackupPart, kind: kind as BackupKind, name, time: iso(time), bytes: int(bytes), verified: known?.verified ?? null, tables: known?.tables ?? null });
  }
  copies.sort((a, b) => BACKUP_PARTS.indexOf(a.part) - BACKUP_PARTS.indexOf(b.part) || BACKUP_KINDS.indexOf(a.kind) - BACKUP_KINDS.indexOf(b.kind) || (b.time ?? "").localeCompare(a.time ?? ""));
  const used = int(values.get("disk.used_percent"));
  return {
    host, generatedAt,
    disk: { usedPercent: used !== null && used <= 100 ? used : null, freeBytes: int(values.get("disk.free_bytes")) },
    keep: { db: keep("db"), files: keep("files") }, totals, status: statuses,
    offsite: { configured: values.get("offsite.configured") === "1", pruneDays: int(values.get("offsite.prune_days")) },
    copies,
  };
}

/** "Sparas: 14 dagliga, 8 veckovisa, 5 före släpp (högst 90 dagar)". */
export function keepText(keep: BackupKeep): string {
  const parts = [keep.daily !== null ? `${keep.daily} dagliga` : null, keep.weekly !== null ? `${keep.weekly} veckovisa` : null, keep.predeploy !== null ? `${keep.predeploy} före släpp` : null].filter(Boolean);
  if (!parts.length) return "Sparas: okänt";
  return `Sparas: ${parts.join(", ")}${keep.predeployMaxDays ? ` (högst ${keep.predeployMaxDays} dagar)` : ""}`;
}

export function offsiteKeepText(offsite: BackupList["offsite"]): string {
  if (!offsite.configured) return "Extern kopia: inte inställd på databasservern.";
  return offsite.pruneDays ? `Extern kopia: rensas efter ${offsite.pruneDays} dagar.` : "Extern kopia: rensas av lagringsplatsen själv (ingen egen gräns satt).";
}

/** "1,2 GB", "340 kB". */
export function bytesText(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "–";
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = bytes, unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit += 1; }
  return `${unit === 0 ? value : value.toFixed(value >= 100 ? 0 : 1).replace(".", ",")} ${units[unit]}`;
}

/** Hours since the time (rounded down), or null. */
export function ageHours(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 3_600_000));
}
