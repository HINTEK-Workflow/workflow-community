import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { safeZipEntryName, ZipWriter } from "../lib/kfid/zip-writer";
import { readZip } from "./helpers/zip-reader";
import {
  CLOUD_EXPORT_FOLDERS,
  CLOUD_EXPORT_PART_SIZES,
  cloudExportIds,
  cloudExportPages,
  cloudExportPartName,
  commentToLocal,
  fitsOneCloudFile,
} from "../lib/kfid/cloud-export";
import { localWorkspaceRecordSchemas } from "../features/kfid/local-workspace-store";

// The parted Cloud export (S4, 2026-10-23): a large company gets a zip file in parts instead of a 413.

function writeZip(threshold?: number) {
  const zip = new ZipWriter({ date: new Date("2026-10-23T12:00:00.000Z"), zip64Threshold: threshold });
  const json = Buffer.from(JSON.stringify({ records: Array.from({ length: 50 }, (_, index) => ({ index, name: "Kund åäö" })) }));
  const binary = Buffer.from(Array.from({ length: 300 }, (_, index) => (index * 37) % 256));
  const chunks = [...zip.file("kunder/del-0001.json", json, { compress: true }), ...zip.file("bilagor/filer/a.pdf", binary), ...zip.file("tom.txt", new Uint8Array(0), { compress: true }), zip.finish()];
  const bytes = Buffer.concat(chunks);
  assert.equal(bytes.length, zip.bytesWritten);
  return { bytes, json, binary };
}

test("the zip writer writes entries an independent reader opens, compressed and stored", () => {
  const { bytes, json, binary } = writeZip();
  const { files, zip64 } = readZip(bytes);
  assert.equal(zip64, false);
  assert.deepEqual([...files.keys()], ["kunder/del-0001.json", "bilagor/filer/a.pdf", "tom.txt"]);
  assert.deepEqual(files.get("kunder/del-0001.json"), json);
  assert.deepEqual(files.get("bilagor/filer/a.pdf"), binary);
  assert.equal(files.get("tom.txt")!.length, 0);
  assert.ok(bytes.length < json.length + binary.length, "the JSON part is compressed");
});

test("the zip writer adds Zip64 records past its threshold (4 GB in use)", () => {
  const { bytes, json, binary } = writeZip(0);
  const { files, zip64 } = readZip(bytes);
  assert.equal(zip64, true);
  assert.deepEqual(files.get("kunder/del-0001.json"), json);
  assert.deepEqual(files.get("bilagor/filer/a.pdf"), binary);
});

test("zip entry names are plain relative paths and never repeat", () => {
  for (const bad of ["../x.json", "/x.json", "a/../b", "a\\b", "", "a//b", " a"]) assert.throws(() => safeZipEntryName(bad), bad);
  assert.equal(safeZipEntryName("bilagor/filer/0f0e-1.pdf"), "bilagor/filer/0f0e-1.pdf");
  const zip = new ZipWriter();
  zip.file("a.json", new Uint8Array([1]));
  assert.throws(() => zip.file("a.json", new Uint8Array([2])));
});

test("the file ids are stable within one export, differ between exports and never show a Cloud id", () => {
  const known = { customers: ["cust-1"], facilities: ["fac-1"], projects: ["proj-1"], tasks: ["task-1", "task-2"] };
  const key = new Uint8Array(32).fill(7);
  const ids = cloudExportIds(known, key);
  const again = cloudExportIds(known, key);
  const other = cloudExportIds(known);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(ids.task("task-1")!, uuid);
  assert.equal(ids.task("task-1"), again.task("task-1"), "a reference in one part finds its record in another");
  assert.equal(ids.task("task-1"), ids.own("task", "task-1"));
  assert.notEqual(ids.task("task-1"), ids.task("task-2"));
  assert.notEqual(ids.task("task-1"), other.task("task-1"), "two exports cannot be linked by their ids");
  assert.notEqual(ids.own("task", "x"), ids.own("customer", "x"), "each register has its own ids");
  assert.ok(!ids.customer("cust-1")!.includes("cust"));
  // Not in the export (another company, deleted) or empty: null, as before.
  assert.equal(ids.task("task-of-another-company"), null);
  assert.equal(ids.customer(null), null);
  assert.equal(ids.project(undefined), null);
  assert.equal(ids.facility("fac-1"), ids.own("facility", "fac-1"));
  assert.match(`${ids.own("file", "att-1")}.pdf`, /^[0-9a-f-]{36}\.pdf$/, "the storage name the file format allows");
});

