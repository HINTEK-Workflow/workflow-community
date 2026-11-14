// Riskbedömning som steg (2026-10-08): every new job has a risk step that must be done before its time starts or it
// is completed. Browser tests about something else complete the simplified step first – on the page, or in the data they
// post (the server stamps who confirmed and when). The question ids follow lib/workflow/risk-step.ts.
const RISK_QUESTION_IDS = ["deenergized", "competence", "height", "others", "special"];
const RISK_STEP_DONE = {
  level: "simplified",
  answers: Object.fromEntries(RISK_QUESTION_IDS.map((id) => [id, "yes"])),
  confirmedBy: "QA",
  confirmedAt: "2026-10-08T06:00:00.000Z",
};
/** Task data with a confirmed simplified risk check. */
const riskDone = (data) => ({ ...data, riskCheck: RISK_STEP_DONE });

/** On an open task page: answer every question Ja and confirm, unless the step is already done (or the task has none). */
async function confirmRiskStep(page, { timeout = 15000 } = {}) {
  const panel = page.getByTestId("risk-step");
  await panel.waitFor({ timeout });
  if ((await panel.getAttribute("data-state")) === "done") return;
  // Arbetsordern styr (2026-10-26): a task's step is its work order's – confirmed there (through the API, as on its page).
  if ((await panel.getAttribute("data-on-work-order")) !== null) {
    const base = new URL(page.url()).origin;
    const request = page.context().request;
    const read = async (id) => (await (await request.get(`${base}/api/workflow-tasks?id=${encodeURIComponent(id)}`)).json()).tasks.find((item) => item.id === id);
    const task = await read(new URL(page.url()).searchParams.get("taskId"));
    const order = await read(task.workOrderId);
    const saved = await request.post(`${base}/api/workflow-tasks`, { headers: { origin: base }, data: { action: "save", task: { ...order, data: riskDone(order.data) } } });
    if (!saved.ok()) throw new Error(`Riskbedömningen på arbetsordern kunde inte bekräftas: ${saved.status()} ${await saved.text()}`);
    await page.reload();
    await page.waitForFunction(() => document.querySelector("[data-testid=risk-step]")?.getAttribute("data-state") === "done", undefined, { timeout });
    return;
  }
  // A computer lists the questions as rows of chips; the app (level 1) shows one question per screen with big buttons
  // (punkt 7) and moves on by itself, so the same loop answers both.
  // Each answer is waited in before the next (a click under load can land before the page has taken in the one before):
  // the list's radio is checked, or the app's question screen has moved on from it (or marks it pressed).
  // Under a full run's load a click can now and then be lost (N3 2026-11-06: the radio never got checked in 15 s; the panel
  // itself keeps an answer once taken): the answer is clicked again, up to three times, instead of one long wait. A second
  // Ja on the same question changes nothing.
  const taken = (question) => {
    const answer = document.querySelector(`[data-testid="risk-answer-${question}-yes"]`);
    if (answer instanceof HTMLInputElement) return answer.checked;
    if (answer?.getAttribute("aria-pressed") === "true") return true;
    return document.querySelector("[data-testid=risk-step-paged]")?.getAttribute("data-question") !== question;
  };
  const ATTEMPTS = 3;
  for (const id of RISK_QUESTION_IDS) {
    const target = page.locator(`label:has([data-testid="risk-answer-${id}-yes"]), button[data-testid="risk-answer-${id}-yes"]`);
    for (let attempt = 1; ; attempt += 1) {
      if (attempt === 1) await target.click({ timeout });
      // A retry only when the answer is still not taken (the app may have moved on to the next question meanwhile).
      else if (!(await page.evaluate(taken, id))) await target.click({ timeout: 5000 }).catch(() => undefined);
      const ok = await page.waitForFunction(taken, id, { timeout: attempt === ATTEMPTS ? timeout : 5000 }).then(() => true, () => false);
      if (ok) break;
      if (attempt === ATTEMPTS) throw new Error(`Riskfrågan ${id}: Ja togs inte emot efter ${ATTEMPTS} klick.`);
    }
  }
  // Bekräfta looks inactive and only tells why (aria-disabled, its reason line) until every answer is registered, and is
  // disabled while the page saves: a click before that does nothing, so wait until it is ready.
  await page.waitForFunction(() => {
    const button = document.querySelector("[data-testid=risk-step-confirm]");
    return button instanceof HTMLButtonElement && !button.disabled && !button.hasAttribute("aria-disabled") && !document.querySelector("[data-testid=risk-step-confirm-reason]");
  }, undefined, { timeout });
  await page.getByTestId("risk-step-confirm").click();
  await page.waitForFunction(() => document.querySelector("[data-testid=risk-step]")?.getAttribute("data-state") === "done", undefined, { timeout });
}

