import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ARCHIVE_MAX_BYTES, ARCHIVE_MAX_PAGE, ARCHIVE_PAGE, archiveDetail, archiveFilename, archiveKindLabel, archiveProblem, archiveQuery, archiveReadableSubjects, archiveRetentionText, archiveSubjectFor,
} from "../lib/workflow/report-archive";
import { normalizeWorkflowPermissionProfile, hasWorkflowPermission, type WorkflowPermissionSubject } from "../lib/workflow/permissions";

// Rapportarkiv (2026-10-07): the reports a person chose to keep, found again. Rules only; the reports themselves are
// the files exactly as they were made, so nothing here can change a reference-locked report.
const pdf = Buffer.from("%PDF-1.7\n...");
const xlsx = Buffer.from([0x50, 0x4b, 3, 4, 0, 0]);

test("only a real PDF or Excel file within the size limit can be kept", () => {
  assert.equal(archiveProblem(pdf, "PDF"), null);
  assert.equal(archiveProblem(xlsx, "XLSX"), null);
  assert.equal(archiveProblem(new Uint8Array(0), "PDF"), "Rapporten är tom.");
  assert.equal(archiveProblem(Buffer.from("<html>"), "PDF"), "Filen är ingen PDF.");
  assert.equal(archiveProblem(pdf, "XLSX"), "Filen är ingen Excel-fil.");
  assert.equal(archiveProblem(xlsx, "PDF"), "Filen är ingen PDF.");
  assert.equal(archiveProblem(Buffer.concat([pdf, Buffer.alloc(ARCHIVE_MAX_BYTES)]), "PDF"), "Rapporten är för stor för arkivet.");
});

test("a kept report is named like its download: the title, what it is and the format", () => {
  assert.equal(archiveFilename("Skyddsrond Verkstad", "FORM", "PDF"), "Skyddsrond Verkstad-rapport.pdf");
  assert.equal(archiveFilename("Skyddsrond Verkstad", "FORM", "XLSX"), "Skyddsrond Verkstad.xlsx");
  assert.equal(archiveFilename("Nätstation 4", "PROJECT", "PDF"), "Nätstation 4-projektrapport.pdf");
  assert.equal(archiveFilename('A/B: "C"?', "WORK_ORDER", "PDF"), "A-B- -C-rapport.pdf");
  assert.equal(archiveFilename("   ", "WORK_ORDER", "PDF"), "Rapport-rapport.pdf");
  assert.equal(archiveFilename("x".repeat(500), "FORM", "PDF").length, 120 + "-rapport.pdf".length);
  assert.doesNotMatch(archiveFilename("../../etc/passwd", "FORM", "PDF"), /[\\/]/);
});

test("a report is read by those who may read what it reports: its permission area", () => {
  assert.equal(archiveSubjectFor("WORK_ORDER"), "work-order");
  assert.equal(archiveSubjectFor("RISK_ASSESSMENT"), "risk-assessment");
  assert.equal(archiveSubjectFor("FORM", "kfid"), "kfid");
  assert.equal(archiveSubjectFor("FORM", "risk-assessment"), "risk-assessment");
  assert.equal(archiveSubjectFor("FORM"), "forms");
  assert.equal(archiveSubjectFor("FORM", "something-else"), "forms");
  assert.equal(archiveSubjectFor("PROJECT"), "projects");
  const worker = normalizeWorkflowPermissionProfile({ version: 1, grants: ["work-order:read", "forms:read", "projects:read"] });
  const can = (subject: WorkflowPermissionSubject) => hasWorkflowPermission(worker, subject, "read");
  assert.deepEqual(archiveReadableSubjects(can), ["projects", "work-order", "forms"]);
  assert.deepEqual(archiveReadableSubjects(() => false), [], "no permission, no report");
  assert.equal(archiveReadableSubjects(() => true).includes("customers" as never), false, "the customer register has no reports");
  assert.deepEqual(archiveReadableSubjects(() => true), ["projects", "kfid", "work-order", "risk-assessment", "forms"], "an admin reads every area");
});

test("the list is always bounded: a page of twenty, never more than a hundred, Mina unless Alla is asked for", () => {
  assert.deepEqual(archiveQuery(new URLSearchParams()), { format: "all", kind: "all", period: "all", sort: "updated", scope: "mine", q: "", limit: ARCHIVE_PAGE, cursor: undefined });
  assert.equal(archiveQuery(new URLSearchParams("scope=all")).scope, "all");
  assert.equal(archiveQuery(new URLSearchParams("scope=everything")).scope, "mine");
  assert.equal(archiveQuery(new URLSearchParams("limit=9999")).limit, ARCHIVE_MAX_PAGE);
  assert.equal(archiveQuery(new URLSearchParams("limit=-3")).limit, ARCHIVE_PAGE);
  assert.equal(archiveQuery(new URLSearchParams("limit=abc")).limit, ARCHIVE_PAGE);
  assert.equal(archiveQuery(new URLSearchParams("limit=7")).limit, 7);
  assert.equal(archiveQuery(new URLSearchParams(`q=${"x".repeat(300)}`)).q.length, 100);
  assert.equal(archiveQuery(new URLSearchParams("q=%20%20rond%20")).q, "rond");
  assert.equal(archiveQuery(new URLSearchParams("cursor=abc123")).cursor, "abc123");
});

