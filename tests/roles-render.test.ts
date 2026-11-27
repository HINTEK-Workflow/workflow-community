import assert from "node:assert/strict";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RiskClassMark } from "../features/self-inspection/risk-class-mark";
import { RiskClassesTab } from "../features/self-inspection/risk-classes";
import { RiskClassSetting } from "../features/self-inspection/risk-class-setting";
import { AssignmentPanel } from "../features/self-inspection/work";
import { OrgChart, PeopleAppendix, PeopleTable, ProgramAssessment, RolesAppendix } from "../features/self-inspection/organisation";
import { FormTypeCardContent } from "../features/workflow/form-card";
import { applySelfInspectionAction } from "../lib/self-inspection/document";
import { emptySelfInspectionDocument, peopleOverview, programContent, selfInspectionView, type SelfInspectionAction, type SelfInspectionDocument } from "../lib/self-inspection/model";
import { workContext } from "../lib/self-inspection/work";

// Roller med nivå och riskklasser (2026-10-07): the screens' markup, drawn on the server from the shared document, so a
// render error or a missing label is found without a browser. The behaviour in a browser is tests/roles.browser.cjs.
const admin = { id: "u-admin", name: "Ada Admin", admin: true };
const people = [{ id: "u-admin", name: "Ada Admin" }, { id: "u-mats", name: "Mats Montör" }];
const act = (doc: SelfInspectionDocument, action: SelfInspectionAction) => applySelfInspectionAction(doc, action, admin, { people, now: new Date("2026-10-08T10:00:00Z") });

async function staffed() {
  let doc = await act(emptySelfInspectionDocument(), { action: "create_program" });
  const role = (key: string) => doc.program!.roles.find((item) => item.key === key)!.id;
  doc = await act(doc, { action: "set_person_roles", revision: doc.program!.revision, personId: "u-mats", name: "", roleIds: [role("installer")] });
  doc = await act(doc, { action: "set_risk_class", key: "kind:WORK_ORDER", riskClass: 2 });
  return doc;
}
const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

test("the required-level mark: neutral for every level; a proposal says so; an admin's mark is a button", () => {
  assert.match(html(h(RiskClassMark, { value: 1 })), /data-risk-class="1"[^>]*>.*Kräver nivå 1/);
  assert.match(html(h(RiskClassMark, { value: 2, suggested: true })), /data-suggested="true".*Kräver nivå 2 · förslag/);
  assert.doesNotMatch(html(h(RiskClassMark, { value: 3 })), /border-red-300|border-amber-300/, "a level is about the person, not a danger");
  assert.doesNotMatch(html(h(RiskClassMark, { value: 2 })), /<button/);
  assert.match(html(h(RiskClassMark, { value: 3, onClick: () => undefined })), /<button type="button" data-testid="risk-class-mark" data-risk-class="3"[^>]*aria-label="Krävd nivå 3\. Ändra krävd nivå\."/);
  const card = (risk?: { value: 1 | 2 | 3; suggested: boolean }) => html(h(FormTypeCardContent, { form: { name: "Kontroll", description: "x", color: "blue", icon: "gauge", category: "ELECTRICAL", allowStandalone: true, allowInProject: true, risk } }));
  assert.match(card({ value: 2, suggested: true }), /Kräver nivå 2 · förslag/, "a card carries its class");
  assert.doesNotMatch(card(), /risk-class-mark/, "the form builder's preview of a card has none");
});

test("Egenkontroll shows the roles' levels, each person's level and the way to give roles", async () => {
  const doc = await staffed();
  const content = programContent(doc.program!);
  const overview = peopleOverview(content);
  assert.match(html(h(OrgChart, { roles: content.roles, people: overview })), /Nivå 2/);
  const table = html(h(PeopleTable, { people: overview }));
  assert.match(table, /<span>Nivå<\/span>/);
  assert.match(table, /data-testid="self-inspection-person-level"[^>]*>(?:<span[^>]*>Nivå: <\/span>)?2</, "the montör is level 2");
  const view = await selfInspectionView(doc, { me: { id: "u-admin", name: "Ada Admin" }, admin: true, company: "Bolaget", people });
  const edit = { view, program: view.program!, busy: false, run: async () => true, namedPeople: false };
  const roles = html(h(RolesAppendix, { roles: view.program!.roles, people: overview, edit }));
  assert.match(roles, /Varje roll har en nivå \(1–3\)/);
  assert.match(roles, /Nivå 3/, "the ERE's role is level 3");
  // Appendix B is only to read (2026-11-25): roles and assessments are given on the person's page under Kompetenskort.
  const appendix = html(h(PeopleAppendix, { people: overview }));
  assert.match(appendix, /Så fort någon har en roll gäller nivåerna för alla/);
  assert.match(appendix, /under Kompetenskort/);
  assert.doesNotMatch(appendix, /<button|Ge roller till person|Ändra roller|Lägg till kompetens/, "no buttons in the programme's text");
  const assessment = html(h(ProgramAssessment, { view, busy: false, run: async () => null, personId: overview[0].personId, name: overview[0].name, editable: true }));
  assert.match(assessment, /Bedömning i egenkontrollprogrammet/);
  assert.match(assessment, /data-testid="competence-assessment-edit"/);
  assert.doesNotMatch(html(h(ProgramAssessment, { view, busy: false, run: async () => null, personId: overview[0].personId, name: overview[0].name, editable: false })), /competence-assessment-edit/, "only an admin changes it");
});

