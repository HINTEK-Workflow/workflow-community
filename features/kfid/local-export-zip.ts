import { z } from "zod";
import type { LocalWorkspaceBundleImport } from "./local-workspace-bundle";
import { parseLocalWorkspace, type LocalWorkspaceDocument } from "./local-workspace-store";

/**
 * Öppna en stor export-zip i Local (arbetslistan 16, 2026-10-24). A company too large for one .hwf file gets its Cloud copy
 * as a zip file in parts (lib/kfid/cloud-export.ts, S4): foretag.json (the company without its large registers), a part per
 * page of records, the attachments' files under bilagor/filer and innehall.json, which lists every part.
 *
 * Read in the browser without loading the file: only the end of the file and its central directory are read at first; each
 * part is then read, inflated (DecompressionStream, built into the browser) and checked on its own, and the event loop gets
 * a turn between the parts, so the page stays responsive and can show how far it has come. The attachments are stored
 * uncompressed and stay slices of the chosen file: none is copied into memory. Nothing is changed in the file itself.
 * The result is the same as a .hwf file gives, checked by the same schema (parseLocalWorkspace).
 */

export const LOCAL_EXPORT_ZIP_EXTENSION = ".zip";
export const LOCAL_EXPORT_ZIP_MIME = "application/zip";
/** The export of a large company can pass 500 MB (the .hwf limit); the attachments are never read whole. */
export const MAX_LOCAL_EXPORT_ZIP_BYTES = 8_000_000_000;
/** One part of records is at most a few MB; a larger entry is not a part this export writes. */
const MAX_PART_BYTES = 200_000_000;
const MAX_ATTACHMENT_BYTES = 10_000_000;

const SECTIONS = ["customers", "customerFacilities", "projects", "workflowTasks", "attachments", "timeEntryEvents", "plannedActivities"] as const;
type Section = (typeof SECTIONS)[number];
const SECTION_LABEL: Record<Section, string> = {
  customers: "kunder", customerFacilities: "platser", projects: "projekt", workflowTasks: "uppgifter", attachments: "bilagor",
  timeEntryEvents: "tidhistorik", plannedActivities: "planering",
};

export type LocalExportZipProgress = { done: number; total: number; text: string };

const partName = z.string().min(1).max(200);
const manifestSchema = z.object({
  format: z.literal("HWF_EXPORT"),
  schemaVersion: z.literal(1),
  exportedAt: z.iso.datetime(),
  organization: z.object({ id: z.string().min(1), name: z.string() }),
  head: partName,
  sections: z.object(Object.fromEntries(SECTIONS.map((section) => [section, z.object({ count: z.number().int().nonnegative(), parts: z.array(partName) })])) as Record<Section, z.ZodObject<{ count: z.ZodNumber; parts: z.ZodArray<z.ZodString> }>>),
  attachmentBytes: z.number().int().nonnegative(),
}).passthrough();
const partSchema = z.object({ format: z.literal("HWF_EXPORT_PART"), schemaVersion: z.literal(1), section: z.enum(SECTIONS), part: z.number().int().positive(), records: z.array(z.unknown()) }).passthrough();
const attachmentFilesSchema = z.array(z.object({ attachmentId: z.string().min(1), path: partName, size: z.number().int().positive().max(MAX_ATTACHMENT_BYTES), sha256: z.string().regex(/^[0-9a-f]{64}$/) }).strict());

function zipError(message: string): never {
  throw new Error(`Exportfilen kunde inte öppnas: ${message} Originalfilen har inte ändrats.`);
}

