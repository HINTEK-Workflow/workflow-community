import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { read } from "@/lib/kfid/storage";
import { safeZipEntryName, ZipWriter } from "@/lib/kfid/zip-writer";
import { cloudExportPages, type CloudExportZip } from "@/lib/kfid/cloud-export";
import { EXPORT_REGISTER, SECRET_COLUMN, type ArchiveTable } from "@/lib/kfid/cloud-export-registry";

/**
 * The company archive (2026-11-04): everything the company owns that the .hwf file cannot carry yet – purchases, absence,
 * time periods, payroll settings, maintenance, store, machine sources with their events and signals, the operator page, the
 * staff register, forms, controls, the report archive and the administration history. The list of tables and the reason for
 * each exclusion is lib/kfid/cloud-export-registry.ts, and a test keeps it complete.
 *
 * Each table is read page by page with the company's id in every query and sent as it is written, so the server never holds a
 * large company in memory (one page and one file at a time). Every column of the table follows (read from the Prisma model, so
 * a column added later follows too) except the secret ones (sealed, hash, token, password, key material). Stored files are
 * read and sent one by one. Local cannot read this file yet: it is a readable, versioned copy, not a file to import.
 */
export const ARCHIVE_FORMAT = "HWF_COMPANY_ARCHIVE";
export const ARCHIVE_SCHEMA_VERSION = 1;
const DEFAULT_PAGE = 500;
/** Tables whose rows carry large documents get smaller pages. */
const PAGE_SIZES: Record<string, number> = { Control: 50, ControlRevision: 50, FormTemplate: 50, FormTemplateVersion: 50, GeneratedResult: 100, MachineFormatProfile: 100, MachineEvent: 1000, MachineDaySummary: 1000, StoreTransaction: 1000 };

export const archivePartName = (folder: string, part: number) => `${folder}/del-${String(part).padStart(4, "0")}.json`;

/** A stored file's place in the zip file: the row's id and the file name cut down to safe characters. */
export function archiveFileName(folder: string, id: string, filename: string) {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^[._-]+/, "").replace(/\.{2,}/g, ".").slice(-100);
  return safeZipEntryName(`${folder}/filer/${id.replace(/[^A-Za-z0-9]/g, "") || "x"}-${safe || "fil"}`);
}

type Row = Record<string, unknown>;
type Delegate = { findMany(args: Record<string, unknown>): Promise<Row[]> };
const delegateOf = (model: string) => (prisma as unknown as Record<string, Delegate>)[model.charAt(0).toLowerCase() + model.slice(1)];

/** The tables of the archive in the order they are written. */
export function archiveTables() {
  return Object.entries(EXPORT_REGISTER).flatMap(([model, entry]) => entry.status === "archive" ? [{ model, entry }] : []);
}

/** The columns of a table that go into the archive: all scalar columns except the secret and the left-out ones. */
export function archiveColumns(model: string, entry: ArchiveTable) {
  const found = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === model);
  if (!found) throw new Error(`Unknown model ${model}`);
  return found.fields
    .filter((field) => field.kind === "scalar" || field.kind === "enum")
    .map((field) => field.name)
    .filter((name) => !entry.omit?.includes(name) && (!SECRET_COLUMN.test(name) || entry.keep?.includes(name)));
}

const hasId = (model: string) => Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === model)?.fields.some((field) => field.name === "id") ?? false;

/** One table's rows, a page at a time, only this company's. */
export async function* archiveRows(organizationId: string, model: string, entry: ArchiveTable): AsyncGenerator<Row[]> {
  const delegate = delegateOf(model);
  const where = entry.where ? entry.where(organizationId) : { organizationId };
  const select = Object.fromEntries(archiveColumns(model, entry).map((name) => [name, true]));
  if (model === "OrganizationMember") {
    // The person's name and e-mail join the membership, so userId in the other tables can be read.
    Object.assign(select, { user: { select: { name: true, email: true } } });
  }
  const size = PAGE_SIZES[model] ?? DEFAULT_PAGE;
  if (!hasId(model)) {
    // The few tables without an id (one row per company, or a link table) are small.
    yield await delegate.findMany({ where, select });
    return;
  }
  for await (const page of cloudExportPages((args) => delegate.findMany({ where, select, orderBy: { id: "asc" }, ...args }) as Promise<(Row & { id: string })[]>, size)) {
    yield model === "OrganizationMember"
      ? page.map(({ user, ...member }) => ({ ...member, name: (user as { name: string | null } | null)?.name ?? null, email: (user as { email: string } | null)?.email ?? null }))
      : page;
  }
}

const bigint = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);

const running = new Set<string>();

type TableSummary = { folder: string; count: number; parts: string[]; columns: string[]; files: number; missingFiles: number };

