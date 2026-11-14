import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { blankCustomerForm } from "../features/kfid/customer-form-dialog";
import { crc32, looksLikeZip, parseLocalExportZip, type LocalExportZipProgress } from "../features/kfid/local-export-zip";
import { createLocalWorkspace, parseLocalWorkspace, saveLocalNewCustomer, saveLocalWorkflowTaskRecord, type LocalWorkspaceDocument } from "../features/kfid/local-workspace-store";
import { ZipWriter } from "../lib/kfid/zip-writer";
import { crc32 as nodeCrc32 } from "node:zlib";

// Öppna en stor export-zip i Local (arbetslistan 16, 2026-10-24): the parted Cloud export, written by the server's own zip writer,
// read back in parts as the same workspace a .hwf file gives.

const ORG = "org-zip";
const SECTIONS = ["customers", "customerFacilities", "projects", "workflowTasks", "attachments", "timeEntryEvents", "plannedActivities"] as const;
const FOLDER: Record<(typeof SECTIONS)[number], string> = { customers: "kunder", customerFacilities: "platser", projects: "projekt", workflowTasks: "uppgifter", attachments: "bilagor", timeEntryEvents: "tidhistorik", plannedActivities: "planering" };

function company() {
  let workspace = createLocalWorkspace({ id: ORG, name: "Stora El AB" });
  for (const name of ["Kund A", "Kund B", "Kund C"]) workspace = saveLocalNewCustomer(workspace, { ...blankCustomerForm, name, company: name }, null).workspace;
  for (const title of ["Jobb 1", "Jobb 2", "Jobb 3"]) {
    workspace = saveLocalWorkflowTaskRecord(workspace, {
      version: 0, kind: "WORK_ORDER", title, description: "", status: "PLANNED", projectId: null, customerId: null, assignedToUserId: null, assignedToName: "", dueDate: "",
      data: { kind: "WORK_ORDER", details: { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" } },
    }).workspace;
  }
  const pdf = new Uint8Array(Array.from({ length: 5000 }, (_, index) => (index * 31) % 256));
  const text = new TextEncoder().encode("Mätvärden\n".repeat(400));
  const files = [{ bytes: pdf, mimeType: "application/pdf", filename: "protokoll.pdf" }, { bytes: text, mimeType: "text/plain", filename: "anteckning.txt" }].map((file, index) => {
    const id = crypto.randomUUID();
    return { ...file, attachment: { id, taskId: workspace.workflowTasks[index].id, filename: file.filename, storageName: `${id}.${file.filename.split(".").pop()}`, mimeType: file.mimeType, size: file.bytes.byteLength, section: "vis" as const, rowId: null, createdAt: new Date().toISOString() } };
  });
  workspace = parseLocalWorkspace({ ...workspace, cloudSnapshot: { format: "KFID_CLOUD_SNAPSHOT", schemaVersion: 1, exportedAt: "2026-10-24T08:00:00.000Z" }, attachments: files.map((file) => file.attachment) }, ORG);
  return { workspace, files };
}

/** The zip as lib/kfid/cloud-export.ts writes it: foretag.json, parts of `partSize` records, the files, innehall.json. */
function exportZip({ workspace, files }: ReturnType<typeof company>, options: { partSize?: number; zip64Threshold?: number; organizationId?: string } = {}) {
  const partSize = options.partSize ?? 2;
  const zip = new ZipWriter({ date: new Date("2026-10-24T08:00:00.000Z"), zip64Threshold: options.zip64Threshold });
  const chunks: Uint8Array[] = [];
  const json = (name: string, value: unknown) => chunks.push(...zip.file(name, new TextEncoder().encode(JSON.stringify(value)), { compress: true }));
  const head = { ...workspace, ...Object.fromEntries(SECTIONS.map((section) => [section, []])) };
  json("foretag.json", head);
  const sections = Object.fromEntries(SECTIONS.map((section) => [section, { count: 0, parts: [] as string[] }]));
  let attachmentBytes = 0;
  for (const section of SECTIONS) {
    const records = (workspace as LocalWorkspaceDocument)[section] as unknown[];
    for (let start = 0; start < records.length; start += partSize) {
      const slice = records.slice(start, start + partSize);
      const name = `${FOLDER[section]}/del-${String(sections[section].parts.length + 1).padStart(4, "0")}.json`;
      const extra: { files?: unknown[] } = {};
      if (section === "attachments") {
        extra.files = slice.map((record) => {
          const file = files.find((item) => item.attachment.id === (record as { id: string }).id)!;
          const path = `bilagor/filer/${file.attachment.storageName}`;
          chunks.push(...zip.file(path, file.bytes, { compress: file.mimeType === "text/plain" }));
          attachmentBytes += file.bytes.byteLength;
          return { attachmentId: file.attachment.id, path, size: file.bytes.byteLength, sha256: createHash("sha256").update(file.bytes).digest("hex") };
        });
      }
      sections[section].parts.push(name);
      sections[section].count += slice.length;
      json(name, { format: "HWF_EXPORT_PART", schemaVersion: 1, section, part: sections[section].parts.length, records: slice, ...extra });
    }
  }
  json("innehall.json", { format: "HWF_EXPORT", schemaVersion: 1, exportedAt: "2026-10-24T08:00:00.000Z", organization: { id: options.organizationId ?? ORG, name: "Stora El AB" },
    workspaceId: workspace.workspaceId, localIdentityId: workspace.localIdentity.id, head: "foretag.json", sections, attachmentBytes });
  chunks.push(zip.finish());
  return new Uint8Array(Buffer.concat(chunks));
}

test("a parted export zip opens in Local as the same workspace, the attachments as slices of the file", async () => {
  const source = company();
  const bytes = exportZip(source);
  const file = new Blob([bytes]);
  assert.equal(await looksLikeZip(file), true);
  assert.equal(await looksLikeZip(new Blob(["KFIDWS01"])), false);
  const progress: LocalExportZipProgress[] = [];
  const imported = await parseLocalExportZip(file, ORG, { onProgress: (step) => progress.push(step) });
  assert.deepEqual(imported.workspace.customers.map((item) => item.name), ["Kund A", "Kund B", "Kund C"]);
  assert.deepEqual(imported.workspace.workflowTasks.map((item) => item.title), source.workspace.workflowTasks.map((item) => item.title));
  assert.equal(imported.workspace.workspaceId, source.workspace.workspaceId);
  assert.equal(imported.exportedAt, "2026-10-24T08:00:00.000Z");
  for (const { attachment, bytes: original } of source.files) {
    const blob = imported.files.get(attachment.id)!;
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), original, attachment.filename);
    assert.equal(blob.type, attachment.mimeType);
  }
  assert.equal(imported.attachmentBytes, source.files.reduce((sum, item) => sum + item.bytes.byteLength, 0));
  // The progress only goes forward and ends at the whole file; it names the parts it reads.
  assert.ok(progress.length > 4);
  for (let index = 1; index < progress.length; index += 1) assert.ok(progress[index].done >= progress[index - 1].done);
  assert.equal(progress.at(-1)!.done, bytes.byteLength);
  assert.ok(progress.some((step) => /kunder \(del 2 av 2\)/.test(step.text)));
});