test("Riskklasser: the work order first, proposals marked, the state of the rule and who has no role", async () => {
  const doc = await staffed();
  const view = await selfInspectionView(doc, { me: { id: "u-admin", name: "Ada Admin" }, admin: true, company: "Bolaget", people });
  const tab = html(h(RiskClassesTab, { view, busy: false, run: async () => null }));
  assert.match(tab, /data-testid="self-inspection-risk-classes"/);
  assert.match(tab, /Spärren är på/);
  assert.match(tab, /1 person har en roll\./);
  assert.match(tab, /data-risk-key="kind:WORK_ORDER"/);
  assert.match(tab, /<select[^>]*aria-label="Krävd nivå för Arbetsorder"[^>]*>[\s\S]*?<option value="2" selected/, "the company's own class is chosen");
  assert.match(tab, /Förslag från Workflow: nivå 1/, "the work order's proposal");
  assert.match(tab, /data-testid="self-inspection-levels-unplaced"[\s\S]*Ada Admin/, "the admin has no role: told, so nobody is locked out by surprise");
  const quiet = await selfInspectionView(await act(emptySelfInspectionDocument(), { action: "create_program" }), { me: { id: "u-admin", name: "Ada Admin" }, admin: true, company: "Bolaget", people });
  const calm = html(h(RiskClassesTab, { view: quiet, busy: false, run: async () => null }));
  assert.match(calm, /Spärren är av/);
  assert.match(calm, /Ingen i företaget har fått en roll ännu/);
  assert.doesNotMatch(calm, /self-inspection-levels-unplaced/);
});

test("the panel on a task: the class, the reader's level, supervision and the responsible person's level", async () => {
  let doc = await staffed();
  doc = await act(doc, { action: "save_competence", revision: doc.program!.revision, competence: { personId: "u-mats", name: "", workTypes: [], scope: "", assessment: "Elev.", assessedAt: null, limitations: "", supervised: true } });
  const panel = (me: string, responsible: { id: string | null; name: string }) => {
    const context = workContext(doc, { taskId: "t-1", me: { id: me }, subject: { kind: "WORK_ORDER" }, names: new Map(people.map((person) => [person.id, person.name])) });
    return html(h(AssignmentPanel, { work: { context, reload: async () => undefined, act: async () => undefined }, target: { kind: "task", id: "t-1" }, canEdit: true, responsible }));
  };
  const mine = panel("u-mats", { id: "u-admin", name: "Ada Admin" });
  assert.match(mine, /data-testid="self-inspection-level-facts"/);
  assert.match(mine, /Kräver nivå 2/);
  assert.match(mine, /Din nivå 2/);
  assert.match(mine, /Under handledning/);
  assert.match(mine, /Ansvarig Ada Admin: ingen roll/, "the responsible person has no role here");
  assert.match(panel("u-admin", { id: null, name: "" }), /Du har ingen roll/);
  assert.doesNotMatch(mine, /Utförande|Kontrollerande/, "no performer or inspector to choose");
  assert.match(mine, /Verksamhetstyp/);
  const none = workContext(await act(emptySelfInspectionDocument(), { action: "create_program" }), { taskId: "t-1", me: { id: "u-mats" }, subject: { kind: "WORK_ORDER" } });
  assert.match(html(h(AssignmentPanel, { work: { context: none, reload: async () => undefined, act: async () => undefined }, target: { kind: "task", id: "t-1" }, canEdit: true })), /spärrar ingenting/);
});

test("the form builder's field: a new form has none until it is saved", () => {
  assert.match(html(h(RiskClassSetting, { formId: null, category: "ELECTRICAL" })), /Spara utkastet först, så kan ni sätta formulärets krävda nivå\./);
});
