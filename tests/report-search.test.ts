import assert from "node:assert/strict";
import test from "node:test";
import { reportCandidate, reportDateText } from "../lib/search/candidates";
import { parseSearchQuery } from "../lib/search/query";
import { rankCandidates } from "../lib/search/score";
import { searchLocalWorkspace } from "../lib/search/local";
import { buildSearchSql, searchSpecs } from "../lib/search/sql";
import { hasWorkflowPermission, noWorkflowPermissionProfile, type WorkflowPermissionProfile } from "../lib/workflow/permissions";
import { createDemoDatabase } from "../features/demo/demo-data";
import { demoReportArchive, demoReportSearchItems } from "../features/demo/demo-reports";

// Sök finds saved reports (Rapportarkivet, 2026-10-12): title, kind, customer, project, place and day; inside the
// person's company and the areas they may read; bounded.
const report = reportCandidate({ id: "r1", kind: "FORM", title: "Kontroll före idrifttagning, garagecentral", format: "PDF", filename: "k.pdf", size: 120_000, createdAt: "2026-10-12T08:30:00Z", createdByName: "Elon Relässon", customerName: "Nollpunkten Fastigheter AB", projectName: "Laddplatser garage", placePath: "Nollpunkten Fastigheter AB › Garaget › Garagecentral" });
const find = (query: string) => rankCandidates(parseSearchQuery(query), [report], { now: Date.parse("2026-10-12T12:00:00Z") }).groups.flatMap((group) => group.hits);

test("a saved report is found by title, type, customer, project, place, who kept it and the day", () => {
  for (const query of ["kontroll", "garagecentral", "nollpunkten", "laddplatser", "protokoll", "pdf", "rapport", "elon", "2026-10-12", "12 oktober 2026", "oktober", "typ:rapport garage"])
    assert.equal(find(query).length, 1, `"${query}" finds the report`);
  assert.equal(find("typ:rapport garage")[0].type, "report");
  assert.equal(find("xlsx").length, 0);
  assert.equal(find("nätstation").length, 0);
});

test("the hit opens the file itself: the PDF in the viewer, Excel as a download", () => {
  assert.equal(report.href, "/api/report-archive/r1?inline=1");
  assert.equal(reportCandidate({ id: "r2", kind: "PROJECT", title: "Projekt", format: "XLSX", createdAt: "2026-10-12T08:30:00Z" }).href, "/api/report-archive/r2");
  assert.match(report.subtitle, /Protokoll, PDF · Nollpunkten Fastigheter AB · sparad/);
  assert.equal(reportDateText("2026-10-12T22:30:00Z").startsWith("2026-10-13 "), true, "the day is the Swedish day");
});

const access = (grants: WorkflowPermissionProfile["grants"], admin = false) => ({ organizationId: "org-1", userId: "u1", admin, workflowPermissions: { version: 1 as const, grants } });
test("Cloud SQL: reports only inside the company and only the areas the person may read", () => {
  const parsed = parseSearchQuery("kontroll");
  const reportSpec = (a: ReturnType<typeof access>) => searchSpecs(a, parsed).find((spec) => spec.type === "report");
  assert.equal(reportSpec({ ...access([]), workflowPermissions: noWorkflowPermissionProfile() }), undefined, "no right, no reports");
  assert.equal(reportSpec(access(["customers:read"])), undefined, "the customer register has no reports");
  const sql = buildSearchSql(reportSpec(access(["forms:read"]))!, parsed, "org-1", 40, "match", false);
  assert.ok(sql.values.includes("org-1"));
  assert.match(sql.text, /e\."organizationId" = \$\d+/);
  assert.match(sql.text, /e\.subject IN \(\$\d+\)/);
  assert.ok(sql.values.includes("forms") && !sql.values.includes("work-order") && !sql.values.includes("projects"));
  assert.match(sql.text, /"WorkflowTask" t ON t\.id = e\."taskId" AND t\."organizationId" = e\."organizationId"/);
  assert.match(sql.text, /"Customer" cu ON [\s\S]*cu\."organizationId" = e\."organizationId"/);
  assert.match(sql.text, /LIMIT \$\d+$/, "bounded");
  const admin = sql.values && buildSearchSql(reportSpec(access([], true))!, parsed, "org-1", 40, "match", false);
  assert.ok(["projects", "kfid", "work-order", "risk-assessment", "forms"].every((subject) => admin.values.includes(subject)), "an admin reads every area");
  assert.deepEqual(searchSpecs(access([], true), parseSearchQuery("typ:rapport kontroll")).map((spec) => spec.type), ["report"]);
  assert.ok(!searchSpecs(access([], true), parseSearchQuery("typ:ao kontroll")).some((spec) => spec.type === "report"));
});

const NOW = new Date("2026-10-12T10:00:00Z");
test("the demo has a Rapportarkiv and Sök finds its reports, by the demo user's rights", () => {
  const db = createDemoDatabase(NOW);
  const elin = db.users.find((user) => user.id === "demo-elna")!;
  const ctx = (user: typeof elin) => ({ db, user, admin: user.role === "ADMIN", can: (subject: Parameters<typeof hasWorkflowPermission>[1], action: Parameters<typeof hasWorkflowPermission>[2]) => user.role === "ADMIN" || hasWorkflowPermission(user.permissions, subject, action) });
  const all = demoReportArchive(ctx(elin), new URLSearchParams("scope=all&limit=100"));
  assert.ok(all.total >= 5 && all.items.length === all.total);
  assert.ok(all.items.every((item) => item.canDelete === false && item.filename && item.title));
  const first = demoReportArchive(ctx(elin), new URLSearchParams("scope=all&limit=2"));
  assert.equal(first.items.length, 2);
  assert.equal(first.hasMore, true);
  const next = demoReportArchive(ctx(elin), new URLSearchParams(`scope=all&limit=2&cursor=${first.items[1].id}`));
  assert.ok(next.items.every((item) => !first.items.some((seen) => seen.id === item.id)), "the next page continues");
  const filtered = demoReportArchive(ctx(elin), new URLSearchParams("scope=all&q=kontroll"));
  assert.ok(filtered.total >= 1 && filtered.items.every((item) => item.title.toLowerCase().includes("kontroll")));
  const found = searchLocalWorkspace({ customers: db.customers, customerFacilities: db.facilities, projects: db.projects, workflowTasks: db.tasks, formSchedules: [], reports: demoReportSearchItems(ctx(elin)) }, "typ:rapport kontroll", { me: elin.id, can: (subject) => ctx(elin).can(subject, "read"), local: true });
  assert.deepEqual(found.groups.map((group) => group.type), ["report"]);
  assert.ok(found.groups[0].hits[0].href.startsWith("/api/report-archive/"));
  // Someone who may read no area sees no reports, in the list or in Sök (the negative case).
  const nobody = { ...elin, role: "MEMBER" as const, permissions: noWorkflowPermissionProfile() };
  assert.equal(demoReportArchive(ctx(nobody), new URLSearchParams("scope=all")).total, 0);
  assert.equal(demoReportSearchItems(ctx(nobody)).length, 0);
});
