import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalWorkspace, parseLocalWorkspace, saveLocalProjectRecord } from "../features/kfid/local-workspace-store";
import { projectAboutRows, projectFieldRows } from "../lib/workflow/project-frame";
import {
  EMPTY_STAFF_REGISTER,
  STAFF_REGISTER_SITE_ID_ERROR,
  staffRegisterInputSchema,
  staffRegisterOf,
  staffRegisterReminder,
} from "../lib/workflow/staff-register";

const required = { required: true, inWorkflow: false, siteId: "AB12-3456", builder: "Brf Exempel", system: "Huvudentreprenörens system" };

test("the staff register input is trimmed, validated and cleared when not required", () => {
  assert.deepEqual(staffRegisterInputSchema.parse({ ...required, siteId: "  AB12-3456 " }), required);
  assert.deepEqual(staffRegisterInputSchema.parse({}), EMPTY_STAFF_REGISTER);
  // Without the requirement nothing else is kept.
  assert.deepEqual(staffRegisterInputSchema.parse({ ...required, required: false }), EMPTY_STAFF_REGISTER);
  const badId = staffRegisterInputSchema.safeParse({ ...required, siteId: "AB<script>" });
  assert.equal(badId.success, false);
  assert.equal(badId.error?.issues[0]?.message, STAFF_REGISTER_SITE_ID_ERROR);
  assert.equal(staffRegisterInputSchema.safeParse({ ...required, siteId: "A".repeat(41) }).success, false);
  assert.equal(staffRegisterInputSchema.safeParse({ ...required, builder: "B".repeat(201) }).success, false);
  assert.equal(staffRegisterInputSchema.safeParse({ ...required, required: "ja" }).success, false);
});

test("a stored staff register is read leniently; older data reads as not required", () => {
  for (const value of [undefined, null, {}, [], "krävs", 1]) assert.deepEqual(staffRegisterOf(value), EMPTY_STAFF_REGISTER);
  assert.deepEqual(staffRegisterOf({ required: "true", siteId: "X1" }), EMPTY_STAFF_REGISTER, "only a real true counts");
  assert.deepEqual(staffRegisterOf({ ...required, extra: "ignored" }), required);
  assert.equal(staffRegisterOf({ required: true, siteId: "S".repeat(60) }).siteId.length, 40);
});

test("the Starta tid reminder is shown only when the project requires a staff register", () => {
  assert.equal(staffRegisterReminder(undefined), null);
  assert.equal(staffRegisterReminder({}), null, "a project from an older payload");
  assert.equal(staffRegisterReminder({ staffRegister: { ...required, required: false } }), null);
  assert.equal(staffRegisterReminder({ staffRegister: required }), "Checka in i personalliggaren på plats. Byggarbetsplatsens id-nr: AB12-3456. System på plats: Huvudentreprenörens system.");
  assert.equal(staffRegisterReminder({ staffRegister: { required: true } }), "Checka in i personalliggaren på plats.");
});

test("the site id is printed in the project fields before the work description; the project panel shows every detail", () => {
  const project = { client: "Beställare AB", workSite: "Garage", description: "Laddplatser", staffRegister: required };
  assert.deepEqual(projectFieldRows(project), [
    ["Beställare", "Beställare AB"], ["Arbetsplats / anläggning", "Garage"], ["Byggarbetsplatsens id-nr", "AB12-3456"], ["Arbetsbeskrivning", "Laddplatser"],
  ]);
  assert.deepEqual(projectFieldRows({ ...project, staffRegister: { ...required, required: false } }).map(([label]) => label), ["Beställare", "Arbetsplats / anläggning", "Arbetsbeskrivning"]);
  assert.deepEqual(projectFieldRows({ client: "Beställare AB" }), [["Beställare", "Beställare AB"]], "older projects are unchanged");
  assert.deepEqual(projectAboutRows(project).map(([label]) => label), [
    "Beställare", "Arbetsplats / anläggning", "Personalliggare", "Byggarbetsplatsens id-nr", "Byggherre", "System på plats", "Arbetsbeskrivning",
  ]);
});

