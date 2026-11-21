import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { compactText, editDistance, foldText, SEARCH_FOLD_FROM, SEARCH_FOLD_TO, tokenize } from "../lib/search/normalize";
import { parseSearchQuery, searchTooShort } from "../lib/search/query";
import { synonymsFor, vocabularyCorrections } from "../lib/search/synonyms";
import { highlightRanges, rankCandidates, scoreCandidate } from "../lib/search/score";
import { commandCandidates, type SearchAccess } from "../lib/search/commands";
import { customerCandidate, invoiceBasisCandidate, placeCandidate, projectCandidate, quoteCandidate, taskCandidate } from "../lib/search/candidates";
import { searchLocalWorkspace, type LocalSearchData } from "../lib/search/local";
import { buildSearchSql, searchSpecs } from "../lib/search/sql";
import { defaultWorkflowPermissionProfile, noWorkflowPermissionProfile } from "../lib/workflow/permissions";

const NOW = Date.parse("2026-10-05T12:00:00Z");

test("folding: case and Swedish diacritics, one character for one (2026-10-05)", () => {
  assert.equal(foldText("Åsa ÖSTLUND Élcentral"), "asa ostlund elcentral");
  assert.equal(foldText("Måleriet").length, "Måleriet".length);
  assert.equal(compactText(foldText("E-12")), "e12");
  assert.equal(compactText("070-123 45 67"), "0701234567");
  assert.deepEqual(tokenize(foldText("  #123, E-12;  kabel. ")), ["123", "e-12", "kabel"]);
});

test("the SQL function search_fold() folds exactly like the browser", () => {
  const migration = readFileSync(new URL("../prisma/migrations/20261005160000_search_indexes/migration.sql", import.meta.url), "utf8");
  assert.ok(migration.includes(`translate(lower(value), '${SEARCH_FOLD_FROM}', '${SEARCH_FOLD_TO}')`));
  assert.equal(SEARCH_FOLD_FROM.length, SEARCH_FOLD_TO.length);
  assert.ok(migration.includes("CREATE EXTENSION IF NOT EXISTS pg_trgm"), "pg_trgm is optional and tried");
  assert.match(migration, /EXCEPTION WHEN OTHERS/, "a database without pg_trgm still migrates");
});

test("edit distance counts a swapped pair as one error and stops early", () => {
  assert.equal(editDistance("jordflesbrytare", "jordfelsbrytare", 2), 1);
  assert.equal(editDistance("kabel", "kabel", 1), 0);
  assert.equal(editDistance("abc", "xyzuvw", 1), 2);
});

test("query: words in any order, stopwords, filters, ids from links and QR labels", () => {
  const parsed = parseSearchQuery("Kund:\"Volvo Cars\" plats:E12 status:pågår typ:ao pump och kabel");
  assert.deepEqual(parsed.terms.map((term) => term.text), ["pump", "kabel"]);
  assert.equal(parsed.filters.customer, "volvo cars");
  assert.equal(parsed.filters.place, "e12");
  assert.equal(parsed.filters.status, "in_progress");
  assert.deepEqual(parsed.filters.types, ["task"]);
  assert.deepEqual(parsed.filters.taskKinds, ["WORK_ORDER"]);
  assert.equal(parsed.filterLabels.length, 4);
  const link = parseSearchQuery("https://workflow.example.invalid/p/cmg1abcdefghijklmnopqrstu");
  assert.deepEqual(link.ids, ["cmg1abcdefghijklmnopqrstu"]);
  assert.equal(link.terms.length, 0);
  assert.equal(link.active, true);
  assert.equal(searchTooShort(parseSearchQuery("a")), true);
  assert.equal(searchTooShort(parseSearchQuery("e1")), false);
  // An unknown filter value is searched for as text.
  assert.deepEqual(parseSearchQuery("typ:okänd").terms.map((term) => term.text), ["okand"]);
});

