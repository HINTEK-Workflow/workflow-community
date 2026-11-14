import assert from "node:assert/strict";
import test from "node:test";
import { nextStepAction, nextStepLine, titleHelpText } from "../lib/workflow/next-step";
import { jobRowAction, jobStepRows } from "../lib/workflow/native-mode";
import { firstUnanswered, nextQuestionIndex } from "../lib/workflow/risk-step-paging";
import { RISK_QUESTIONS } from "../lib/workflow/risk-step";
import { formFlow, workOrderFlow } from "../lib/workflow/task-flow";

// UX-granskningen avsnitt 6 (punkt 7, 2026-10-23): "Nästa steg" som huvudknapp, riskbedömningen en fråga per skärm, hjälptexter.

const order = (patch: Partial<Parameters<typeof workOrderFlow>[0]> = {}) => workOrderFlow({
  saved: true, title: "Byt armatur", status: "PLANNED", assigned: false, dueDate: "", timerRunning: false, totalDurationSec: 0,
  executionNotes: "", signatureName: "", signatureConfirmed: false, ...patch,
});

test("the job page's primary button names the next step from the same line as Varför kan jag inte gå vidare?", () => {
  const risk = nextStepLine({ flow: order({ riskStep: { met: false, hint: "Svara på frågorna och bekräfta." } }) });
  assert.equal(risk?.key, "risk");
  assert.equal(nextStepAction(risk, "WORK_ORDER"), "Gör riskbedömningen");
  const work = nextStepLine({ flow: order({ riskStep: { met: true, hint: "" } }) });
  assert.equal(nextStepAction(work, "WORK_ORDER"), "Skriv utfört arbete");
  const sign = nextStepLine({ flow: order({ executionNotes: "Bytt" }) });
  assert.equal(nextStepAction(sign, "WORK_ORDER"), "Signera");
  // Everything done: the job is finished – never the bare "Färdigställ", which stays the Färdigställ panel's own button.
  const ready = nextStepLine({ flow: order({ executionNotes: "Bytt", signatureName: "Elin", signatureConfirmed: true }) });
  assert.equal(nextStepAction(ready, "WORK_ORDER"), "Färdigställ arbetsordern");
  assert.equal(nextStepAction(ready, "FORM"), "Färdigställ protokollet");
  // A requirement off the line leads to it.
  const missing = nextStepLine({ flow: order({ executionNotes: "Bytt", signatureName: "Elin", signatureConfirmed: true }), issues: [{ field: "form-x", message: "Fyll i X." }] });
  assert.equal(nextStepAction(missing, "WORK_ORDER"), "Visa vad som saknas");
  // A block on the work and the first save keep Spara as the primary.
  assert.equal(nextStepAction(nextStepLine({ flow: order(), blocked: "Du har inte behörighet." }), "WORK_ORDER"), null);
  assert.equal(nextStepAction(nextStepLine({ flow: order({ saved: false }) }), "WORK_ORDER"), null);
  assert.equal(nextStepAction(null, "WORK_ORDER"), null);
});

test("a protocol's next step is to fill it in", () => {
  const flow = formFlow({ saved: true, title: "Kontroll", status: "IN_PROGRESS", issues: [{ field: "form-a", message: "Fyll i A." }], requirements: [{ field: "form-a", met: false }], signatureBlocks: [] });
  const next = nextStepLine({ flow });
  assert.equal(next?.key, "fill");
  assert.equal(nextStepAction(next, "FORM"), "Fyll i protokollet");
});

test("the app's job menu says the same words for the step row it opens", () => {
  const start = jobStepRows({ kind: "WORK_ORDER", flow: order({ riskStep: { met: false, hint: "" } }) });
  assert.equal(jobRowAction(start.next!), "Gör riskbedömningen");
  const ready = jobStepRows({ kind: "WORK_ORDER", flow: order({ executionNotes: "Klart", signatureName: "Elin", signatureConfirmed: true }) });
  const signing = ready.rows.find((row) => row.screen === "signering")!;
  assert.equal(signing.state, "Klar att färdigställa");
  assert.equal(jobRowAction(signing), "Färdigställ");
  assert.equal(jobRowAction({ screen: "formular", label: "Ifyllnad", state: "Du är här" }), "Fyll i protokollet");
  assert.equal(jobRowAction({ screen: "tid", label: "Tid", state: "" }), "Fortsätt till tid", "a screen without its own words");
});

test("help instead of a ban: what to write so the button works", () => {
  assert.equal(titleHelpText("spara"), "Skriv en rubrik så kan du spara.");
  assert.equal(titleHelpText("starta tiden"), "Skriv en rubrik så kan du starta tiden.");
  assert.equal(titleHelpText("spara", "Anläggning"), "Fyll i anläggning så kan du spara.");
  assert.doesNotMatch(titleHelpText("skapa jobbet"), /först/);
});

test("risk step in the app: one question per screen, an answer moves on and nothing is lost", () => {
  const ids = RISK_QUESTIONS.map((question) => question.id);
  assert.equal(firstUnanswered({}), 0);
  assert.equal(firstUnanswered({ [ids[0]]: "yes", [ids[1]]: "no" }), 2);
  assert.equal(firstUnanswered(Object.fromEntries(ids.map((id) => [id, "yes"]))), ids.length, "all answered: the summary");
  // After an answer: the next unanswered after it, then any skipped before it, then the summary.
  assert.equal(nextQuestionIndex({ [ids[0]]: "yes" }, 0), 1);
  assert.equal(nextQuestionIndex({ [ids[0]]: "yes", [ids[1]]: "yes", [ids[2]]: "unsure" }, 0), 3, "answered ones are skipped");
  assert.equal(nextQuestionIndex({ [ids[1]]: "yes", [ids[2]]: "yes", [ids[3]]: "yes", [ids[4]]: "yes" }, 4), 0, "back to one left before");
  assert.equal(nextQuestionIndex(Object.fromEntries(ids.map((id) => [id, "yes"])), 2), ids.length);
});
