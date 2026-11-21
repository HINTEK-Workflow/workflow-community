import assert from "node:assert/strict";
import test from "node:test";
import { helpExcerpt, searchHelpEntries } from "../lib/workflow/help-search";
import { CURRENT_STEP_STATE, jobRowAction, jobStepRows } from "../lib/workflow/native-mode";
import { nextStepHinders, nextStepLine } from "../lib/workflow/next-step";
import { RISK_QUESTIONS } from "../lib/workflow/risk-step";
import { showsExtendedChoice } from "../lib/workflow/risk-step-paging";
import { homeTimeTileHref } from "../lib/workflow/running-timer";
import { workOrderFlow } from "../lib/workflow/task-flow";

// svar på de 15 frågorna efter 0.21.0 (2026-10-24): punkterna 1–4 och 8 (UI); 10 (QR) står i place-scan.test.ts.

const order = (patch: Partial<Parameters<typeof workOrderFlow>[0]> = {}) => workOrderFlow({
  saved: true, title: "Byt armatur", status: "PLANNED", assigned: false, dueDate: "", timerRunning: false, totalDurationSec: 0,
  executionNotes: "", signatureName: "", signatureConfirmed: false, ...patch,
});

test("svar 1: Gör utökad riskbedömning only on the risk step's summary in the app", () => {
  for (let index = 0; index < RISK_QUESTIONS.length; index++) assert.equal(showsExtendedChoice(index), false, `not under question ${index + 1}`);
  assert.equal(showsExtendedChoice(RISK_QUESTIONS.length), true, "the summary");
});

test("svar 2: the job menu's rows say where the job is; only the primary button names the next step", () => {
  const steps = jobStepRows({ kind: "WORK_ORDER", flow: order({ riskStep: { met: false, hint: "" } }) });
  assert.ok(steps.rows.every((row) => row.state !== "Nästa steg"), "no row says Nästa steg");
  assert.equal(steps.rows[0]!.state, CURRENT_STEP_STATE);
  assert.equal(CURRENT_STEP_STATE, "Du är här");
  // The primary button still opens and names that step.
  assert.equal(steps.next?.screen, "risk");
  assert.equal(jobRowAction(steps.next!), "Gör riskbedömningen");
});

test("svar 3: Tid on Hem opens the job whose time runs, else Tid", () => {
  assert.equal(homeTimeTileHref({ taskId: "t 1", kind: "WORK_ORDER" }, "/?view=time"), "/?view=workflow_task&taskId=t%201&taskType=WORK_ORDER");
  assert.equal(homeTimeTileHref(null, "/?view=time"), "/?view=time");
});

test("svar 4: Varför kan jag inte gå vidare? only while something hinders", () => {
  assert.equal(nextStepHinders(nextStepLine({ flow: order({ riskStep: { met: false, hint: "Svara på frågorna." } }) })), true, "the risk step");
  assert.equal(nextStepHinders(nextStepLine({ flow: order({ riskStep: { met: true, hint: "" } }) })), true, "work left on the line");
  assert.equal(nextStepHinders(nextStepLine({ flow: order(), blocked: "Du har inte behörighet." })), true, "a block");
  const ready = order({ executionNotes: "Bytt", signatureName: "Elin", signatureConfirmed: true });
  assert.equal(nextStepHinders(nextStepLine({ flow: ready, issues: [{ field: "x", message: "Fyll i X." }] })), true, "a requirement");
  assert.equal(nextStepHinders(nextStepLine({ flow: ready })), false, "everything done: Färdigställ is allowed");
  assert.equal(nextStepHinders(null), false);
});

test("svar 8: Hjälp's search reads the whole chapter texts and shows an excerpt", () => {
  const entries = [
    { key: "tid", title: "Tid", words: "tidrapport timmar" },
    { key: "ronder", title: "Driftronder och Kalender", words: "rond qr" },
  ];
  const texts = new Map([["ronder", "Kalendern är bara en planering. En rond startas från Driftronder, och QR-etiketten skrivs ut från ronden."], ["tid", "En tidtagning per person."]]);
  // By the title or words as before, without an excerpt.
  assert.deepEqual(searchHelpEntries(entries, "tidrapport", texts), [{ entry: entries[0] }]);
  // A word only in the text finds the chapter, with the text around it.
  const hits = searchHelpEntries(entries, "etiketten", texts);
  assert.deepEqual(hits.map((hit) => hit.entry.key), ["ronder"]);
  assert.match(hits[0]!.excerpt ?? "", /QR-etiketten skrivs ut/);
  // Every word must be found; title hits come before text hits.
  assert.deepEqual(searchHelpEntries(entries, "planering tidtagning", texts), []);
  assert.deepEqual(searchHelpEntries([...entries, { key: "planering", title: "Planering", words: "" }], "planering", texts).map((hit) => hit.entry.key), ["planering", "ronder"]);
  // Without the texts (not read yet) only the titles and words count.
  assert.deepEqual(searchHelpEntries(entries, "etiketten"), []);
  assert.deepEqual(searchHelpEntries(entries, "  ", texts), []);
});

test("svar 8: the excerpt is cut at spaces with … where the text goes on", () => {
  const text = `${"början ".repeat(20)}mitten av texten ${"slutet ".repeat(30)}`;
  const excerpt = helpExcerpt(text, ["mitten"], 20)!;
  assert.match(excerpt, /^….*mitten av texten.*…$/);
  assert.ok(!/\s…$/.test(excerpt) && !/^…\s/.test(excerpt), "no space beside the dots");
  assert.equal(helpExcerpt("Kort text.", ["kort"]), "Kort text.");
  assert.equal(helpExcerpt("Kort text.", ["saknas"]), undefined);
});