test("synonyms: abbreviations both ways, whole words only, and misspelt trade words", () => {
  assert.ok(synonymsFor("ao").includes("arbetsorder"));
  assert.ok(synonymsFor("jordfelsbrytare").includes("jfb"));
  assert.ok(synonymsFor("jordfel").includes("jfb"), "the start of a long word is enough");
  assert.ok(synonymsFor("kfid").includes("kontroll fore idrifttagning"));
  assert.ok(synonymsFor("isol").includes("isolationsmatning"));
  const ao = parseSearchQuery("ao").terms[0];
  assert.equal(ao.alternatives.find((alternative) => alternative.text === "ao")?.mode, "wordPrefix");
  assert.equal(parseSearchQuery("jordfelsbrytare").terms[0].alternatives.find((alternative) => alternative.text === "jfb")?.mode, "word");
  assert.ok(vocabularyCorrections("jordflesbrytare").includes("jfb"));
  assert.deepEqual(vocabularyCorrections("pump"), []);
});

const task = (values: Partial<Parameters<typeof taskCandidate>[0]> = {}) => taskCandidate({ id: "t1", kind: "WORK_ORDER", title: "Byte av JFB i elcentral", status: "IN_PROGRESS", description: "", assignedToName: "Bertil", updatedAt: new Date(NOW), ...values }, "me");

test("scoring: every word must match; title before codes before names before long text", () => {
  const parsed = parseSearchQuery("elcentral jfb");
  assert.ok(scoreCandidate(parsed, task(), NOW));
  assert.equal(scoreCandidate(parseSearchQuery("elcentral pump"), task(), NOW), null, "a missing word excludes the record");
  const titleHit = scoreCandidate(parseSearchQuery("pump"), task({ title: "Pump" }), NOW)!;
  const bodyHit = scoreCandidate(parseSearchQuery("pump"), task({ title: "Service", description: "byt pump" }), NOW)!;
  assert.ok(titleHit.score > bodyHit.score);
  assert.equal(bodyHit.why, "Beskrivning", "says where it matched when it is not visible");
  const exact = scoreCandidate(parseSearchQuery("pump"), task({ title: "Pump" }), NOW)!;
  const prefix = scoreCandidate(parseSearchQuery("pump"), task({ title: "Pumpstation" }), NOW)!;
  const inside = scoreCandidate(parseSearchQuery("pump"), task({ title: "Värmepump" }), NOW)!;
  assert.ok(exact.score > prefix.score && prefix.score > inside.score);
});

test("scoring: Swedish letters, abbreviations, numbers and markings without separators", () => {
  assert.ok(scoreCandidate(parseSearchQuery("maleriet"), task({ title: "Måleriet linje 3" }), NOW));
  assert.ok(scoreCandidate(parseSearchQuery("jordfelsbrytare"), task(), NOW), "JFB in the title answers jordfelsbrytare");
  assert.equal(scoreCandidate(parseSearchQuery("ao"), task({ title: "Kaos i centralen", kind: "RISK_ASSESSMENT" }), NOW), null, "ao never matches inside a word");
  assert.ok(scoreCandidate(parseSearchQuery("ao"), task({ title: "Pump" }), NOW), "AO finds a work order by its type");
  const place = placeCandidate({ id: "p1", customerId: "c1", name: "Elcentral E-12", kind: "OBJECT", isActive: true, parentPath: "Volvo Cars › Torslandaverken › Måleriet" }, false);
  assert.ok(scoreCandidate(parseSearchQuery("elcentral"), place, NOW));
  assert.ok(scoreCandidate(parseSearchQuery("torslanda"), place, NOW), "the whole way above the place counts");
  const customer = customerCandidate({ id: "c1", name: "Volvo Cars", phone: "031-123 45 67" });
  assert.equal(scoreCandidate(parseSearchQuery("0311234567"), customer, NOW)?.why, "Telefon");
});

