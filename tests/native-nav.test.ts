import assert from "node:assert/strict";
import test from "node:test";
import { resolveBackLabel, backLabelFor, backLabelForAddress, isTabRootTrail, screenParent, shortPageName, EDGE_SWIPE, flowBarModel, isEdgeSwipeBack, standardBarFor } from "../lib/workflow/native-nav";
import { monthGrid, monthStart } from "../lib/workflow/month-grid";

// Visning 1 utan flytande pilar (2026-10-12): toppfältets bakåt, kantsvepet, flödets bottenrad och månadsrutnätet.
test("edge swipe: from the left edge, more than 60 px and mostly sideways", () => {
  assert.equal(isEdgeSwipeBack({ x: 5, y: 300 }, { x: 90, y: 310 }), true);
  assert.equal(isEdgeSwipeBack({ x: EDGE_SWIPE.edge - 1, y: 300 }, { x: EDGE_SWIPE.edge + 61, y: 300 }), true);
  assert.equal(isEdgeSwipeBack({ x: EDGE_SWIPE.edge, y: 300 }, { x: 200, y: 300 }), false, "starts too far from the edge");
  assert.equal(isEdgeSwipeBack({ x: 5, y: 300 }, { x: 60, y: 300 }), false, "60 px is not enough");
  assert.equal(isEdgeSwipeBack({ x: 5, y: 300 }, { x: 100, y: 420 }), false, "a scroll, not a swipe");
  assert.equal(isEdgeSwipeBack({ x: 5, y: 300 }, { x: -50, y: 300 }), false, "wrong direction");
});

test("standard bar: title is the open page, back names the page above; home has none", () => {
  assert.equal(standardBarFor([{ label: "Översikt" }]), null);
  assert.equal(standardBarFor([]), null);
  assert.deepEqual(standardBarFor([{ label: "Översikt" }, { label: "Arbetsordrar" }]), { title: "Arbetsordrar", backLabel: "Hem" });
  assert.deepEqual(standardBarFor([{ label: "Översikt" }, { label: "Arbetsordrar" }, { label: "AO 12" }]), { title: "AO 12", backLabel: "Arbetsordrar" });
  assert.equal(backLabelFor("Jobbet", "Arbetsordrar"), "Jobbet");
  assert.equal(backLabelFor(undefined, "Arbetsordrar"), "Arbetsordrar");
  assert.equal(backLabelFor("  ", undefined), "Tillbaka");
});

test("flow bar: Föregående / Nästa: <namn> / finishing action, dots follow the position", () => {
  const steps = [{ key: "risk", label: "Risk" }, { key: "mat", label: "Mätning" }, { key: "klar", label: "Klart" }];
  const first = flowBarModel(steps, 0);
  assert.equal(first.previous, null);
  assert.equal(first.nextLabel, "Nästa: Mätning");
  assert.equal(first.isLast, false);
  assert.deepEqual(first.dots, ["current", "todo", "todo"]);
  const middle = flowBarModel(steps, 1);
  assert.equal(middle.previous?.key, "risk");
  assert.deepEqual(middle.dots, ["done", "current", "todo"]);
  assert.equal(middle.position, 2);
  const last = flowBarModel(steps, 2);
  assert.equal(last.nextLabel, null);
  assert.equal(last.isLast, true);
  assert.equal(flowBarModel(steps, 9).position, 3, "an index past the end is the last step");
  assert.equal(flowBarModel([], 0).isLast, false);
});