test("Zip64 records are read as well (an export past 4 GB or 65 535 entries)", async () => {
  const source = company();
  const imported = await parseLocalExportZip(new Blob([exportZip(source, { zip64Threshold: 0 })]), ORG);
  assert.equal(imported.workspace.customers.length, 3);
  assert.equal(imported.files.size, 2);
});

test("another company's export, a damaged part, a missing part and a cut file are refused with a reason", async () => {
  const source = company();
  await assert.rejects(() => parseLocalExportZip(new Blob([exportZip(source, { organizationId: "org-other" })]), ORG), /annat Workflow-företag/);
  const bytes = exportZip(source);
  // The PDF is stored as it is: a changed byte inside it fails its checksum.
  const at = Buffer.from(bytes).indexOf(Buffer.from(source.files[0].bytes.subarray(100, 140)));
  assert.ok(at > 0);
  const damaged = bytes.slice();
  damaged[at] ^= 0xff;
  await assert.rejects(() => parseLocalExportZip(new Blob([damaged]), ORG), /integritetskontrollen misslyckades/);
  await assert.rejects(() => parseLocalExportZip(new Blob([bytes.slice(0, bytes.byteLength - 10)]), ORG), /innehållsförteckning saknas/);
  await assert.rejects(() => parseLocalExportZip(new Blob([bytes.slice(0, 10)]), ORG), /filstorleken/);
});

test("the reading can be stopped, and the CRC is the zip file's", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => parseLocalExportZip(new Blob([exportZip(company())]), ORG, { signal: controller.signal }), { name: "AbortError" });
  const sample = new TextEncoder().encode("Workflow – åäö");
  assert.equal(crc32(sample), nodeCrc32(sample));
});