/**
 * A completed risk assessment of the older type, ready to post (a risk with its measure and the approval): the extended
 * step of a job links it with `riskExtended`. `extra` sets the project, customer, place and the like.
 */
const completedRiskAssessment = (title, extra = {}) => ({ version: 0, kind: "RISK_ASSESSMENT", title, description: "", status: "COMPLETED", projectId: null, customerId: null, facilityId: null,
  assignedToUserId: null, assignedToName: "QA", dueDate: "",
  data: { kind: "RISK_ASSESSMENT", details: { risks: [{ id: crypto.randomUUID(), hazard: "Spänningssatta delar intill", likelihood: 2, consequence: 4, protectiveMeasure: "Frånkoppla, lås och prova", residualLikelihood: 1, residualConsequence: 2 }],
    generalMeasures: "", approval: { name: "QA", confirmed: true, approvedAt: null } } }, ...extra });
/** Task data whose risk step is the completed extended assessment `assessmentId`. */
const riskExtended = (data, assessmentId) => ({ ...data, riskCheck: { level: "extended", answers: {}, confirmedBy: "", confirmedAt: null, extendedTaskId: assessmentId } });

/**
 * A saved task open on `page` (Cloud): a completed risk assessment is created through the API and linked
 * as the task's extended risk step, and the page is reloaded so it shows the step done. What the page holds must be saved
 * first (the reload reads the server's version). Returns the assessment's id, for the test's clean-up.
 */
async function linkCompletedRiskAssessment(page, { taskId = new URL(page.url()).searchParams.get("taskId"), extra = {}, timeout = 15000 } = {}) {
  const base = new URL(page.url()).origin;
  const request = page.context().request;
  const json = async (response) => { const text = await response.text(); if (!response.ok()) throw new Error(`${response.status()} ${text}`); return JSON.parse(text); };
  const save = async (task) => json(await request.post(`${base}/api/workflow-tasks`, { headers: { origin: base }, data: { action: "save", task } }));
  const read = async (id) => (await json(await request.get(`${base}/api/workflow-tasks?id=${encodeURIComponent(id)}`))).tasks.find((item) => item.id === id);
  const opened = await read(taskId);
  if (!opened) throw new Error(`Task ${taskId} was not found.`);
  // Arbetsordern styr (2026-10-26): the step is the work order's, and the assessment is a task in it.
  const task = opened.kind === "WORK_ORDER" ? opened : await read(opened.workOrderId);
  const { id } = await save(completedRiskAssessment(`Riskbedömning: ${task.title}`.slice(0, 200), { workOrderId: task.id, ...extra }));
  await save({ ...task, data: riskExtended(task.data, id) });
  await page.reload();
  await page.waitForFunction(() => document.querySelector("[data-testid=risk-step]")?.getAttribute("data-state") === "done", undefined, { timeout });
  return id;
}

module.exports = { RISK_QUESTION_IDS, RISK_STEP_DONE, riskDone, confirmRiskStep, completedRiskAssessment, riskExtended, linkCompletedRiskAssessment };