test("scoring: typing errors are found in titles, with a lower score and marked", () => {
  const typo = scoreCandidate(parseSearchQuery("tosrlanda"), task({ title: "Torslanda service" }), NOW);
  assert.ok(typo?.fuzzy);
  const right = scoreCandidate(parseSearchQuery("torslanda"), task({ title: "Torslanda service" }), NOW)!;
  assert.ok(right.score > typo!.score);
  assert.equal(scoreCandidate(parseSearchQuery("1235"), task({ title: "Order 1234" }), NOW), null, "numbers are never guessed");
  assert.ok(scoreCandidate(parseSearchQuery("jordflesbrytare"), task(), NOW)?.fuzzy, "a misspelt trade word finds its abbreviation");
});

test("ranking: own, open and recent work first; archived last; groups with counts", () => {
  const old = new Date(NOW - 400 * 86_400_000);
  const candidates = [
    projectCandidate({ id: "a", name: "Pump Norr", archivedAt: old, updatedAt: old }, "me"),
    projectCandidate({ id: "b", name: "Pump Syd", updatedAt: new Date(NOW), responsibleUserId: "me" }, "me"),
    task({ id: "c", title: "Pump" }),
  ];
  const result = rankCandidates(parseSearchQuery("pump"), candidates, { now: NOW, totals: { project: { total: 12, fetched: 2 } } });
  const projects = result.groups.find((group) => group.type === "project")!;
  assert.deepEqual(projects.hits.map((hit) => hit.id), ["b", "a"]);
  assert.equal(projects.count, 12);
  assert.equal(projects.more, true);
  assert.equal(result.groups[0].type, "task", "the exact title match leads");
});

test("filters keep only matching records", () => {
  const parsed = parseSearchQuery("kund:volvo status:klar");
  assert.ok(scoreCandidate(parsed, task({ customerName: "Volvo Cars", status: "COMPLETED" }), NOW));
  assert.equal(scoreCandidate(parsed, task({ customerName: "Volvo Cars" }), NOW), null);
  assert.equal(scoreCandidate(parsed, task({ customerName: "Scania", status: "COMPLETED" }), NOW), null);
});

test("highlighting marks the matched words in the original text", () => {
  const text = "Byte av JFB i Måleriet";
  const ranges = highlightRanges(text, parseSearchQuery("jordfelsbrytare maleri"));
  assert.deepEqual(ranges.map(([start, end]) => text.slice(start, end)), ["JFB", "Måleri"]);
});

const access = (values: Partial<SearchAccess> = {}): SearchAccess => ({ admin: false, superadmin: false, local: false, canBuildForms: false, can: () => false, features: { credits: false, billing: false, ai: false, integrations: true, landingEditor: false, import: false }, ...values });
test("pages: only those the person can use, found by their words", () => {
  const member = commandCandidates(access({ can: (subject, action) => subject === "work-order" && (action === "read" || action === "create") }));
  assert.ok(member.some((command) => command.title === "Ny arbetsorder"));
  assert.ok(!member.some((command) => command.title === "Användare och behörighet"));
  assert.ok(!member.some((command) => command.title === "Priser och offert"));
  assert.ok(!member.some((command) => command.title === "Företaget"));
  assert.ok(!member.some((command) => command.title === "Workflow AI"), "a member has no Workflow AI tab (2026-10-07)");
  const admin = commandCandidates(access({ admin: true, features: { credits: true, billing: true, ai: true, integrations: true, landingEditor: false, import: false } }));
  assert.ok(admin.some((command) => command.title === "Abonnemang"));
  assert.equal(admin.find((command) => command.title === "Priser och offert")?.href, "/?view=company_features&section=prices");
  assert.equal(admin.find((command) => command.title === "Arbetssätt")?.href, "/?view=company_features");
  // One page per tab (2026-10-15): the company's keys are Kopplingar och nycklar; a part of a page is ?section=<part>.
  assert.equal(admin.find((command) => command.title === "Kopplingar")?.href, "/?view=advanced");
  assert.equal(admin.find((command) => command.title === "Workflow AI")?.href, "/?view=company_features&section=ai");
  assert.equal(admin.find((command) => command.title === "Historik och lagring")?.href, "/?view=company&section=history");
  assert.ok(!member.some((command) => command.title === "Kundföretag"));
  // The page's own name (2026-11-20; "Installation" before), and the old word still finds it.
  const superadmin = commandCandidates(access({ admin: true, superadmin: true }));
  assert.equal(superadmin.find((command) => command.title === "Kundföretag")?.href, "/?view=customer_companies");
  assert.ok(!superadmin.some((command) => command.title === "Installation"));
  assert.equal(rankCandidates(parseSearchQuery("produktadministration"), superadmin, { now: NOW }).groups.flatMap((group) => group.hits).some((hit) => hit.title === "Kundföretag"), true);
  const ranked = rankCandidates(parseSearchQuery("tidrapport"), member, { now: NOW });
  // The page is called as its menu button, Tid (2026-10-23); the old word still finds it.
  assert.equal(ranked.groups[0]?.hits[0]?.title, "Tid");
  assert.equal(rankCandidates(parseSearchQuery("ny ao"), member, { now: NOW }).groups[0]?.hits[0]?.title, "Ny arbetsorder");
});