test("month grid: Monday first, week numbers, today and the chosen day, values per day", () => {
  assert.equal(monthStart("2026-10-12"), "2026-10-01");
  assert.equal(monthStart("2026-12-31", 1), "2027-01-01");
  assert.equal(monthStart("2026-01-15", -1), "2025-12-01");
  const grid = monthGrid({ anchor: "2026-10-12", today: "2026-10-12", selected: "2026-10-05", values: { "2026-10-05": 3600, "2026-10-31": 7200 } });
  assert.equal(grid.month, "2026-10");
  // 1 Oct 2026 is a Thursday: the first row starts Monday 28 Sep (week 40), the last ends Sunday 1 Nov.
  assert.equal(grid.weeks.length, 5);
  assert.equal(grid.weeks[0]!.days[0]!.key, "2026-09-28");
  assert.equal(grid.weeks[0]!.days[0]!.inMonth, false);
  assert.equal(grid.weeks[0]!.week, 40);
  assert.equal(grid.weeks[0]!.days[3]!.day, 1);
  assert.equal(grid.weeks.at(-1)!.days[6]!.key, "2026-11-01");
  assert.ok(grid.weeks.every((week) => week.days.length === 7));
  const flat = grid.weeks.flatMap((week) => week.days);
  assert.deepEqual(flat.filter((cell) => cell.today).map((cell) => cell.key), ["2026-10-12"]);
  assert.deepEqual(flat.filter((cell) => cell.selected).map((cell) => cell.key), ["2026-10-05"]);
  assert.equal(flat.find((cell) => cell.key === "2026-10-05")!.value, 3600);
  assert.equal(flat.find((cell) => cell.key === "2026-10-06")!.value, 0);
  // A month that starts on a Monday and ends on a Sunday is exactly four weeks (Feb 2027), one with six rows exists too.
  assert.equal(monthGrid({ anchor: "2027-02-10", today: "2027-02-10" }).weeks.length, 4);
  assert.equal(monthGrid({ anchor: "2026-08-10", today: "2026-08-10" }).weeks.length, 6);
  assert.equal(monthGrid({ anchor: "2026-01-10", today: "2026-01-10" }).weeks[0]!.week, 1, "ISO week 1 contains 1 Jan 2026 (Thursday)");
});

test("month grid helpers: short hours and the month's title", async () => {
  const { hoursShort, monthTitle } = await import("../lib/workflow/month-grid");
  assert.equal(hoursShort(0), "");
  assert.equal(hoursShort(23400), "6,5");
  assert.equal(hoursShort(28800), "8");
  assert.equal(hoursShort(60), "0,1", "a minute is never shown as nothing");
  assert.equal(monthTitle("2026-10-12"), "Oktober 2026");
});

test("back label: short names, never Översikt/Verktyg/Mina projekt; tab roots have no back", () => {
  assert.equal(shortPageName("Översikt"), "Hem");
  assert.equal(shortPageName("Verktyg"), "Mer");
  assert.equal(shortPageName("Mina projekt"), "Projekt");
  assert.equal(shortPageName("Tidrapport"), "Tid");
  // The lists are called as their menu buttons since 2026-10-23.
  assert.equal(shortPageName("Uppgifter"), "Jobb");
  assert.equal(shortPageName("Projekt"), "Projekt");
  assert.equal(isTabRootTrail([{ label: "Översikt" }, { label: "Tid" }]), true);
  assert.equal(isTabRootTrail([{ label: "Översikt" }, { label: "Uppgifter" }]), true);
  assert.equal(shortPageName("Anna Svensson"), "Anna Svensson");
  assert.equal(standardBarFor([{ label: "Översikt" }, { label: "Verktyg" }, { label: "Kundregister" }])?.backLabel, "Mer");
  assert.equal(isTabRootTrail([{ label: "Översikt" }]), true);
  assert.equal(isTabRootTrail([{ label: "Översikt" }, { label: "Tidrapport" }]), true);
  assert.equal(isTabRootTrail([{ label: "Översikt" }, { label: "Mina uppgifter" }]), true);
  assert.equal(isTabRootTrail([{ label: "Översikt" }, { label: "Mina uppgifter" }, { label: "Uppgift" }]), false);
  const labels = { stats: "Översikt", projects: "Mina projekt", tasks: "Mina uppgifter" };
  assert.equal(backLabelForAddress("/", labels), "Hem");
  assert.equal(backLabelForAddress("/?view=projects", labels), "Projekt");
  assert.equal(backLabelForAddress("/?view=tasks", labels), "Jobb");
  assert.equal(backLabelForAddress("/?view=project&projectId=p1", labels), "Projektet");
  assert.equal(backLabelForAddress("/?view=customers&customerId=c1", labels), "Kunden");
  assert.equal(backLabelForAddress("/?view=workflow_task&taskId=t1", labels), "Jobbet");
  // A work order is a job too (2026-10-14): never "Arbetsordern" beside "Jobbet".
  assert.equal(backLabelForAddress("/?view=workflow_task&taskType=WORK_ORDER&taskId=t1", labels), "Jobbet");
  assert.equal(backLabelForAddress("/?view=nope", labels), null);
  assert.equal(backLabelForAddress(null, labels), null);
});