test("parts are named per register in order, and the limits of one file are those of the re-import", () => {
  assert.equal(cloudExportPartName("customers", 1), "kunder/del-0001.json");
  assert.equal(cloudExportPartName("workflowTasks", 12), "uppgifter/del-0012.json");
  assert.equal(cloudExportPartName("attachments", 3), "bilagor/del-0003.json");
  assert.throws(() => cloudExportPartName("customers", 0));
  assert.deepEqual(Object.values(CLOUD_EXPORT_FOLDERS), ["kunder", "platser", "projekt", "uppgifter", "bilagor", "tidhistorik", "planering", "kommentarer"]);
  // Every register sent in parts is checked with the file's own record schema.
  assert.deepEqual(Object.keys(localWorkspaceRecordSchemas).sort(), Object.keys(CLOUD_EXPORT_FOLDERS).sort());
  for (const size of Object.values(CLOUD_EXPORT_PART_SIZES)) assert.ok(size > 0 && size <= 1000);
  assert.equal(fitsOneCloudFile({ records: 500, attachmentBytes: 50_000_000 }), true);
  assert.equal(fitsOneCloudFile({ records: 501, attachmentBytes: 0 }), false);
  assert.equal(fitsOneCloudFile({ records: 10, attachmentBytes: 50_000_001 }), false);
  assert.equal(fitsOneCloudFile({ records: 10, attachmentBytes: 0, comments: 5_000 }), true, "comments have their own limit");
  assert.equal(fitsOneCloudFile({ records: 10, attachmentBytes: 0, comments: 5_001 }), false, "more of them go in the zip file");
});

test("a comment follows its parent into the file, under the file's ids and with the author as a name only", () => {
  const ids = cloudExportIds({ customers: [], facilities: [], projects: ["proj-1"], tasks: ["task-1"] });
  const row = { id: "comment-1", organizationId: "org", workflowTaskId: null, projectId: null, deviationId: null, authorUserId: "user-1", authorName: "Anna", body: "Klart", inCustomerReport: true, createdAt: new Date("2026-11-01T08:00:00.000Z") };
  const onTask = commentToLocal({ ...row, workflowTaskId: "task-1" }, ids)!;
  assert.deepEqual([onTask.parentType, onTask.parentId], ["WORK_ORDER", ids.task("task-1")]);
  assert.deepEqual([onTask.authorName, onTask.body, onTask.inCustomerReport, onTask.createdAt], ["Anna", "Klart", true, "2026-11-01T08:00:00.000Z"]);
  assert.ok(!JSON.stringify(onTask).includes("user-1") && !JSON.stringify(onTask).includes("comment-1"), "no Cloud member or comment id in the file");
  assert.deepEqual(commentToLocal({ ...row, projectId: "proj-1" }, ids)!.parentId, ids.project("proj-1"));
  // A deviation keeps its id in the file (the self-inspection section), so its thread names that id.
  assert.deepEqual(commentToLocal({ ...row, deviationId: "dev-1" }, ids)!.parentId, "dev-1");
  assert.equal(commentToLocal({ ...row, workflowTaskId: "task-of-another-company" }, ids), null);
  assert.equal(localWorkspaceRecordSchemas.comments.safeParse(onTask).success, true);
  assert.equal(localWorkspaceRecordSchemas.comments.safeParse({ ...onTask, parentType: "FORM" }).success, false);
});

test("pages are read with a cursor, one page at a time, until a short page", async () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({ id: `r${index}` }));
  const calls: { take: number; skip?: number; cursor?: { id: string } }[] = [];
  const pages: string[][] = [];
  for await (const page of cloudExportPages(async (args) => {
    calls.push(args);
    const start = args.cursor ? rows.findIndex((row) => row.id === args.cursor!.id) + (args.skip ?? 0) : 0;
    return rows.slice(start, start + args.take);
  }, 3)) pages.push(page.map((row) => row.id));
  assert.deepEqual(pages, [["r0", "r1", "r2"], ["r3", "r4", "r5"], ["r6"]]);
  assert.deepEqual(calls.map((call) => call.cursor?.id ?? null), [null, "r2", "r5"]);
  const exact: string[][] = [];
  for await (const page of cloudExportPages(async (args) => args.cursor ? [] : rows.slice(0, 3), 3)) exact.push(page.map((row) => row.id));
  assert.deepEqual(exact, [["r0", "r1", "r2"]], "an empty last page adds no part");
});

test("the export route keeps its checks and sends a large company the zip file", () => {
  const route = readFileSync("app/api/cloud-workspace/export/route.ts", "utf8");
  assert.match(route, /const ctx = await context\(\);\s+requireCloudStorage\(ctx\);\s+requireAdmin\(ctx\);/);
  assert.match(route, /fitsOneCloudFile\(await cloudExportSize\(ctx\.organizationId\)\)/);
  assert.match(route, /"Content-Type": "application\/zip"/);
  assert.match(route, /"Cache-Control": "private, no-store"/);
  assert.doesNotMatch(route, /413/, "no company is refused for its size any more");
  const exporter = readFileSync("lib/kfid/cloud-export.ts", "utf8");
  assert.match(exporter, /prisma\.comment\.findMany\(\{ where, orderBy: ascending \}\)/, "the .hwf file holds the threads");
  assert.match(exporter, /yield\* part\("comments"/, "and so does the zip file");
  // Every read of a register is bound to the company.
  for (const call of exporter.match(/prisma\.\w+\.(findMany|count|aggregate)\(\{ where[^\n]*/g) ?? []) assert.match(call, /where(: \{ organizationId| \}|,)/, call);
  assert.match(exporter, /await bindExportedLocalWorkspace\(source, head\.localIdentity\.id\);\s+yield zip\.finish\(\);/, "the member binding is written once the zip file is complete");
});