/** True when the file starts like a zip file (a local file header). */
export async function looksLikeZip(file: Blob) {
  if (file.size < 4) return false;
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
/** CRC-32 as zip files use it. */
export function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

type Entry = { name: string; method: number; crc: number; compressed: number; size: number; offset: number };

const bytesOf = async (file: Blob, start: number, end: number) => new Uint8Array(await file.slice(start, end).arrayBuffer());
const big = (view: DataView, at: number) => Number(view.getBigUint64(at, true));

/** The central directory: found from the end record (or Zip64's), read in one slice. */
async function readDirectory(file: Blob): Promise<Map<string, Entry>> {
  const tailStart = Math.max(0, file.size - (22 + 0xffff + 20));
  const tail = await bytesOf(file, tailStart, file.size);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let end = tail.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) zipError("filens innehållsförteckning saknas (filen är avklippt eller ingen zip-fil).");
  let count = view.getUint16(end + 10, true);
  let directorySize = view.getUint32(end + 12, true);
  let directoryOffset = view.getUint32(end + 16, true);
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    const locator = end - 20;
    if (locator < 0 || view.getUint32(locator, true) !== 0x07064b50) zipError("Zip64-posten saknas.");
    const recordAt = big(view, locator + 8);
    const record = await bytesOf(file, recordAt, recordAt + 56);
    const recordView = new DataView(record.buffer, record.byteOffset, record.byteLength);
    if (record.byteLength < 56 || recordView.getUint32(0, true) !== 0x06064b50) zipError("Zip64-posten är skadad.");
    count = big(recordView, 32);
    directorySize = big(recordView, 40);
    directoryOffset = big(recordView, 48);
  }
  if (directoryOffset + directorySize > file.size || directorySize > 64 * 1024 * 1024) zipError("innehållsförteckningen har en ogiltig storlek.");
  const directory = await bytesOf(file, directoryOffset, directoryOffset + directorySize);
  const dir = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries = new Map<string, Entry>();
  let at = 0;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > directory.byteLength || dir.getUint32(at, true) !== 0x02014b50) zipError("innehållsförteckningen är skadad.");
    const method = dir.getUint16(at + 10, true);
    const nameLength = dir.getUint16(at + 28, true);
    const extraLength = dir.getUint16(at + 30, true);
    const commentLength = dir.getUint16(at + 32, true);
    let compressed = dir.getUint32(at + 20, true);
    let size = dir.getUint32(at + 24, true);
    let offset = dir.getUint32(at + 42, true);
    const name = decoder.decode(directory.subarray(at + 46, at + 46 + nameLength));
    // Zip64 extra field: the 64-bit values for those that are full (size, compressed, offset in that order).
    let extra = at + 46 + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = dir.getUint16(extra, true);
      const length = dir.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let field = extra + 4;
        if (size === 0xffffffff) { size = big(dir, field); field += 8; }
        if (compressed === 0xffffffff) { compressed = big(dir, field); field += 8; }
        if (offset === 0xffffffff) offset = big(dir, field);
      }
      extra += 4 + length;
    }
    if (method !== 0 && method !== 8) zipError(`delen ”${name}” använder en packning som inte stöds.`);
    if (entries.has(name)) zipError(`delen ”${name}” finns två gånger.`);
    entries.set(name, { name, method, crc: dir.getUint32(at + 16, true), compressed, size, offset });
    at = extraEnd + commentLength;
  }
  return entries;
}

/** The entry's data as a slice of the file (still compressed for method 8); its local header is checked first. */
async function dataOf(file: Blob, entry: Entry) {
  const header = await bytesOf(file, entry.offset, entry.offset + 30);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (header.byteLength < 30 || view.getUint32(0, true) !== 0x04034b50) zipError(`delen ”${entry.name}” är skadad.`);
  const start = entry.offset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
  if (start + entry.compressed > file.size) zipError(`delen ”${entry.name}” är avklippt.`);
  return file.slice(start, start + entry.compressed);
}

/** The entry's bytes, inflated and checked against its size and CRC. Only for the parts (at most a few MB each). */
async function bytesOfEntry(file: Blob, entry: Entry) {
  if (entry.size > MAX_PART_BYTES) zipError(`delen ”${entry.name}” är för stor.`);
  const data = await dataOf(file, entry);
  const bytes = entry.method === 8
    ? new Uint8Array(await new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer())
    : new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength !== entry.size || crc32(bytes) !== entry.crc) zipError(`delen ”${entry.name}” är skadad (kontrollsumman stämmer inte).`);
  return bytes;
}

async function jsonOf(file: Blob, entries: Map<string, Entry>, name: string) {
  const entry = entries.get(name);
  if (!entry) zipError(`delen ”${name}” saknas.`);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await bytesOfEntry(file, entry))) as unknown;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Exportfilen kunde inte öppnas")) throw error;
    zipError(`delen ”${name}” är ingen giltig JSON.`);
  }
}

/** A turn for the page between the parts (a click, the progress bar). */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Reads a parted Cloud export (.zip) as a Local workspace: the same result as parseLocalWorkspaceBundle gives for a .hwf
 * file. `onProgress` is told how many of the file's bytes have been read; `signal` stops the reading (an AbortError).
 */