test("the list line says what the report is, its format and its size", () => {
  assert.equal(archiveKindLabel("WORK_ORDER"), "Arbetsorder");
  assert.equal(archiveKindLabel("FORM"), "Protokoll");
  assert.equal(archiveKindLabel("PROJECT"), "Projektrapport");
  assert.equal(archiveKindLabel("OTHER"), "Rapport");
  assert.equal(archiveDetail({ kind: "FORM", format: "PDF", size: 124_300 }), "Protokoll · PDF · 124 kB");
  assert.equal(archiveDetail({ kind: "PROJECT", format: "XLSX", size: 2_350_000 }), "Projektrapport · Excel · 2,4 MB");
  assert.equal(archiveDetail({ kind: "FORM", format: "PDF", size: 12 }), "Protokoll · PDF · 1 kB");
});

test("the reports are kept as long as the company's history, and the page says so", () => {
  assert.match(archiveRetentionText(24), /^Rapporterna sparas i 2 år, lika länge som företagets historik/);
  assert.match(archiveRetentionText(12), /i 1 år,/);
  assert.match(archiveRetentionText(6), /i 6 månader,/);
  assert.match(archiveRetentionText(60), /i 5 år,/);
  assert.match(archiveRetentionText(null), /tills du tar bort dem för hand/);
});

test("a copy is kept only when asked for, never for a preview, and never changes the report", () => {
  const snapshot = readFileSync("app/api/workflow-tasks/snapshot-report/route.ts", "utf8");
  assert.equal((snapshot.match(/archiveAfterExport\(/g) ?? []).length, 2, "the PDF and the Excel of a protocol");
  assert.equal((snapshot.match(/wanted: payload\.archive === true && !payload\.inline/g) ?? []).length, 2, "asked for, and not a preview");
  const project = readFileSync("app/api/projects/[id]/report/route.ts", "utf8");
  assert.match(project, /wanted: new URL\(request\.url\)\.searchParams\.get\("archive"\) === "1"/);
  // Keeping happens after the report is drawn and only adds headers: the bytes of the report are the ones returned.
  assert.match(snapshot, /new Response\(new Uint8Array\(bytes\), \{ headers: \{.*\.\.\.kept \} \}\)/);
  assert.match(snapshot, /new Response\(new Uint8Array\(workbook\), \{ headers: \{.*\.\.\.kept \} \}\)/);
  const server = readFileSync("lib/workflow/report-archive-server.ts", "utf8");
  assert.doesNotMatch(server, /createWorkflowPdfReport|createFormExcel|report-kit/, "the archive never draws or changes a report");
  // The export window offers the box unticked and forgets the choice each time it opens.
  const menu = readFileSync("features/workflow/export-menu.tsx", "utf8");
  assert.match(menu, /useState\(false\)/);
  assert.match(menu, /setKeep\(false\)/);
});

test("the archive is reached only in Cloud, checks the area at every read and removes the file with the row", () => {
  const server = readFileSync("lib/workflow/report-archive-server.ts", "utf8");
  assert.match(server, /findFirst\(\{ where: \{ id, organizationId: ctx\.organizationId \}/g, "every read and removal is bound to the company");
  assert.match(server, /canRead\(ctx, entry\.subject\)/);
  assert.match(server, /await remove\(entry\.storagePath\)/);
  assert.match(server, /await remove\(storagePath\)/, "a row that cannot be written takes its file with it");
  for (const file of ["app/api/report-archive/route.ts", "app/api/report-archive/[id]/route.ts"]) assert.match(readFileSync(file, "utf8"), /requireCloudStorage\(ctx\)/, file);
  assert.match(readFileSync("app/api/report-archive/[id]/route.ts", "utf8"), /checkOrigin\(request\)/, "a removal checks the Origin");
  // The company's files go with the company (erasure) and with the history time (nightly retention).
  assert.match(readFileSync("lib/auth/erasure.ts", "utf8"), /FROM "ReportArchiveEntry"/);
  assert.match(readFileSync("lib/workflow/history-retention-server.ts", "utf8"), /purgeReportArchive\(company\.id, before\)/);
});
