/**
 * What the pages see of a key file's export and read-in (2026-11-26): names, states and counts – never a value. Shared by
 * the company's own file (lib/api-handlers/company-key-file.ts) and, with ee/, the installation's own (ee/api/key-vault-import.ts),
 * so one dialog (features/integrations/key-file-import.tsx) serves both. No server code here.
 */
export type KeyFileExportAnswer = { ok: true; file: { name: string; text: string }; passphrase: string; entries: number; keys: number; unreadable?: number };

export type KeyImportEntry = {
  id: string;
  label: string;
  /** The heading the entry is listed under (Workflow, the company's connections …). */
  group: string;
  /** new: not in Workflow yet; changed: another value applies now; same: exactly this applies already (unchecked at first). */
  state: "new" | "changed" | "same";
};
export type KeyImportSkipped = { id: string; label: string; reason: string };

export type KeyImportPreview = {
  ok: true;
  /** The company the file belongs to, and how it stands to the one it is read into; null when the file has no company part. */
  company: { name: string; organizationNumber: string; match: "same" | "other" | "unknown" } | null;
  entries: KeyImportEntry[];
  /** Items of the file that are never read in here, with the reason (the server's own keys, an unknown kind …). */
  skipped: KeyImportSkipped[];
};

export type KeyImportResult = {
  ok: boolean;
  message: string;
  imported: { id: string; label: string }[];
  skipped: KeyImportSkipped[];
  /** The advice after a read-in: keys that may have leaked are changed at the service. */
  advice: string;
};

export const KEY_IMPORT_ACTIONS = {
  company: { preview: "preview_company_keys_import", run: "import_company_keys" },
  central: { preview: "preview_central_keys_import", run: "import_central_keys" },
} as const;