const data: LocalSearchData = {
  customers: [{ id: "c1", name: "Volvo Cars", company: "Volvo Cars AB", city: "Göteborg" }, { id: "c2", name: "Borttagen", deletedAt: "2026-01-01T00:00:00Z" }],
  customerFacilities: [
    { id: "f1", customerId: "c1", name: "Torslandaverken", kind: "FACILITY", isActive: true },
    { id: "f2", customerId: "c1", parentId: "f1", name: "Måleriet", kind: "BUILDING", isActive: true },
    { id: "f3", customerId: "c1", parentId: "f2", name: "Elcentral E12", kind: "OBJECT", isActive: true },
  ],
  projects: [{ id: "p1", name: "Ombyggnad", customerId: "c1", facilityId: "f1" }],
  workflowTasks: [
    { id: "t1", kind: "WORK_ORDER", title: "Byte av brytare", status: "PLANNED", facilityId: "f3", customerId: "c1", data: { kind: "WORK_ORDER", details: { executionNotes: "Isolationsmätning gjord" } } },
    { id: "t2", kind: "FORM", formArea: "kfid", title: "Protokoll", status: "PLANNED", data: { kind: "FORM", details: { templateName: "Kontroll före idrifttagning", document: { label: "mallord" }, values: {} } } },
  ],
};

test("Local: the same search over the open file, with the whole place way and the answers", () => {
  const torslanda = searchLocalWorkspace(data, "torslanda", { now: NOW });
  const places = torslanda.groups.find((group) => group.type === "place")!;
  assert.equal(places.count, 3);
  assert.equal(places.hits.find((hit) => hit.id === "f3")?.subtitle, "Objekt · Volvo Cars AB › Torslandaverken › Måleriet");
  assert.equal(places.hits[0].href, "/?view=customers&customerId=c1", "Local opens the customer card");
  assert.ok(torslanda.groups.some((group) => group.type === "task" && group.hits[0].id === "t1"), "a task at a place below is found by the place");
  assert.equal(searchLocalWorkspace(data, "isolationsmatning", { now: NOW }).groups[0]?.hits[0]?.why, "Innehåll");
  assert.equal(searchLocalWorkspace(data, "mallord", { now: NOW }).groups.length, 0, "the form's own copy is not searched");
  assert.equal(searchLocalWorkspace(data, "kfid", { now: NOW }).groups[0]?.hits[0]?.id, "t2");
  assert.equal(searchLocalWorkspace(data, "borttagen", { now: NOW }).groups.length, 0, "removed customers are not found");
});