test("Local keeps the staff register through a save, a file round trip and an edit without the field", () => {
  const empty = createLocalWorkspace({ id: "org-local", name: "Lokala AB" });
  const base = { name: "Bygge", description: "", startDate: "2026-10-01", dueDate: "2026-12-31", customerId: null };
  const created = saveLocalProjectRecord(empty, { ...base, staffRegister: { ...required, siteId: " AB12-3456 " } });
  assert.deepEqual(created.project.staffRegister, required);
  const reread = parseLocalWorkspace(JSON.parse(JSON.stringify(created.workspace)), "org-local");
  assert.deepEqual(reread.projects[0]?.staffRegister, required, "the .hwf file carries the fields");
  // An older caller that does not send the field keeps what is stored.
  const kept = saveLocalProjectRecord(reread, { ...base, id: created.project.id, name: "Bygge 2" });
  assert.deepEqual(kept.project.staffRegister, required);
  // A file written before the field existed reads as not required.
  const older = JSON.parse(JSON.stringify(created.workspace));
  delete older.projects[0].staffRegister;
  assert.deepEqual(parseLocalWorkspace(older, "org-local").projects[0]?.staffRegister, EMPTY_STAFF_REGISTER);
  // Same validation as Cloud, with the message in plain Swedish.
  assert.throws(() => saveLocalProjectRecord(empty, { ...base, staffRegister: { ...required, siteId: "AB/12" } }), new RegExp(STAFF_REGISTER_SITE_ID_ERROR));
});

test("the demo carries the staff register like Cloud: shown in the overview, saved, kept when not sent", async () => {
  const { handleDemoRequest } = await import("../features/demo/demo-backend");
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await handleDemoRequest(method, new URL(path, "http://localhost"), body === undefined ? null : JSON.stringify(body));
    return { status: response.status, json: await response.json() as Record<string, unknown> };
  };
  const overview = await call("GET", "/api/workspace");
  const projects = overview.json.projects as { id: string; name: string; startDate: string; dueDate: string; customerId: string | null; staffRegister?: unknown }[];
  const seeded = projects.find((project) => staffRegisterOf(project.staffRegister).required);
  assert.ok(seeded, "the demo has a project that requires a staff register");
  assert.ok(staffRegisterReminder(seeded));
  const base = { name: "Demo bygge", description: "", startDate: "2026-10-01", dueDate: "2026-12-31", customerId: null };
  const created = await call("POST", "/api/projects", { action: "save", project: { ...base, staffRegister: required } });
  assert.equal(created.status, 200);
  const id = created.json.id as string;
  await call("POST", "/api/projects", { action: "save", project: { ...base, id, name: "Demo bygge 2" } });
  const read = await call("GET", `/api/projects?id=${encodeURIComponent(id)}`);
  assert.deepEqual((read.json.projects as { staffRegister: unknown }[])[0]?.staffRegister, required);
  const refused = await call("POST", "/api/projects", { action: "save", project: { ...base, staffRegister: { ...required, siteId: "AB/12" } } });
  assert.equal(refused.status, 400);
  assert.equal(refused.json.error, STAFF_REGISTER_SITE_ID_ERROR);
});

test("Checka in här on a job: only where the project keeps the register in Workflow and is open", async () => {
  const { jobCheckIn, jobCheckInText } = await import("../lib/workflow/staff-register");
  const register = { required: true, inWorkflow: true, siteId: "AB1", builder: "", system: "" };
  const status = (me: { person: unknown; onSite: boolean; since: string | null }, extra: Record<string, unknown> = {}) => ({ access: { self: true }, me, ...extra });
  const out = { person: { id: "p" }, onSite: false, since: null };
  assert.equal(jobCheckIn(undefined, status(out)), null);
  assert.equal(jobCheckIn({ staffRegister: undefined }, status(out)), null, "no register: nothing is shown");
  assert.equal(jobCheckIn({ staffRegister: { ...register, inWorkflow: false } }, status(out)), null, "a register on site elsewhere: nothing");
  assert.equal(jobCheckIn({ staffRegister: register }, null), null, "state not read yet");
  assert.equal(jobCheckIn({ staffRegister: register, archivedAt: "2026-10-01" }, status(out)), null);
  assert.equal(jobCheckIn({ staffRegister: register, closedAt: "2026-10-01" }, status(out)), null);
  assert.equal(jobCheckIn({ staffRegister: register }, { ...status(out), access: { self: false } }), null);
  assert.equal(jobCheckIn({ staffRegister: register }, status(out, { writable: false })), null, "no new rows allowed");
  const inn = jobCheckIn({ staffRegister: register }, status(out, { writable: true }));
  assert.deepEqual(inn, { kind: "IN", label: "Checka in här", sinceAt: null, needsIdNumber: false });
  assert.equal(jobCheckInText(inn!, (value) => value), "Inte incheckad");
  const onSite = jobCheckIn({ staffRegister: register }, status({ person: { id: "p" }, onSite: true, since: "07:12" }));
  assert.equal(onSite?.kind, "OUT");
  assert.equal(onSite?.label, "Checka ut");
  assert.equal(jobCheckInText(onSite!, (value) => value), "Incheckad 07:12");
  assert.equal(jobCheckIn({ staffRegister: register }, status({ person: null, onSite: false, since: null }))?.needsIdNumber, true);
});
