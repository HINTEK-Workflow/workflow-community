import { createDemoDatabase, type DemoDatabase } from "./demo-data";
import { QA_BENCH_EMAILS, type QaBenchIdentity } from "@/lib/auth/access";

/**
 * Provbänken för Workflow AI (2026-11-21, utredningen avsnitt 4): the invented demo company Kopplingsbyrån AB – the same data as /demo
 * (features/demo/demo-data.ts), dated from the day it is made – as rows for kfid_v3_test, so the skills' evals ask questions of one
 * company with real routes, permissions and tools. Only invented data: the demo's people, customers, places, projects and jobs,
 * never a real person, address or customer, and never used to train a model. Pure: scripts/qa/seed-demo-company.ts writes it.
 *
 * Every id gets the prefix "qakb-" (the demo's "demo-…" ids), so the rows are told apart from everything else and a run again
 * replaces exactly them. The people sign in as the bench identities (lib/auth/access.ts, QA_BENCH_EMAILS).
 */
export const DEMO_FIXTURE_SLUG = "qa-kopplingsbyran";
export const DEMO_FIXTURE_NAME = "Kopplingsbyrån AB";
const BENCH_OF: Record<string, QaBenchIdentity> = { "demo-elna": "bench-elna", "demo-elis": "bench-elis", "demo-elin": "bench-elin", "demo-elon": "bench-elon" };

export const fixtureId = (demoId: string) => demoId.replace(/^demo-/, "qakb-");

/** Every string in the value that is one of the demo's ids, as the fixture's id; everything else as it is. */
export function remapIds<T>(value: T, ids: ReadonlyMap<string, string>): T {
  if (typeof value === "string") return (ids.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map((item) => remapIds(item, ids)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, remapIds(item, ids)])) as T;
  return value;
}

export type DemoFixture = ReturnType<typeof demoCompanyFixture>;

