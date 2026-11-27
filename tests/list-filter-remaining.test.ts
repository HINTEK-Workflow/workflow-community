import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { COMPANY_FILTERS, companyMatchesFilter, listCustomerCompanies } from "../lib/kfid/customer-company-list";
import { emptyPlaceRegisterFilter, listPlaceRegister, placeRegisterCounts, placeStateLevel } from "../lib/workflow/place-register";
import { archivePeriodRange, archiveQuery } from "../lib/workflow/report-archive";
import { breadcrumbTrail } from "../lib/workflow/navigation";
import { LIST_SORT_LABEL } from "../lib/list-filter";

const text = (file: string) => readFileSync(file, "utf8");

// Den gemensamma toppvisningen på resterande listor (2026-10-31): Kunder, Platser, Kundföretag och Rapportarkiv.
test("every remaining list draws the shared ListFilterBar with the sort and Rader | Kort", () => {
  for (const file of ["features/kfid/customer-register-layout.tsx", "features/workflow/place-register.tsx", "features/kfid/customer-companies.tsx", "features/workflow/report-archive.tsx"]) {
    const source = text(file);
    assert.match(source, /<ListFilterBar/, file);
    assert.match(source, /sort=\{/, `${file} has the sort`);
    assert.match(source, /view=\{/, `${file} has Rader | Kort`);
    assert.match(source, /<ListCard(Grid)?\b|<PlaceCardGrid/, `${file} has the cards`);
    assert.doesNotMatch(source, /<ListToolbar/, `${file} has no toolbar of its own`);
  }
  assert.equal(LIST_SORT_LABEL.title, "Namn A–Ö");
  assert.equal(LIST_SORT_LABEL.updated, "Senast ändrad");
});

test("the chips of a list read a page at a time count on the server, not the page", () => {
  const records = text("lib/kfid/records.ts");
  assert.match(records, /SELECT "customerType"::text AS type, COUNT\(\*\)::int AS total FROM "Customer" WHERE \$\{everyType\} GROUP BY 1/);
  assert.match(records, /"organizationId"=\$\{ctx\.organizationId\}/, "the customers' counts stay in the company");
  const places = text("lib/kfid/place-server.ts");
  assert.match(places, /groupBy\(\{ by: \["operatingState"\], where: whereFor\(/);
  assert.match(places, /const whereFor = [\s\S]*?organizationId: ctx\.organizationId,/, "the places' counts stay in the company");
  const archive = text("lib/workflow/report-archive-server.ts");
  assert.match(archive, /groupBy\(\{ by: \["format"\], where: everyFormat/);
  assert.match(archive, /const everyFormat = \{\s*organizationId: ctx\.organizationId, subject: \{ in: subjects \}/, "the reports' counts follow the company and the areas the person may read");
  // A person without Kunder gets the picker's answer, never the register's counts.
  assert.match(text("app/api/records/route.ts"), /limit: 100, counts: undefined/);
});

test("Platser: the chips count every place that matches, with the same rules as the list", () => {
  const places = [
    { id: "f1", customerId: "c", name: "Fabrik", isActive: true, parentId: null, kind: "FACILITY" },
    { id: "o1", customerId: "c", name: "Pump", isActive: true, parentId: "f1", kind: "OBJECT", operatingState: "IN_SERVICE" },
    { id: "o2", customerId: "c", name: "Fläkt", isActive: true, parentId: "f1", kind: "OBJECT", operatingState: "OUT_OF_SERVICE" },
    ...Array.from({ length: 30 }, (_, index) => ({ id: `n${index}`, customerId: "c", name: `Motor ${index}`, isActive: true, parentId: "f1", kind: "OBJECT", operatingState: "IN_SERVICE" })),
  ] as Parameters<typeof listPlaceRegister>[0];
  const filter = { ...emptyPlaceRegisterFilter(), level: "objects" as const };
  const counts = placeRegisterCounts(places, filter);
  assert.equal(listPlaceRegister(places, filter).items.length, 12, "the page read");
  assert.equal(counts.level.objects, 32, "the chip counts them all, not the page");
  assert.equal(counts.level.top, 1);
  assert.equal(counts.level.all, 33);
  assert.equal(counts.state.all, 32);
  assert.equal(counts.state.IN_SERVICE, 31);
  assert.equal(counts.state.OUT_OF_SERVICE, 1);
  // Choosing a driftstatus on the top level shows every level, so its chip counts that.
  assert.equal(placeStateLevel("top"), "all");
  assert.equal(placeRegisterCounts(places, emptyPlaceRegisterFilter()).state.IN_SERVICE, 31);
  assert.equal(placeRegisterCounts(places, emptyPlaceRegisterFilter()).state.all, 1, "Alla keeps the chosen level");
  // Senast ändrad, newest first; without a time by name.
  const dated = [{ id: "a", customerId: "c", name: "A", isActive: true, updatedAt: "2026-10-01T00:00:00Z" }, { id: "b", customerId: "c", name: "B", isActive: true, updatedAt: "2026-10-05T00:00:00Z" }] as Parameters<typeof listPlaceRegister>[0];
  assert.deepEqual(listPlaceRegister(dated, { ...emptyPlaceRegisterFilter(), sort: "updated" }).items.map((item) => item.place.id), ["b", "a"]);
});

test("Kundföretag: chips, search and sort on the list that was read", () => {
  const companies = [
    { name: "Beta AB", isActive: true, organizationNumber: "556", contactName: "Eva", contactEmail: "eva@x", updatedAt: "2026-10-01T00:00:00Z" },
    { name: "Alfa AB", isActive: false, organizationNumber: "", contactName: "", contactEmail: "", updatedAt: "2026-10-03T00:00:00Z" },
  ];
  const all = listCustomerCompanies(companies, { filter: "all", sort: "title", q: "" });
  assert.deepEqual(all.items.map((item) => item.name), ["Alfa AB", "Beta AB"]);
  assert.deepEqual(all.counts, { all: 2, active: 1, paused: 1 });
  assert.deepEqual(listCustomerCompanies(companies, { filter: "paused", sort: "title", q: "" }).items.map((item) => item.name), ["Alfa AB"]);
  assert.deepEqual(listCustomerCompanies(companies, { filter: "all", sort: "updated", q: "" }).items.map((item) => item.name), ["Alfa AB", "Beta AB"]);
  const searched = listCustomerCompanies(companies, { filter: "all", sort: "title", q: "eva" });
  assert.deepEqual(searched.counts, { all: 1, active: 1, paused: 0 }, "the chips count what the search found");
  assert.deepEqual(COMPANY_FILTERS.filter((filter) => companyMatchesFilter({ isActive: false }, filter)), ["all", "paused"]);
});

test("Kundföretag: a company is its own page in the address, with Radera last", () => {
  const trail = breadcrumbTrail({ view: "customer_companies", params: { companyId: "c1" }, labels: { company: "Beta AB" } });
  assert.deepEqual(trail.map((crumb) => crumb.label), ["Översikt", "Installation", "Kundföretag", "Beta AB"]);
  assert.equal(trail.at(-2)?.href, "/?view=customer_companies");
  assert.deepEqual(breadcrumbTrail({ view: "customer_companies" }).map((crumb) => crumb.label), ["Översikt", "Installation", "Kundföretag"]);
  const page = text("features/kfid/customer-companies.tsx");
  assert.match(page, /data-testid="company-page"[\s\S]*data-testid="company-danger-zone"/, "the danger zone comes after the cards");
  assert.doesNotMatch(page, /aria-expanded=\{expandedId/, "no menu folded out in the list");
});

test("Rapportarkiv: the filters from the address, never anything unknown, and the periods in Swedish time", () => {
  const query = archiveQuery(new URLSearchParams("format=XLSX&kind=FORM&period=last-month&sort=title"));
  assert.deepEqual([query.format, query.kind, query.period, query.sort], ["XLSX", "FORM", "last-month", "title"]);
  const unknown = archiveQuery(new URLSearchParams("format=DOCX&kind=x&period=y&sort=z"));
  assert.deepEqual([unknown.format, unknown.kind, unknown.period, unknown.sort], ["all", "all", "all", "updated"]);
  const now = new Date("2026-01-15T12:00:00Z");
  assert.deepEqual(archivePeriodRange("all", now), {});
  assert.equal(archivePeriodRange("this-month", now).from?.toISOString(), "2025-12-31T23:00:00.000Z");
  const last = archivePeriodRange("last-month", now);
  assert.equal(last.from?.toISOString(), "2025-11-30T23:00:00.000Z", "December of the year before");
  assert.equal(last.before?.toISOString(), "2025-12-31T23:00:00.000Z");
  assert.equal(archivePeriodRange("this-year", new Date("2026-07-01T12:00:00Z")).from?.toISOString(), "2025-12-31T23:00:00.000Z");
});