test("Local and demo follow the person's rights", () => {
  const onlyWorkOrders = searchLocalWorkspace(data, "protokoll", { now: NOW, can: (subject) => subject === "work-order" });
  assert.equal(onlyWorkOrders.groups.length, 0, "a protocol needs its form area's read right");
  const noProjects = searchLocalWorkspace(data, "ombyggnad", { now: NOW, can: () => false });
  assert.ok(!noProjects.groups.some((group) => group.type === "project"));
});

test("a task is found by the title of the work order it belongs to, only with the right to read work orders (Fas 4B)", () => {
  const linked: LocalSearchData = { ...data, workflowTasks: [...data.workflowTasks, { id: "t3", kind: "FORM", formArea: "forms", title: "Egenkontroll", status: "PLANNED", workOrderId: "t1", data: { kind: "FORM", details: { templateName: "Egenkontroll", values: {} } } }] };
  const hits = searchLocalWorkspace(linked, "brytare", { now: NOW }).groups.find((group) => group.type === "task")!.hits;
  assert.deepEqual(hits.map((hit) => hit.id).sort(), ["t1", "t3"]);
  assert.equal(hits.find((hit) => hit.id === "t3")?.why, "Hör till arbetsorder");
  const noWorkOrders = searchLocalWorkspace(linked, "brytare", { now: NOW, can: (subject) => subject === "forms" });
  assert.equal(noWorkOrders.groups.length, 0, "the work order's title is not searched without the right to read work orders");
  const parsed = parseSearchQuery("brytare");
  const reader = { organizationId: "org-1", userId: "u1", admin: false, workflowPermissions: { version: 1 as const, grants: ["work-order:read" as const, "forms:read" as const] } };
  const formsOnly = { ...reader, workflowPermissions: { version: 1 as const, grants: ["forms:read" as const] } };
  const sqlOf = (access: typeof reader) => sqlText(buildSearchSql(searchSpecs(access, parsed).find((spec) => spec.type === "task")!, parsed, "org-1", 40, "match", false));
  assert.match(sqlOf(reader), /LEFT JOIN "WorkflowTask" wo ON wo\.id = t\."workOrderId" AND wo\."organizationId" = t\."organizationId"/);
  assert.doesNotMatch(sqlOf(formsOnly), /"WorkflowTask" wo/);
});