async function* archiveChunks(source: { organizationId: string; organizationName: string }, exportedAt: string, release: () => void): AsyncGenerator<Uint8Array> {
  try {
    const zip = new ZipWriter({ date: new Date(exportedAt) });
    const encoder = new TextEncoder();
    const json = (name: string, value: unknown) => zip.file(name, encoder.encode(JSON.stringify(value, bigint)), { compress: true });
    const tables: Record<string, TableSummary> = {};
    for (const { model, entry } of archiveTables()) {
      const summary: TableSummary = { folder: entry.folder, count: 0, parts: [], columns: archiveColumns(model, entry), files: 0, missingFiles: 0 };
      tables[model] = summary;
      for await (const rows of archiveRows(source.organizationId, model, entry)) {
        if (!rows.length) continue;
        let records: Row[] = rows;
        if (entry.files) {
          // Each stored file is read, checked against its recorded size and sent on its own; a file that is gone is counted, not fatal.
          records = [];
          for (const row of rows) {
            const path = typeof row.storagePath === "string" ? row.storagePath : null;
            if (!path) { records.push(row); continue; }
            const name = archiveFileName(entry.folder, String(row.id), String(row.filename ?? ""));
            try {
              const bytes = new Uint8Array(await read(path));
              if (typeof row.size === "number" && bytes.byteLength !== row.size) throw new Error("size");
              yield* zip.file(name, bytes, { compress: false });
              records.push({ ...row, file: { path: name, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") } });
              summary.files += 1;
            } catch {
              records.push({ ...row, file: null });
              summary.missingFiles += 1;
            }
          }
        }
        const part = archivePartName(entry.folder, summary.parts.length + 1);
        summary.parts.push(part);
        summary.count += records.length;
        yield* json(part, { format: "HWF_COMPANY_ARCHIVE_PART", schemaVersion: ARCHIVE_SCHEMA_VERSION, table: model, part: summary.parts.length, records });
      }
    }
    const register = Object.entries(EXPORT_REGISTER);
    yield* json("innehall.json", {
      format: ARCHIVE_FORMAT, schemaVersion: ARCHIVE_SCHEMA_VERSION, exportedAt, organization: source.organizationName, tables,
      // Where the rest of the company's data is, and what is left out on purpose.
      inCloudCopy: register.filter(([, entry]) => entry.status === "hwf").map(([model]) => model),
      inSalesFile: register.filter(([, entry]) => entry.status === "sales").map(([model]) => model),
      notExported: Object.fromEntries(register.flatMap(([model, entry]) => entry.status === "excluded" ? [[model, entry.reason]] : [])),
    });
    yield* zip.file("LASMIG.txt", encoder.encode([
      "Företagsarkiv",
      "",
      `Skapad ${exportedAt}.`,
      "Här finns det som Cloud-kopian (.hwf) inte kan rymma än: inköp, frånvaro, tidperioder, lönesystemets inställningar, underhåll, lager,",
      "maskinkällor med händelser och signaler, operatörssidan, personalliggaren, formulär, kontroller, rapportarkivet och administrationshistoriken.",
      "innehall.json listar varje tabell med antal, delar och kolumner, och vilka tabeller som ligger med serverlagring-kopian, i offertfilen eller inte exporteras.",
      "Varje del är JSON. Personer står med id; mappen personer kopplar id till namn och e-post.",
      "Personnummer i personalliggaren och fakturorna står bara maskerade. Nycklar, lösenord och hemliga värden exporteras aldrig.",
      "Bilder och filer ligger i mapparna filer. Filen kan inte läsas in i Local ännu.",
      "",
    ].join("\r\n")), { compress: true });
    yield zip.finish();
  } finally {
    release();
  }
}

/** One archive at a time per company; the bytes are made as they are read, so a large company stays out of memory. */
export function prepareArchiveZip(source: { organizationId: string; organizationName: string }): CloudExportZip {
  if (running.has(source.organizationId)) throw new ApiError(429, "En export pågår redan för företaget. Försök igen när den är klar.");
  running.add(source.organizationId);
  const exportedAt = new Date().toISOString();
  const release = () => { running.delete(source.organizationId); };
  return { chunks: archiveChunks(source, exportedAt, release), exportedAt, release };
}

/** The export is written to the company's administration history, who took it and which kind. */
export async function auditCompanyExport(ctx: { organizationId: string; user: { id: string } }, kind: "cloud" | "sales" | "archive") {
  await prisma.administrationEvent.create({ data: { actorId: ctx.user.id, organizationId: ctx.organizationId, action: "company_export", detail: `Hämtade ${kind === "cloud" ? "Cloud-kopian" : kind === "sales" ? "offerter och fakturaunderlag" : "företagsarkivet"}.` } });
}