/** The demo company as fixture rows, with the user ids the database has for the bench identities. */
export function demoCompanyFixture(now = new Date(), userIds: Partial<Record<QaBenchIdentity, string>> = {}, db: DemoDatabase = createDemoDatabase(now)) {
  const ids = new Map<string, string>();
  const userId = (demoUser: string) => userIds[BENCH_OF[demoUser]] ?? fixtureId(demoUser);
  for (const user of db.users) ids.set(user.id, userId(user.id));
  for (const row of [...db.customers, ...db.facilities, ...db.projects, ...db.tasks, ...db.timeEntries, ...db.activities]) ids.set(row.id, fixtureId(row.id));
  // The demo's round schedules are not seeded; a job's data that names one keeps a fixture id, never a demo id.
  for (const schedule of db.schedules) ids.set(schedule.id, fixtureId(schedule.id));
  const map = <T>(value: T) => remapIds(value, ids);
  const at = (value: string | null | undefined) => (value ? new Date(value) : null);

  const users = db.users.map((user) => ({
    identity: BENCH_OF[user.id], email: QA_BENCH_EMAILS[BENCH_OF[user.id]], id: userId(user.id), name: user.name, title: user.title,
    role: user.id === "demo-elna" ? "OWNER" as const : "MEMBER" as const, workflowPermissions: user.permissions, weeklyWorkMinutes: user.weeklyWorkMinutes,
  }));
  const customers = db.customers.map((customer) => ({
    id: map(customer.id), name: customer.name, company: customer.company, address: customer.address, postalCode: customer.postalCode, city: customer.city,
    email: customer.email, phone: customer.phone, mobile: customer.mobile, notes: customer.notes, specialRequirements: customer.specialRequirements ?? "", customerType: customer.customerType ?? "COMPANY",
  }));
  // Places with their parents first (the tree's own rule: a parent exists before its children).
  const ordered: typeof db.facilities = [];
  const pending = [...db.facilities];
  while (pending.length) {
    const next = pending.findIndex((place) => !place.parentId || ordered.some((done) => done.id === place.parentId));
    if (next < 0) throw new Error("Demons platsträd har en plats vars förälder saknas.");
    ordered.push(...pending.splice(next, 1));
  }
  const facilities = ordered.map((place) => ({
    id: map(place.id), customerId: map(place.customerId), parentId: place.parentId ? map(place.parentId) : null, kind: place.kind ?? "FACILITY", name: place.name, address: place.address ?? "",
    postalCode: place.postalCode ?? "", city: place.city ?? "", description: place.description ?? "", isActive: place.isActive !== false, objectType: place.objectType ?? "", operatingState: place.operatingState ?? "",
    manufacturer: place.manufacturer ?? "", model: place.model ?? "", serialNumber: place.serialNumber ?? "", installedOn: place.installedOn ?? "", attributes: place.attributes ?? [],
  }));
  const projects = db.projects.map((project) => ({
    id: map(project.id), customerId: project.customerId ? map(project.customerId) : null, facilityId: project.facilityId ? map(project.facilityId) : null, name: project.name, description: project.description,
    startDate: project.startDate ?? "", dueDate: project.dueDate, client: project.client ?? "", contactPerson: project.contactPerson ?? "", reference: project.reference ?? "", workSite: project.workSite ?? "",
    staffRegister: project.staffRegister ?? {}, responsibleUserId: project.responsibleUserId ? map(project.responsibleUserId) : null, responsibleName: project.responsibleName, timeBudgetMinutes: project.timeBudgetMinutes,
    archivedAt: at(project.archivedAt), closedAt: at(project.closedAt ?? null), createdAt: new Date(project.createdAt),
    decisions: (project.decisions ?? []).map((decision) => ({ decidedOn: decision.decidedOn, text: decision.text, decidedBy: decision.decidedBy, actorName: decision.actorName, createdAt: new Date(decision.createdAt) })),
  }));
  // Work orders before the tasks in them (a task's work order must exist first).
  const tasks = [...db.tasks].sort((a, b) => Number(a.kind !== "WORK_ORDER") - Number(b.kind !== "WORK_ORDER")).map((task) => ({
    id: map(task.id), kind: task.kind, title: task.title, description: task.description, status: task.status, projectId: task.projectId ? map(task.projectId) : null, customerId: task.customerId ? map(task.customerId) : null,
    facilityId: task.facilityId ? map(task.facilityId) : null, workOrderId: task.workOrderId ? map(task.workOrderId) : null, assignedToUserId: task.assignedToUserId ? map(task.assignedToUserId) : null, assignedToName: task.assignedToName,
    dueDate: task.dueDate, plannedStartDate: task.plannedStartDate ?? "", estimatedMinutes: task.estimatedMinutes ?? null, stage: task.stage ?? "", predecessorIds: (task.predecessorIds ?? []).map((id) => map(id)),
    data: map(task.data), startedAt: at(task.startedAt), completedAt: at(task.completedAt), cancelledAt: at(task.cancelledAt), cancelReason: task.cancelReason ?? "", cancelledFromStatus: task.cancelledFromStatus ?? null,
    createdBy: map(task.createdBy), updatedBy: map(task.updatedBy), createdAt: new Date(task.createdAt),
  }));
  const timeEntries = db.timeEntries.filter((entry) => entry.endedAt).map((entry) => ({
    id: map(entry.id), taskId: entry.taskId ? map(entry.taskId) : null, projectId: entry.projectId ? map(entry.projectId) : null, sourceTaskId: entry.sourceTaskId ? map(entry.sourceTaskId) : null,
    userId: map(entry.userId), startedAt: new Date(entry.startedAt), endedAt: new Date(entry.endedAt!), durationSec: entry.durationSec, note: entry.note,
  }));
  const activities = db.activities.filter((activity) => !activity.deletedAt).map((activity) => ({
    id: map(activity.id), title: activity.title, description: activity.description, kind: activity.kind, status: activity.status, startsAt: new Date(activity.startsAt), endsAt: new Date(activity.endsAt),
    projectId: activity.projectId ? map(activity.projectId) : null, workflowTaskId: activity.workflowTaskId ? map(activity.workflowTaskId) : null, assignedToName: activity.assignedToName,
    assignments: activity.assignments.map((assignment) => ({ userId: map(assignment.userId), plannedMinutes: assignment.plannedMinutes, startsAt: at(assignment.startsAt), endsAt: at(assignment.endsAt) })),
  }));
  return { organization: { slug: DEMO_FIXTURE_SLUG, name: DEMO_FIXTURE_NAME }, users, customers, facilities, projects, tasks, timeEntries, activities };
}

/** The names that belong to the demo company only: an answer in another company must never hold one of them (the evals' isolation check). */
export function demoCompanyNames(fixture: DemoFixture) {
  return [DEMO_FIXTURE_NAME, ...fixture.customers.map((customer) => customer.name), ...fixture.projects.map((project) => project.name), ...fixture.users.map((user) => user.name)];
}