const sqlText = (sql: Prisma.Sql) => sql.text;
test("Cloud SQL: always inside the company, and only the kinds the person may read", () => {
  const parsed = parseSearchQuery("torslanda");
  const member = { organizationId: "org-1", userId: "u1", admin: false, workflowPermissions: { version: 1 as const, grants: ["work-order:read" as const] } };
  const types = searchSpecs(member, parsed).map((spec) => spec.type);
  assert.deepEqual(types, ["task", "report", "deviation"], "no projects, customers, places, rounds, machines or people without the right");
  // Beslut 10 (2026-11-01): the register is searched only with Kunder, whoever has a job somewhere.
  assert.deepEqual(searchSpecs({ ...member, workflowPermissions: { version: 1 as const, grants: ["customers:read" as const] } }, parsed).map((spec) => spec.type), ["customer", "place", "deviation"]);
  for (const spec of searchSpecs(member, parsed)) {
    const sql = buildSearchSql(spec, parsed, "org-1", 40, "match", false);
    assert.ok(sql.values.includes("org-1"), `${spec.type} is limited to the company`);
    assert.match(sqlText(sql), /"organizationId" = \$\d+/);
    assert.match(sqlText(sql), /LIMIT \$\d+$/);
  }
  const task = searchSpecs(member, parsed).find((spec) => spec.type === "task")!;
  assert.match(sqlText(buildSearchSql(task, parsed, "org-1", 40, "match", false)), /"t"\.kind in \(\$\d+\)/, "the readable task kinds are in the query");
  const none = { ...member, workflowPermissions: noWorkflowPermissionProfile() };
  assert.deepEqual(searchSpecs(none, parsed).map((spec) => spec.type), ["deviation"]);
  // Avvikelser and Maskiner (N16): the log's own read rule in the query, and Underhåll's right.
  const deviationSql = (who: Parameters<typeof searchSpecs>[0]) => buildSearchSql(searchSpecs(who, parsed).find((spec) => spec.type === "deviation")!, parsed, "org-1", 40, "match", false);
  assert.match(sqlText(deviationSql(none)), /"reportedById" = \$\d+ OR d\."responsibleUserId" = \$\d+/, "open types: reported by or answered for by the person");
  assert.ok(deviationSql(none).values.includes("u1"));
  assert.match(sqlText(deviationSql(none)), /AND d\."reportedById" = \$\d+\)\)/, "incidents without Teamet: only the person's own");
  assert.doesNotMatch(sqlText(deviationSql({ ...member, workflowPermissions: { version: 1 as const, grants: ["team:read" as const] } })), /AND d\."reportedById" = \$\d+\)\)/, "with Teamet: every incident");
  assert.ok(searchSpecs({ ...member, workflowPermissions: { version: 1 as const, grants: ["maintenance:read" as const] } }, parsed).some((spec) => spec.type === "machine"));
  const admin = { ...member, admin: true, workflowPermissions: defaultWorkflowPermissionProfile() };
  assert.deepEqual(searchSpecs(admin, parsed).map((spec) => spec.type), ["task", "report", "project", "quote", "invoice_basis", "customer", "place", "round", "deviation", "machine", "person"]);
  assert.deepEqual(searchSpecs(admin, parseSearchQuery("typ:kund volvo")).map((spec) => spec.type), ["customer"]);
  // Offerter (2026-10-09): only with the right Offerter – the latest version, inside the company.
  const quoteReader = { ...member, workflowPermissions: { version: 1 as const, grants: ["quotes:read" as const] } };
  assert.deepEqual(searchSpecs(quoteReader, parsed).map((spec) => spec.type), ["quote", "invoice_basis", "deviation"]);
  const quotes = searchSpecs(quoteReader, parseSearchQuery("offert central")).find((spec) => spec.type === "quote")!;
  assert.match(sqlText(buildSearchSql(quotes, parseSearchQuery("offert central"), "org-1", 40, "match", false)), /"supersededAt" IS NULL/);
  // Fakturaunderlag (simulation 0.6.3): with Offerter, and only where the job – or, with the project right, the project – may be read.
  const bases = sqlText(buildSearchSql(searchSpecs(quoteReader, parsed).find((spec) => spec.type === "invoice_basis")!, parsed, "org-1", 40, "match", false));
  assert.match(bases, /"InvoiceBasis" b/);
  assert.ok(bases.includes(`b."taskId" IS NULL OR (t.id IS NOT NULL AND false)`), "no readable task kinds: no job's basis");
  assert.ok(bases.includes(`b."projectId" IS NULL`), "without the project right no project's basis");
  const adminBases = sqlText(buildSearchSql(searchSpecs(admin, parsed).find((spec) => spec.type === "invoice_basis")!, parsed, "org-1", 40, "match", false));
  assert.ok(adminBases.includes(`"t".kind in (`), "the readable task kinds decide a job's basis");
  assert.ok(!adminBases.includes(`b."projectId" IS NULL)`) && adminBases.includes(`(b."taskId" IS NOT NULL OR b."projectId" IS NOT NULL)`));
  assert.ok(!searchSpecs(member, parsed).some((spec) => spec.type === "invoice_basis"), "never without the right Offerter");
});

