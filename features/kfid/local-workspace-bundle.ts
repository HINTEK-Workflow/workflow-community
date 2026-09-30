import { z } from "zod";
import type { LocalAttachmentStore } from "./local-attachments";
import {
  parseLocalWorkspace,
  type LocalWorkspaceDocument,
} from "./local-workspace-store";

export const LOCAL_WORKSPACE_BUNDLE_EXTENSION = ".hwf";
export const LEGACY_LOCAL_WORKSPACE_BUNDLE_EXTENSION = ".kfid";
export const LOCAL_WORKSPACE_BUNDLE_MIME = "application/vnd.hintek.workflow-file";
export const LEGACY_LOCAL_WORKSPACE_BUNDLE_MIME = "application/vnd.hintek.kfid-workspace";
export const LOCAL_WORKSPACE_BUNDLE_ACCEPT = `${LOCAL_WORKSPACE_BUNDLE_EXTENSION},${LEGACY_LOCAL_WORKSPACE_BUNDLE_EXTENSION},${LOCAL_WORKSPACE_BUNDLE_MIME},${LEGACY_LOCAL_WORKSPACE_BUNDLE_MIME}`;
const BUNDLE_FORMAT = "KFID_WORKSPACE_BUNDLE";
export const LOCAL_WORKSPACE_BUNDLE_SCHEMA_VERSION = 2;
const MAGIC = new TextEncoder().encode("KFIDWS01");
const HEADER_SIZE = MAGIC.byteLength + 4;
const MAX_MANIFEST_BYTES = 50_000_000;
export const MAX_LOCAL_WORKSPACE_BUNDLE_BYTES = 500_000_000;

const bundleManifestSchema = z
  .object({
    format: z.literal(BUNDLE_FORMAT),
    schemaVersion: z.union([
      z.literal(1),
      z.literal(LOCAL_WORKSPACE_BUNDLE_SCHEMA_VERSION),
    ]),
    exportedAt: z.iso.datetime(),
    workspace: z.unknown(),
    files: z.array(
      z
        .object({
          attachmentId: z.string().uuid(),
          offset: z.number().int().nonnegative().safe(),
          size: z.number().int().positive().max(10_000_000),
          sha256: z.string().regex(/^[0-9a-f]{64}$/),
        })
        .strict(),
    ),
  })
  .strict();

type BundleManifest = z.infer<typeof bundleManifestSchema>;

export type LocalWorkspaceBundleImport = {
  workspace: LocalWorkspaceDocument;
  files: Map<string, Blob>;
  exportedAt: string;
  attachmentBytes: number;
  sourceSchemaVersion: 1 | 2;
};

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function bundleError(message: string): never {
  throw new Error(
    `Arbetsytefilen kunde inte öppnas: ${message} Originalfilen har inte ändrats.`,
  );
}

export async function createLocalWorkspaceBundle(
  workspace: LocalWorkspaceDocument,
  store: LocalAttachmentStore,
) {
  const validated = parseLocalWorkspace(workspace, workspace.organization.id);
  const files: BundleManifest["files"] = [];
  const contents: Blob[] = [];
  let offset = 0;

  for (const attachment of validated.attachments) {
    const source = await store.read(attachment);
    if (source.size !== attachment.size)
      throw new Error(
        `Bilagan ”${attachment.filename}” har ändrats eller är skadad. Arbetsytefilen skapades inte.`,
      );
    const contentsBlob =
      source.type === attachment.mimeType
        ? source
        : source.slice(0, source.size, attachment.mimeType);
    files.push({
      attachmentId: attachment.id,
      offset,
      size: contentsBlob.size,
      sha256: await sha256(contentsBlob),
    });
    contents.push(contentsBlob);
    offset += contentsBlob.size;
  }

  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT,
    schemaVersion: LOCAL_WORKSPACE_BUNDLE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    workspace: validated,
    files,
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES)
    throw new Error("Arbetsytans register är större än 50 MB.");

  const header = new Uint8Array(HEADER_SIZE);
  header.set(MAGIC);
  new DataView(header.buffer).setUint32(MAGIC.byteLength, manifestBytes.byteLength, true);
  const bundle = new Blob(
    [header, manifestBytes, ...contents] as BlobPart[],
    { type: LOCAL_WORKSPACE_BUNDLE_MIME },
  );
  if (bundle.size > MAX_LOCAL_WORKSPACE_BUNDLE_BYTES)
    throw new Error("Arbetsytefilen skulle bli större än 500 MB.");
  return bundle;
}

