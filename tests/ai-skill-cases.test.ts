import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { planAnswer } from "../lib/ai/assistant-rules";
import { formatKnowledgeAnswer } from "../lib/ai/assistant-rules-knowledge";
import { ASSISTANT_READ_TOOLS } from "../lib/ai/assistant-tools";
import { searchHelp } from "../lib/help/search-help";
import { helpToolAnswer } from "../lib/tools/registry-knowledge";
import { QA_BENCH_EMAILS } from "../lib/auth/access";
import { demoCompanyFixture, demoCompanyNames, DEMO_FIXTURE_NAME, fixtureId, remapIds } from "../features/demo/demo-company-fixture";

// Provbänken för Workflow AI (2026-11-21): the skills' cases are whole, and every case the rules answer is checked exactly here –
// free and without a model. The model's cases are checked only on demand (scripts/qa/ai-agent-evals.cjs, group skills).

type SkillCase = {
  id: string; skill: string; as: string; q: string; check: "rules" | "model";
  plan?: { tool?: string; input?: Record<string, unknown>; kind?: string };
  helpHref?: string; film?: boolean; page?: string; tools?: string[]; mustCall?: string[]; proposal?: string; must?: string[]; never?: string[];
};
const require = createRequire(import.meta.url);
// The cases live in scripts/qa, which the Community export leaves out (as the other QA tooling): there these tests are skipped.
const CASES_FILE = "../scripts/qa/ai-skill-cases.cjs";
const present = existsSync(new URL(CASES_FILE, import.meta.url));
const skip = present ? false : "scripts/qa följer inte med Community";
const { SKILL_CASES, SKILLS, NEVER } = (present ? require(CASES_FILE) : { SKILL_CASES: [], SKILLS: [], NEVER: [] }) as { SKILL_CASES: SkillCase[]; SKILLS: string[]; NEVER: string[] };
const now = new Date("2026-11-21T09:00:00Z");
const films = "https://example.com/filmer";
const re = (source: string) => new RegExp(source, "iu");

test("the bench: about a hundred cases, 5–10 per skill, each with a person of the demo company and valid patterns", { skip }, () => {
  assert.ok(SKILL_CASES.length >= 95 && SKILL_CASES.length <= 120, `${SKILL_CASES.length} cases`);
  assert.equal(new Set(SKILL_CASES.map((item) => item.id)).size, SKILL_CASES.length, "unique ids");
  for (const skill of SKILLS) {
    const count = SKILL_CASES.filter((item) => item.skill === skill).length;
    assert.ok(count >= 5 && count <= 10, `${skill}: ${count}`);
  }
  assert.ok(SKILLS.length >= 14, "every skill of the table");
  for (const item of SKILL_CASES) {
    assert.ok(item.as in QA_BENCH_EMAILS, `${item.id}: ${item.as}`);
    for (const source of [...(item.must ?? []), ...(item.never ?? []), ...NEVER]) assert.doesNotThrow(() => re(source), `${item.id}: ${source}`);
    if (item.check === "model") {
      assert.ok(Array.isArray(item.tools), `${item.id} says which tools it may use`);
      // The chat has only its read tools; a case can never expect another.
      for (const tool of [...(item.tools ?? []), ...(item.mustCall ?? [])]) assert.ok((ASSISTANT_READ_TOOLS as readonly string[]).includes(tool), `${item.id}: ${tool}`);
      for (const tool of item.mustCall ?? []) assert.ok(item.tools!.includes(tool), `${item.id}: ${tool} must also be allowed`);
    } else assert.ok(item.plan, `${item.id} names the rules' plan`);
  }
});

test("rules first: every case the rules answer gets exactly the planned tool, free", { skip }, () => {
  for (const item of SKILL_CASES.filter((entry) => entry.check === "rules")) {
    const plan = planAnswer(item.q, now);
    if (item.plan!.kind) { assert.equal(plan.kind, item.plan!.kind, `${item.id}: ${item.q}`); continue; }
    assert.equal(plan.kind, "tool", `${item.id}: ${item.q} → ${plan.kind}`);
    if (plan.kind !== "tool") continue;
    assert.equal(plan.tool, item.plan!.tool, `${item.id}: ${item.q}`);
    if (item.plan!.input) assert.deepEqual(plan.input, item.plan!.input, `${item.id}: ${item.q}`);
  }
});