test("an invoice basis is found by its number and opens its job or project", () => {
  const job = invoiceBasisCandidate({ id: "b1", number: 2, title: "Fakturaunderlag Villa Ek", status: "INVOICED", taskId: "t1", taskKind: "WORK_ORDER", taskTitle: "Laddbox", customerName: "Per Ek" }, null);
  assert.equal(job.href, "/?view=workflow_task&taskId=t1&taskType=WORK_ORDER");
  assert.equal(job.subtitle, "F-0002 · Fakturerat · Per Ek · Laddbox");
  assert.equal(job.state, "done");
  for (const query of ["F-0002", "f0002", "fakturaunderlag laddbox"]) assert.ok(scoreCandidate(parseSearchQuery(query), job), query);
  const project = invoiceBasisCandidate({ id: "b2", number: 13, title: "", status: "DRAFT", projectId: "p 1", projectName: "Kontor" }, null);
  assert.equal(project.href, "/?view=project&projectId=p%201");
  assert.equal(project.title, "F-0013", "a basis without a title is named by its number");
  assert.equal(project.state, "open");
  // A quote's number without its dash.
  assert.ok(scoreCandidate(parseSearchQuery("o0021"), quoteCandidate({ id: "q", number: 21, version: 1, title: "Laddbox", status: "ACCEPTED" }, null)));
});

test("Cloud SQL: words are parameters, never SQL text", () => {
  const parsed = parseSearchQuery("x'; drop table \"User\"; -- 10%_0");
  const admin = { organizationId: "org-1", userId: "u1", admin: true, workflowPermissions: defaultWorkflowPermissionProfile() };
  for (const spec of searchSpecs(admin, parsed)) {
    for (const mode of ["match", "typo"] as const) {
      const sql = buildSearchSql(spec, parsed, "org-1", 40, mode, true);
      assert.ok(!sqlText(sql).includes("drop table"), `${spec.type} ${mode}`);
    }
  }
  const values = buildSearchSql(searchSpecs(admin, parsed)[0], parsed, "org-1", 40, "match", false).values;
  assert.ok(values.some((value) => value === "%10\\%\\_0%"), "LIKE wildcards in the query are escaped");
});

test("pages: gräns, gränsvärde and gränsprofil find the company's limit values (N5)", () => {
  const commands = commandCandidates(access({ admin: true, features: { credits: true, billing: true, ai: true, integrations: true, landingEditor: false, import: false } }));
  for (const query of ["gräns", "gränsvärde", "gränsvärden", "gränsprofil"]) {
    const titles = rankCandidates(parseSearchQuery(query), commands, { now: NOW }).groups.flatMap((group) => group.hits.map((hit) => hit.title));
    assert.ok(titles.includes("Värden och referenser"), `"${query}" finds it`);
  }
});

// The objective analysis 2026-10-24 (webbplatskartan's "gamla adresser"): the search opens a page by its own address,
// never by an older one that only lands on a part of another tab (?view=ai_admin → Priser, ?view=mail_settings → Tjänster och nycklar).
test("pages: the search uses each page's own address, not an older one", async () => {
  const { settingsPlace } = await import("../lib/workflow/settings-tabs");
  const everything = commandCandidates(access({ admin: true, superadmin: true, canBuildForms: true, can: () => true, features: { credits: true, billing: true, ai: true, integrations: true, landingEditor: true, import: true } }));
  for (const command of everything) {
    const view = new URL(command.href, "http://x").searchParams.get("view") ?? "";
    // An older address is one of a tab's aliases (lib/workflow/settings-tabs.ts); a tab's own pages are not.
    // Värden och referenser keeps a page of its own under Arbetssätt (UX-granskningen C2, 2026-10-22).
    const place = view === "company_values" ? null : settingsPlace(view);
    assert.ok(!place?.tab.aliases || !(view in place.tab.aliases), `${command.title}: ${command.href} is an older address of ${place?.tab.key}`);
  }
  assert.equal(everything.find((command) => command.title === "AI-kostnad")?.href, "/?view=pricing_admin&section=ai");
  assert.equal(everything.find((command) => command.title === "E-postserver (SMTP)")?.href, "/?view=server_keys&section=keys-email");
  const withoutBilling = commandCandidates(access({ superadmin: true, features: { credits: false, billing: false, ai: true, integrations: true, landingEditor: false, import: false } }));
  assert.equal(withoutBilling.filter((command) => command.title === "AI-kostnad").map((command) => command.href).join(), "/?view=ai_admin", "without Priser, AI-kostnad is a tab of its own");
});
