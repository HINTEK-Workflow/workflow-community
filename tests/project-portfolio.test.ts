import assert from "node:assert/strict";
import test from "node:test";
import { sortPortfolio, summarizePortfolio, type PortfolioBooking, type PortfolioJob, type PortfolioProjectInput } from "../lib/workflow/project-portfolio";
import { effectiveStartDate, jobObstacle } from "../lib/workflow/planning-adapters";
import { summarizeProjectStatus } from "../lib/workflow/project-status";
import { MENU_HIDEABLE, menuKeyOfView, projectPageAllowed, resolveMenu } from "../lib/workflow/menu-items";
import { noWorkflowPermissionProfile, workflowPermissionPresets } from "../lib/workflow/permissions";
import { breadcrumbTrail, VIEW_LABEL } from "../lib/workflow/navigation";

// Projektportföljen (plan 1M, 2026-10-11).
const NOW = new Date("2026-10-12T09:00:00+02:00");
const job = (id: string, extra: Partial<PortfolioJob> = {}): PortfolioJob => ({
  id, title: `Jobb ${id}`, kind: "WORK_ORDER", status: "IN_PROGRESS", progress: 50, dueDate: "2026-10-30", plannedStartDate: "2026-10-05", createdAt: "2026-10-01T08:00:00Z",
  estimatedMinutes: 480, totalDurationSec: 3600, obstacle: null, ...extra,
});
const booking = (id: string, extra: Partial<PortfolioBooking> = {}): PortfolioBooking => ({
  id, title: `Bokning ${id}`, kind: "TASK", status: "PLANNED", startsAt: "2026-10-13T06:00:00Z", endsAt: "2026-10-13T14:00:00Z", assignedToUserId: "u1", projectId: "p", workflowTaskId: "a", assignments: [], ...extra,
});
const project = (id: string, extra: Partial<PortfolioProjectInput> = {}): PortfolioProjectInput => {
  const jobs = extra.jobs ?? [job("a")];
  const startDate = extra.startDate ?? "2026-10-01";
  const dueDate = extra.dueDate ?? "2026-11-15";
  return {
    id, name: `Projekt ${id}`, customerName: "Kund AB", responsibleName: "Elis", startDate, dueDate, timeBudgetMinutes: 2400, quotedMinutes: 1200,
    status: summarizeProjectStatus({ startDate, dueDate, tasks: jobs, now: NOW }), jobs, bookings: [], ...extra,
  };
};

test("portfolio: one row per project with the project page's figures", () => {
  const { rows } = summarizePortfolio({ now: NOW, projects: [project("p", { jobs: [job("a", { status: "COMPLETED", progress: 100 }), job("b", { progress: 0, estimatedMinutes: 480, totalDurationSec: 7200 })], bookings: [booking("x", { workflowTaskId: "b" })] })] });
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.customer, "Kund AB");
  assert.equal(row.responsible, "Elis");
  assert.equal(row.jobsDone, 1);
  assert.equal(row.jobsTotal, 2);
  assert.equal(row.completion, 50, "weighted by Uppskattad tid, as the project page");
  assert.equal(row.budgetMinutes, 2400);
  assert.equal(row.quotedMinutes, 1200);
  assert.equal(row.effort.estimatedMinutes, 960);
  assert.equal(row.effort.reportedMinutes, 180);
  assert.ok(row.effort.bookedMinutes > 0, "the booking on job b counts as Bokat");
  assert.equal(row.statusLabel, "Pågår");
});

test("portfolio: Utgått jobs are left out of the counts, jobs the person cannot read are not given", () => {
  const { rows } = summarizePortfolio({ now: NOW, projects: [project("p", { jobs: [job("a"), job("b", { status: "CANCELLED" })] })] });
  assert.equal(rows[0].jobsTotal, 1);
});

test("portfolio: no budget or offer shows as null, never as zero", () => {
  const [row] = summarizePortfolio({ now: NOW, projects: [project("p", { timeBudgetMinutes: 0, quotedMinutes: null })] }).rows;
  assert.equal(row.budgetMinutes, null);
  assert.equal(row.quotedMinutes, null);
});

test("portfolio: the project's end date is always a milestone, deadline bookings are too, and the next one is the first from today", () => {
  const [row] = summarizePortfolio({ now: NOW, projects: [project("p", { bookings: [
    booking("early", { kind: "DEADLINE", title: "Besiktning", startsAt: "2026-10-09T08:00:00Z", endsAt: "2026-10-09T08:30:00Z" }),
    booking("later", { kind: "DEADLINE", title: "Slutbesiktning", startsAt: "2026-11-02T08:00:00Z", endsAt: "2026-11-02T08:30:00Z" }),
    booking("gone", { kind: "DEADLINE", title: "Struken", status: "CANCELED", startsAt: "2026-10-14T08:00:00Z", endsAt: "2026-10-14T08:30:00Z" }),
  ] })] }).rows;
  assert.deepEqual(row.milestones.map((item) => item.title), ["Besiktning", "Slutbesiktning", "Projektets slutdatum"]);
  assert.deepEqual(row.nextMilestone, { day: "2026-11-02", title: "Slutbesiktning" });
  const [bare] = summarizePortfolio({ now: NOW, projects: [project("q", { dueDate: "", bookings: [] })] }).rows;
  assert.equal(bare.nextMilestone, null);
});