export async function parseLocalWorkspaceBundle(
  source: Blob,
  organizationId: string,
): Promise<LocalWorkspaceBundleImport> {
  if (source.size < HEADER_SIZE || source.size > MAX_LOCAL_WORKSPACE_BUNDLE_BYTES)
    bundleError("filstorleken är ogiltig eller överstiger 500 MB.");

  const header = new Uint8Array(await source.slice(0, HEADER_SIZE).arrayBuffer());
  if (!bytesEqual(header.slice(0, MAGIC.byteLength), MAGIC))
    bundleError("filhuvudet känns inte igen.");
  const manifestLength = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  ).getUint32(MAGIC.byteLength, true);
  if (
    !manifestLength ||
    manifestLength > MAX_MANIFEST_BYTES ||
    HEADER_SIZE + manifestLength > source.size
  )
    bundleError("registerdelen har en ogiltig storlek.");

  let manifest: BundleManifest;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      await source.slice(HEADER_SIZE, HEADER_SIZE + manifestLength).arrayBuffer(),
    );
    manifest = bundleManifestSchema.parse(JSON.parse(text));
  } catch {
    bundleError("registerdelen är ogiltig eller använder en nyare version.");
  }

  let workspace: LocalWorkspaceDocument;
  try {
    workspace = parseLocalWorkspace(manifest.workspace, organizationId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("annat Workflow-företag"))
      throw error;
    bundleError("arbetsytans register är ogiltigt.");
  }

  if (manifest.files.length !== workspace.attachments.length)
    bundleError("bilageregistret är ofullständigt.");
  const bodyStart = HEADER_SIZE + manifestLength;
  let expectedOffset = 0;
  const files = new Map<string, Blob>();
  for (let index = 0; index < workspace.attachments.length; index += 1) {
    const attachment = workspace.attachments[index];
    const entry = manifest.files[index];
    if (
      entry.attachmentId !== attachment.id ||
      entry.offset !== expectedOffset ||
      entry.size !== attachment.size
    )
      bundleError("bilagornas index eller storlek stämmer inte.");
    const end = bodyStart + entry.offset + entry.size;
    if (end > source.size) bundleError("en bilaga är avklippt.");
    const blob = source.slice(
      bodyStart + entry.offset,
      end,
      attachment.mimeType,
    );
    if ((await sha256(blob)) !== entry.sha256)
      bundleError(`integritetskontrollen misslyckades för ”${attachment.filename}”.`);
    files.set(attachment.id, blob);
    expectedOffset += entry.size;
  }
  if (bodyStart + expectedOffset !== source.size)
    bundleError("filen innehåller oväntade eller ofullständiga data.");

  return {
    workspace,
    files,
    exportedAt: manifest.exportedAt,
    attachmentBytes: expectedOffset,
    sourceSchemaVersion: manifest.schemaVersion,
  };
}

export function localWorkspaceBundleFilename(
  organizationName: string,
  originalName?: string,
) {
  const originalExtension = [LOCAL_WORKSPACE_BUNDLE_EXTENSION, LEGACY_LOCAL_WORKSPACE_BUNDLE_EXTENSION]
    .find((extension) => originalName?.toLocaleLowerCase("sv-SE").endsWith(extension));
  if (originalName && originalExtension) {
    const safeOriginal = originalName
      .slice(0, -originalExtension.length)
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100);
    if (safeOriginal)
      return `${safeOriginal}${LOCAL_WORKSPACE_BUNDLE_EXTENSION}`;
  }
  const company = organizationName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "foretag";
  return `HINTEK-Workflow-${company}${LOCAL_WORKSPACE_BUNDLE_EXTENSION}`;
}

export function downloadLocalWorkspaceBundle(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
