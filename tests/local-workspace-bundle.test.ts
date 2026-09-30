import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createMemoryLocalAttachmentStore,
} from "../features/kfid/local-attachments";
import {
  createLocalWorkspaceBundle,
  localWorkspaceBundleFilename,
  parseLocalWorkspaceBundle,
} from "../features/kfid/local-workspace-bundle";
import {
  createLocalWorkspace,
  parseLocalWorkspace,
  saveLocalControlRecord,
} from "../features/kfid/local-workspace-store";
import { blankControl } from "../lib/kfid/model";

async function workspaceWithAttachment() {
  const data = blankControl();
  data.meta.proj = "Centralbyte";
  const saved = saveLocalControlRecord(
    createLocalWorkspace({ id: "org-local", name: "Lokala El AB" }),
    {
      version: 0,
      customerId: null,
      data,
      status: "DRAFT",
    },
  );
  const bytes = new TextEncoder().encode("%PDF-1.7\nKFID bilaga\n");
  const attachmentId = crypto.randomUUID();
  const attachment = {
    id: attachmentId,
    controlId: saved.control.id,
    filename: "mätprotokoll.pdf",
    storageName: `${attachmentId}.pdf`,
    mimeType: "application/pdf",
    size: bytes.byteLength,
    section: "vis" as const,
    rowId: null,
    createdAt: new Date().toISOString(),
  };
  const workspace = parseLocalWorkspace(
    {
      ...saved.workspace,
      attachments: [attachment],
    },
    "org-local",
  );
  const store = createMemoryLocalAttachmentStore();
  await store.write(attachment, new Blob([bytes], { type: attachment.mimeType }));
  return { workspace, store, bytes, attachment };
}

test("a complete local workspace bundle round-trips metadata and binary attachments", async () => {
  const { workspace, store, bytes, attachment } = await workspaceWithAttachment();
  const bundle = await createLocalWorkspaceBundle(workspace, store);
  const imported = await parseLocalWorkspaceBundle(bundle, "org-local");

  assert.equal(imported.sourceSchemaVersion, 2);
  assert.equal(imported.workspace.schemaVersion, 11);
  assert.equal(imported.workspace.workspaceId, workspace.workspaceId);
  assert.equal(imported.workspace.controls[0].project, "Centralbyte");
  assert.equal(imported.workspace.attachments[0].filename, "mätprotokoll.pdf");
  const importedAttachment = imported.files.get(attachment.id);
  assert.ok(importedAttachment);
  assert.deepEqual(
    new Uint8Array(await importedAttachment.arrayBuffer()),
    bytes,
  );
  assert.equal(imported.attachmentBytes, bytes.byteLength);
});

test("workspace bundles remain organization-bound and reject damaged attachments", async () => {
  const { workspace, store } = await workspaceWithAttachment();
  const bundle = await createLocalWorkspaceBundle(workspace, store);
  await assert.rejects(
    () => parseLocalWorkspaceBundle(bundle, "org-other"),
    /annat Workflow-företag/,
  );

  const damaged = new Uint8Array(await bundle.arrayBuffer());
  damaged[damaged.length - 1] ^= 0xff;
  await assert.rejects(
    () => parseLocalWorkspaceBundle(new Blob([damaged]), "org-local"),
    /integritetskontrollen misslyckades/,
  );
  await assert.rejects(
    () => parseLocalWorkspaceBundle(new Blob(["not a bundle"]), "org-local"),
    /filhuvudet känns inte igen/,
  );
});

test("schema 1 workspace bundles remain readable and migrate without overwriting the source", async () => {
  const { workspace, store } = await workspaceWithAttachment();
  const current = new Uint8Array(await (await createLocalWorkspaceBundle(workspace, store)).arrayBuffer());
  const manifestLength = new DataView(current.buffer).getUint32(8, true);
  const manifestStart = 12;
  const manifest = new TextDecoder().decode(
    current.slice(manifestStart, manifestStart + manifestLength),
  );
  const legacyManifest = manifest
    .replace('"schemaVersion":2', '"schemaVersion":1')
    .replace('"schemaVersion":11', '"schemaVersion":1')
    .replace(/,"localIdentity":\{[^}]+\}/, "")
    .replace(/,"cloudBinding":\{[^}]+\}/, "");
  const legacyBytes = new TextEncoder().encode(legacyManifest);
  const header = current.slice(0, manifestStart);
  new DataView(header.buffer, header.byteOffset, header.byteLength).setUint32(8, legacyBytes.byteLength, true);
  const legacy = new Blob([
    header,
    legacyBytes,
    current.slice(manifestStart + manifestLength),
  ]);
  const originalLegacyBytes = new Uint8Array(await legacy.arrayBuffer());

  const imported = await parseLocalWorkspaceBundle(legacy, "org-local");
  assert.equal(imported.sourceSchemaVersion, 1);
  assert.equal(imported.workspace.schemaVersion, 11);
  assert.equal(imported.workspace.cloudBinding.organizationId, "org-local");
  assert.deepEqual(new Uint8Array(await legacy.arrayBuffer()), originalLegacyBytes);
});

test("workspace bundle filenames are stable and filesystem-safe", () => {
  assert.equal(localWorkspaceBundleFilename("Åkes El & Kraft AB"), "HINTEK-Workflow-Akes-El-Kraft-AB.hwf");
  assert.equal(
    localWorkspaceBundleFilename("Ignoreras", "min-arbetsyta.kfid"),
    "min-arbetsyta.hwf",
  );
});

test("an uploaded Cloud copy from another company or a damaged file is a clear 422, never a server error", async () => {
  const { parseUploadedCloudBundle } = await import("../lib/kfid/cloud-bundle");
  const { ApiError } = await import("../lib/kfid/errors");
  const { workspace, store } = await workspaceWithAttachment();
  const bundle = await createLocalWorkspaceBundle(workspace, store);
  await assert.rejects(parseUploadedCloudBundle(bundle, "org-other"), (error: unknown) =>
    error instanceof ApiError && error.status === 422 && /annat företag/.test(error.message));
  await assert.rejects(parseUploadedCloudBundle(new Blob([new Uint8Array(64)]), "org-local"), (error: unknown) =>
    error instanceof ApiError && error.status === 422 && /kunde inte öppnas/.test(error.message));
  assert.equal((await parseUploadedCloudBundle(bundle, "org-local")).workspace.workspaceId, workspace.workspaceId);
});