test("the help cases: the rules are sure, lead to the right page first, say the buttons' names and the film", { skip }, () => {
  for (const item of SKILL_CASES.filter((entry) => entry.check === "rules" && entry.plan?.tool === "search_help")) {
    const plan = planAnswer(item.q, now);
    assert.ok(plan.kind === "tool");
    const found = searchHelp(String(plan.input.query), { filmsPage: films });
    assert.equal(found.confident, true, `${item.id}: ${item.q}`);
    if (item.helpHref) assert.match(found.hits[0].href, re(item.helpHref), `${item.id}: ${found.hits[0].href}`);
    const reply = formatKnowledgeAnswer("search_help", plan.heading, helpToolAnswer(found) as never);
    for (const source of item.must ?? []) assert.match(reply.answer, re(source), `${item.id}: ${source}`);
    for (const source of [...NEVER, ...(item.never ?? [])]) assert.doesNotMatch(reply.answer, re(source), `${item.id}: ${source}`);
    if (item.film) assert.match(reply.answer, /Se filmen/, item.id);
  }
});

test("the never-patterns catch what they are for, and let a refusal through", { skip }, () => {
  const safety = NEVER.map(re);
  assert.ok(safety.some((pattern) => pattern.test("Ja, anläggningen är säker att ta i drift.")));
  assert.ok(safety.some((pattern) => pattern.test("Gruppen får spänningssättas.")));
  assert.ok(!safety.some((pattern) => pattern.test("Jag kan inte avgöra om det är säkert att spänningssätta; det avgör en behörig person.")));
  assert.ok(safety.some((pattern) => pattern.test("Kunden QA Industrikund AB har två jobb.")));
});

test("the fixture: the demo company with its own ids, its people as the bench, parents and work orders first", () => {
  const fixture = demoCompanyFixture(now, { "bench-elna": "user-elna" });
  assert.equal(fixture.organization.name, DEMO_FIXTURE_NAME);
  assert.deepEqual(fixture.users.map((user) => user.identity).sort(), Object.keys(QA_BENCH_EMAILS).sort());
  assert.equal(fixture.users.find((user) => user.identity === "bench-elna")?.role, "OWNER");
  assert.ok(fixture.users.filter((user) => user.identity !== "bench-elna").every((user) => user.role === "MEMBER"));
  // No row keeps a demo id, and a person's id is the database's.
  const all = JSON.stringify({ ...fixture, users: [] });
  assert.doesNotMatch(all, /"demo-[a-z]+-/);
  assert.ok(fixture.projects.some((project) => project.responsibleUserId === "user-elna"));
  for (const [at, place] of fixture.facilities.entries()) if (place.parentId) assert.ok(fixture.facilities.slice(0, at).some((parent) => parent.id === place.parentId), place.name);
  const firstTask = fixture.tasks.findIndex((task) => task.kind !== "WORK_ORDER");
  assert.ok(fixture.tasks.slice(firstTask).every((task) => task.kind !== "WORK_ORDER"), "work orders before the tasks in them");
  for (const task of fixture.tasks) if (task.workOrderId) assert.ok(fixture.tasks.some((order) => order.id === task.workOrderId && order.kind === "WORK_ORDER"), task.title);
  // Only invented data: .invalid e-mail and the demo's own names.
  assert.ok(fixture.users.every((user) => user.email.endsWith("@role-test.invalid")));
  assert.ok(fixture.customers.every((customer) => !customer.email || customer.email.endsWith(".invalid")));
  assert.ok(demoCompanyNames(fixture).includes("Nollpunkten Fastigheter AB"));
  assert.equal(fixtureId("demo-task-kontor-led"), "qakb-task-kontor-led");
  assert.deepEqual(remapIds({ a: ["x", "y"], b: "x" }, new Map([["x", "z"]])), { a: ["z", "y"], b: "z" });
});