test("portfolio: delayed projects first, then projects with obstacles, then the rest by end date", () => {
  const obstacle = { reason: "Väntar på material", text: "Kabel saknas", since: "2026-10-08" };
  const { rows, issues } = summarizePortfolio({ now: NOW, projects: [
    project("calm-late-end", { name: "Lugn B", dueDate: "2026-12-20" }),
    project("calm-early-end", { name: "Lugn A", dueDate: "2026-11-01" }),
    project("blocked", { name: "Hinder", jobs: [job("h", { obstacle })] }),
    project("late", { name: "Försenat", jobs: [job("l", { dueDate: "2026-10-09" })] }),
  ] });
  assert.deepEqual(rows.map((row) => row.name), ["Försenat", "Hinder", "Lugn A", "Lugn B"]);
  assert.deepEqual(issues.map((item) => [item.projectName, item.kind, item.days]), [["Hinder", "OBSTACLE", 4], ["Försenat", "LATE", 3]]);
  assert.equal(rows[1].obstacles, 1);
  assert.equal(rows[1].obstacleSince, "2026-10-08");
});

test("portfolio: a finished job with a passed date is no delay, and a project past its end date is delayed", () => {
  const { rows, issues } = summarizePortfolio({ now: NOW, projects: [project("p", { dueDate: "2026-10-10", jobs: [job("a", { status: "COMPLETED", progress: 100, dueDate: "2026-10-02" }), job("b", { dueDate: "2026-10-20" })] })] });
  assert.equal(issues.length, 0);
  assert.equal(rows[0].overdue, true);
  assert.equal(sortPortfolio(rows)[0].id, "p");
});

test("portfolio: the bar is the frame, else the span of the jobs; none when nothing is dated", () => {
  const [framed] = summarizePortfolio({ now: NOW, projects: [project("p")] }).rows;
  assert.deepEqual(framed.bar, { start: "2026-10-01", end: "2026-11-15" });
  const [derived] = summarizePortfolio({ now: NOW, projects: [project("q", { startDate: "", dueDate: "", jobs: [job("a", { plannedStartDate: "2026-10-05", dueDate: "2026-10-20" }), job("b", { plannedStartDate: "", createdAt: "2026-10-03T10:00:00Z", dueDate: "2026-10-25" })] })] }).rows;
  assert.deepEqual(derived.bar, { start: "2026-10-03", end: "2026-10-25" }, "a job without Start counts from the day it was created");
  const [none] = summarizePortfolio({ now: NOW, projects: [project("r", { startDate: "", dueDate: "", jobs: [] })] }).rows;
  assert.equal(none.bar, null);
});

test("planning adapters: no obstacle until the job level exists, Start falls back to the day of creation", () => {
  assert.equal(jobObstacle({ status: "PLANNED" }), null);
  assert.equal(effectiveStartDate({ plannedStartDate: "2026-10-05", createdAt: "2026-10-01T08:00:00Z" }), "2026-10-05");
  assert.equal(effectiveStartDate({ plannedStartDate: "", createdAt: "2026-10-01T08:00:00Z" }), "2026-10-01");
});

// Undermenyerna under sitt huvudobjekt (2026-10-23): Planering is a page of Projekt, not a menu row; since
// 2026-10-30 it has the views Tidplan (project_planning) and Kalender (planning), both called Planering.
test("menu: Planering is a button of its own with the views Kalender, Tidplan and Kapacitet", () => {
  const admin = { memberRole: "ADMIN" as const, workflowPermissions: noWorkflowPermissionProfile() };
  const group = resolveMenu(admin, { hidden: [], shortcuts: [] }).find((entries) => entries.some((entry) => entry.type === "link" && entry.key === "projects"))!;
  assert.deepEqual(group.map((entry) => entry.key), ["customers", "projects"], "nothing under Projekt");
  assert.ok(!(MENU_HIDEABLE as readonly string[]).includes("project_planning"));
  assert.ok((MENU_HIDEABLE as readonly string[]).includes("planning"));
  assert.equal(menuKeyOfView("project_planning"), "planning");
  assert.equal(menuKeyOfView("planning"), "planning");
  assert.equal(menuKeyOfView("capacity"), "planning");
  assert.equal(VIEW_LABEL.planning, "Planering");
  assert.equal(VIEW_LABEL.project_planning, "Planering");
  assert.equal(VIEW_LABEL.capacity, "Planering");
  assert.deepEqual(breadcrumbTrail({ view: "project_planning" }).map((item) => item.label), ["Översikt", "Planering"]);
  assert.deepEqual(breadcrumbTrail({ view: "planning" }).map((item) => item.label), ["Översikt", "Planering"]);
  assert.equal(projectPageAllowed("project_planning", { ...admin }), true);
  assert.equal(projectPageAllowed("project_planning", { ...admin, localStorageMode: true }), false, "no Tidplan in Local");
  assert.equal(projectPageAllowed("project_planning", { ...admin, demo: true }), true, "the demo shows it");
  assert.equal(projectPageAllowed("project_planning", { memberRole: "MEMBER", workflowPermissions: noWorkflowPermissionProfile() }), false, "needs Projekt – läsa");
  const reader = { memberRole: "MEMBER" as const, workflowPermissions: { version: 1 as const, grants: [...workflowPermissionPresets.find((item) => item.id === "report")!.profile.grants] } };
  assert.equal(projectPageAllowed("project_planning", reader), true);
});