export async function parseLocalExportZip(file: Blob, organizationId: string, options: { onProgress?: (progress: LocalExportZipProgress) => void; signal?: AbortSignal } = {}): Promise<LocalWorkspaceBundleImport> {
  const { onProgress, signal } = options;
  if (file.size < 22 || file.size > MAX_LOCAL_EXPORT_ZIP_BYTES) zipError("filstorleken är ogiltig.");
  const total = file.size;
  let done = 0;
  const report = (text: string) => onProgress?.({ done: Math.min(done, total), total, text });
  const step = async (bytes: number, text: string) => {
    if (signal?.aborted) throw new DOMException("Inläsningen avbröts.", "AbortError");
    done += bytes;
    report(text);
    await breathe();
  };
  report("Läser innehållsförteckningen");
  const entries = await readDirectory(file);

  const manifestResult = manifestSchema.safeParse(await jsonOf(file, entries, "innehall.json"));
  if (!manifestResult.success) zipError("innehall.json är ogiltig eller använder en nyare version.");
  const manifest = manifestResult.data;
  if (manifest.organization.id !== organizationId) throw new Error("Exportfilen tillhör ett annat Workflow-företag.");
  const head = await jsonOf(file, entries, manifest.head);
  if (!head || typeof head !== "object" || Array.isArray(head)) zipError("foretag.json är ogiltig.");
  await step(entries.get(manifest.head)!.compressed, "Läser företaget");

  const document = { ...(head as Record<string, unknown>) };
  const files = new Map<string, Blob>();
  let attachmentBytes = 0;
  for (const section of SECTIONS) {
    const { parts, count } = manifest.sections[section];
    const records: unknown[] = [];
    for (const [index, name] of parts.entries()) {
      const parsed = partSchema.safeParse(await jsonOf(file, entries, name));
      if (!parsed.success || parsed.data.section !== section || parsed.data.part !== index + 1) zipError(`delen ”${name}” hör inte till ${SECTION_LABEL[section]} eller är i fel ordning.`);
      records.push(...parsed.data.records);
      let read = entries.get(name)!.compressed;
      if (section === "attachments") {
        const listed = attachmentFilesSchema.safeParse((parsed.data as { files?: unknown }).files);
        if (!listed.success || listed.data.length !== parsed.data.records.length) zipError(`bilageregistret i ”${name}” är ofullständigt.`);
        for (const item of listed.data) {
          const entry = entries.get(item.path);
          if (!entry || entry.size !== item.size) zipError(`bilagans fil ”${item.path}” saknas eller har fel storlek.`);
          // Stored as they are (the export packs only text files): the file's own bytes, never copied.
          const blob = entry.method === 0 ? await dataOf(file, entry) : new Blob([await bytesOfEntry(file, entry) as BlobPart]);
          if ((await sha256(blob)) !== item.sha256) zipError(`integritetskontrollen misslyckades för ”${item.path}”.`);
          if (files.has(item.attachmentId)) zipError("en bilaga finns två gånger.");
          files.set(item.attachmentId, blob);
          attachmentBytes += item.size;
          read += entry.compressed;
        }
      }
      await step(read, `Läser ${SECTION_LABEL[section]} (del ${index + 1} av ${parts.length})`);
    }
    if (records.length !== count) zipError(`antalet ${SECTION_LABEL[section]} stämmer inte med innehall.json.`);
    document[section] = records;
  }
  if (attachmentBytes !== manifest.attachmentBytes) zipError("bilagornas storlek stämmer inte med innehall.json.");

  report("Kontrollerar arbetsytan");
  await breathe();
  let workspace: LocalWorkspaceDocument;
  try {
    workspace = parseLocalWorkspace(document, organizationId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("annat Workflow-företag")) throw error;
    zipError("arbetsytans register är ogiltigt.");
  }
  const attachmentIds = new Set(workspace.attachments.map((attachment) => attachment.id));
  if (attachmentIds.size !== files.size || [...files.keys()].some((id) => !attachmentIds.has(id))) zipError("bilagorna stämmer inte med bilageregistret.");
  for (const attachment of workspace.attachments) {
    const blob = files.get(attachment.id)!;
    if (blob.size !== attachment.size) zipError(`bilagan ”${attachment.filename}” har fel storlek.`);
    if (blob.type !== attachment.mimeType) files.set(attachment.id, blob.slice(0, blob.size, attachment.mimeType));
  }
  done = total;
  report("Klart");
  return { workspace, files, exportedAt: manifest.exportedAt, attachmentBytes, sourceSchemaVersion: 2 };
}