test("back label follows the real target: the visit before, a page's own name only for its own screens", () => {
  const labels = { settings: "Inställningar", places: "Platser", help: "Hjälp" } as const;
  // Hjälp opened from Inställningar says Inställningar, not the static "Hem".
  assert.equal(resolveBackLabel({ own: "Hem", previous: "/?view=settings", here: "/?view=help", trailBack: "Hem", viewLabels: labels }), "Inställningar");
  // Plats opened from the Platser list says Platser, not "Kunden".
  assert.equal(resolveBackLabel({ own: "Kunden", previous: "/?view=places", here: "/?view=place&placeId=1", trailBack: "Kunden", viewLabels: labels }), "Platser");
  // A customer card reached after Avbryt: the visit before is Hem.
  assert.equal(resolveBackLabel({ previous: "/?view=stats", here: "/?view=customers&customerId=1", trailBack: "Kunder", viewLabels: labels }), "Hem");
  // A job's step goes back to the job: the visit before is the same page, so its own name stands.
  assert.equal(resolveBackLabel({ own: "Jobbet", previous: "/?view=workflow_task&taskId=1", here: "/?view=workflow_task&taskId=1&step=2", viewLabels: labels }), "Jobbet");
  // Nothing before: own name, then the trail, then Tillbaka.
  assert.equal(resolveBackLabel({ own: "Hem", previous: null, here: "/?view=rounds", trailBack: "Verktyg", viewLabels: labels }), "Hem");
  assert.equal(resolveBackLabel({ previous: null, here: "/?view=rounds", trailBack: "Mer", viewLabels: labels }), "Mer");
});

test("back label from the Mer sheet: Mer when Mer was opened over the page before, otherwise that page (2026-10-12)", () => {
  const labels = { notifications: "Notiser", project_planning: "Planering", self_inspection: "Egenkontroll" } as const;
  // Planering → Mer → Notiser: the sheet lay over Planering, so back says Mer (and reopens it), not "Planering".
  assert.equal(resolveBackLabel({ previous: "/?view=project_planning", here: "/?view=notifications", trailBack: "Hem", viewLabels: labels, openedFrom: "more" }), "Mer");
  // Egenkontroll → Mer → Planering likewise.
  assert.equal(resolveBackLabel({ previous: "/?view=self_inspection", here: "/?view=project_planning", trailBack: "Hem", viewLabels: labels, openedFrom: "more" }), "Mer");
  // Opened by a link or a row, not from Mer: the page before as usual.
  assert.equal(resolveBackLabel({ previous: "/?view=project_planning", here: "/?view=notifications", trailBack: "Hem", viewLabels: labels, openedFrom: null }), "Planering");
  assert.equal(resolveBackLabel({ previous: "/?view=project_planning", here: "/?view=notifications", trailBack: "Hem", viewLabels: labels }), "Planering");
  // Nothing to go back to (the page opened directly): Mer cannot be reopened, so the trail names the page above.
  assert.equal(resolveBackLabel({ previous: null, here: "/?view=notifications", trailBack: "Hem", viewLabels: labels, openedFrom: "more" }), "Hem");
});

// Toppnavigeringen (2026-10-13): a screen opened directly goes back to its page, not to the list the breadcrumb names.
test("screen parent: item → its step, step or part → the page itself, a plain page → none", () => {
  const at = (query: string) => screenParent(new URLSearchParams(query));
  assert.equal(at("view=workflow_task&taskId=t1&step=material&item=r1"), "/?view=workflow_task&taskId=t1&step=material");
  assert.equal(at("view=workflow_task&taskId=t1&step=tid"), "/?view=workflow_task&taskId=t1");
  assert.equal(at("view=workflow_task&taskId=t1&step=formular&part=2"), "/?view=workflow_task&taskId=t1");
  assert.equal(at("view=calculators&tool=effekt&part=2"), "/?view=calculators&tool=effekt");
  assert.equal(at("view=projects"), null);
});
