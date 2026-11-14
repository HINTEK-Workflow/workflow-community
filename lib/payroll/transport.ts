import { createHash } from "node:crypto";
import type { SftpSettings } from "./sftp-settings";

export { isBlockedHost, sftpReady, sftpSettingsSchema, SFTP_UNAVAILABLE, type SftpSettings } from "./sftp-settings";

/**
 * Automatisk filöverföring (2026-10-29): SFTP on top of the same import and export engines as the manual files. The transport is
 * an interface, so the runs are tested against a memory mock and a real SFTP client can be put behind it later. No SFTP client
 * is installed yet (none is in package.json; adding one widens the release test), so `createSftpTransport` answers null and the
 * SFTP mode stays switched off with a clear message. Rules kept here, whatever the client:
 * - a file's content hash is checked against the import history first: the same file is never imported twice;
 * - a read or write is retried a few times; an interrupted upload is written as .part and renamed only when complete;
 * - a handled file is moved to a sub-folder; if the move fails, the hash still stops a second import;
 * - only CSV/TSV/TXT/Excel files of at most 10 MB, at most 20 per run;
 * - the host must be a public name or address (never localhost or a private network) and its host key fingerprint is required.
 * The password or private key is a company key (IntegrationKey, sealed per company) and is never in these settings.
 */
export const SFTP_DONE_FOLDER = "hintek-klar";
export const MAX_TRANSFER_FILES = 20;
export const MAX_TRANSFER_BYTES = 10_000_000;
const FILE_NAME = /\.(csv|tsv|txt|xlsx)$/i;


export type RemoteFile = { name: string; size: number };
export interface FileTransport {
  list(dir: string): Promise<RemoteFile[]>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, data: Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  close(): Promise<void>;
}

/** The real SFTP client: not installed (see above). */
export function createSftpTransport(settings: SftpSettings, secret: string): FileTransport | null {
  void settings; void secret;
  return null;
}

const join = (dir: string, name: string) => (dir ? `${dir.replace(/\/+$/, "")}/${name}` : name);
export const contentHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Retries a step a few times with a growing pause; the last error is thrown. */
export async function withRetry<T>(step: () => Promise<T>, attempts = 3, pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await step(); } catch (error) { last = error; if (attempt < attempts) await pause(500 * attempt); }
  }
  throw last;
}

export type TransferLine = { file: string; status: "imported" | "skipped" | "failed"; message: string };

/** Fetches the import folder's files and imports each through the shared engine, once per content. */
export async function runSftpImport(input: {
  transport: FileTransport; settings: SftpSettings;
  alreadyImported: (hash: string) => Promise<boolean>;
  importFile: (name: string, bytes: Uint8Array, hash: string) => Promise<{ ok: boolean; message: string }>;
  pause?: (ms: number) => Promise<void>;
}): Promise<TransferLine[]> {
  const lines: TransferLine[] = [];
  const files = (await withRetry(() => input.transport.list(input.settings.importDir), 3, input.pause)).filter((file) => FILE_NAME.test(file.name));
  for (const file of files.slice(0, MAX_TRANSFER_FILES)) {
    if (file.size > MAX_TRANSFER_BYTES) { lines.push({ file: file.name, status: "failed", message: "Filen är större än 10 MB." }); continue; }
    try {
      const bytes = await withRetry(() => input.transport.read(join(input.settings.importDir, file.name)), 3, input.pause);
      if (bytes.length > MAX_TRANSFER_BYTES) { lines.push({ file: file.name, status: "failed", message: "Filen är större än 10 MB." }); continue; }
      const hash = contentHash(bytes);
      if (await input.alreadyImported(hash)) lines.push({ file: file.name, status: "skipped", message: "Samma fil är redan importerad." });
      else {
        const result = await input.importFile(file.name, bytes, hash);
        lines.push({ file: file.name, status: result.ok ? "imported" : "failed", message: result.message });
        if (!result.ok) continue;
      }
      await input.transport.rename(join(input.settings.importDir, file.name), join(join(input.settings.importDir, SFTP_DONE_FOLDER), file.name)).catch(() => undefined);
    } catch (error) {
      lines.push({ file: file.name, status: "failed", message: error instanceof Error ? error.message.slice(0, 200) : "Filen kunde inte hämtas." });
    }
  }
  if (files.length > MAX_TRANSFER_FILES) lines.push({ file: "", status: "skipped", message: `${files.length - MAX_TRANSFER_FILES} filer väntar till nästa körning.` });
  return lines;
}

/** Writes an export file: first as .part, then renamed, so the receiver never reads half a file. */
export async function runSftpExport(input: { transport: FileTransport; settings: SftpSettings; fileName: string; bytes: Uint8Array; pause?: (ms: number) => Promise<void> }) {
  const target = join(input.settings.exportDir, input.fileName);
  await withRetry(() => input.transport.write(`${target}.part`, input.bytes), 3, input.pause);
  await withRetry(() => input.transport.rename(`${target}.part`, target), 3, input.pause);
  return target;
}

/** A transport in memory, for tests: files by path, and faults to simulate broken connections. */
export function memoryTransport(files: Record<string, Uint8Array> = {}, faults: { failReads?: number; failWrites?: number; failList?: boolean } = {}) {
  const store = new Map(Object.entries(files));
  let reads = faults.failReads ?? 0; let writes = faults.failWrites ?? 0;
  const transport: FileTransport & { files: Map<string, Uint8Array> } = {
    files: store,
    async list(dir) {
      if (faults.failList) throw new Error("Anslutningen bröts.");
      const prefix = dir ? `${dir.replace(/\/+$/, "")}/` : "";
      return [...store.entries()].filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/")).map(([path, data]) => ({ name: path.slice(prefix.length), size: data.length }));
    },
    async read(path) { if (reads > 0) { reads -= 1; throw new Error("Läsningen avbröts."); } const data = store.get(path); if (!data) throw new Error("Filen finns inte."); return data; },
    async write(path, data) { if (writes > 0) { writes -= 1; throw new Error("Skrivningen avbröts."); } store.set(path, data); },
    async rename(from, to) { const data = store.get(from); if (!data) throw new Error("Filen finns inte."); store.delete(from); store.set(to, data); },
    async close() { /* nothing to close */ },
  };
  return transport;
}
