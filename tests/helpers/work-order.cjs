// Arbetsordern styr (2026-10-26): a task cannot exist without a work order, and Ny uppgift starts with "Vilken
// arbetsorder?". Browser tests about something else make a plain work order through the API (its risk step done) and
// open or post their tasks in it.
const RISK_DONE = { level: "simplified", answers: { deenergized: "yes", competence: "yes", height: "yes", others: "yes", special: "yes" }, confirmedBy: "QA", confirmedAt: "2026-10-08T06:00:00.000Z" };
const emptyOrder = { executionNotes: "", deviations: "", materials: [], signature: { name: "", confirmed: false, signedAt: null }, closeNotes: "" };

/**
 * A new work order through the API (as the signed-in person of `request`), with its risk step confirmed. `extra` sets the
 * project, customer, place, title and the like. Returns its id.
 */
async function createWorkOrder(request, base, extra = {}) {
  const response = await request.post(`${base}/api/workflow-tasks`, { headers: { origin: base }, data: { action: "save", task: {
    version: 0, kind: "WORK_ORDER", title: extra.title ?? "QA arbetsorder", description: "", status: "PLANNED", projectId: null, customerId: null, facilityId: null,
    assignedToUserId: null, assignedToName: "", dueDate: "", ...extra, data: { kind: "WORK_ORDER", details: emptyOrder, riskCheck: RISK_DONE },
  } } });
  const text = await response.text();
  if (!response.ok()) throw new Error(`Arbetsordern kunde inte skapas: ${response.status()} ${text}`);
  return JSON.parse(text).id;
}

/** An address with the work order a new task goes into (Ny uppgift, a new protocol). */
function withWorkOrder(url, workOrderId) {
  const next = new URL(url, "http://x");
  next.searchParams.set("workOrderId", workOrderId);
  return url.startsWith("http") ? next.toString() : `${next.pathname}${next.search}`;
}

/**
 * On a task without a work order (a draft, 2026-10-27): opens Koppla till arbetsorder and chooses the first open work order
 * offered (or `title`), as a person would on "Vilken arbetsorder?". Does nothing when the page already has one.
 */
async function chooseWorkOrder(page, { title, timeout = 15000 } = {}) {
  const choice = page.getByTestId("work-order-choice");
  if (!(await choice.isVisible().catch(() => false))) {
    const link = page.getByTestId("task-link-work-order").first();
    // Without Koppla till arbetsorder the page has its work order (or is no task page). With it, the choice is waited for as
    // long as any step: under a full run's load it can take more than a few seconds.
    try { await link.waitFor({ timeout: 5000 }); } catch { return; }
    // A click before the page is interactive is lost (customer-journey, 2026-10-28: the choice never opened, twice in full
    // runs): click again until the choice opens, within the same overall time.
    const until = Date.now() + timeout;
    for (;;) {
      await link.click();
      try { await choice.waitFor({ timeout: 3000 }); break; } catch (error) { if (Date.now() > until) throw error; }
      // The dialog opened but its content is slow (2026-10-30, a full run): its overlay would take every new click, so wait for it.
      if (await page.locator('[role="dialog"]').first().isVisible().catch(() => false)) { await choice.waitFor({ timeout: Math.max(1000, until - Date.now()) }); break; }
    }
  }
  // Left-over QA work orders can fill the list: with a title the search narrows it first.
  if (title) await choice.getByLabel("Sök arbetsorder").fill(title).catch(() => undefined);
  const option = title ?page.getByTestId("work-order-choice-option").filter({ hasText: title }).first() : page.getByTestId("work-order-choice-option").first();
  await option.waitFor({ timeout });
  await option.click();
  await choice.waitFor({ state: "detached", timeout });
  // A saved draft whose Grunduppgifter differ from the work order's is asked first (Arbetsordern som hållare, 2026-10-30).
  // Under a full run's load the question can come after more than a few seconds (customer-journey, 2026-10-31, twice):
  // wait for either the question or the linked page (its holder line), then answer the question if it came.
  const ask = page.getByTestId("confirm-card").filter({ hasText: "Koppla till arbetsordern?" });
  await ask.or(page.getByTestId("task-work-order-line")).first().waitFor({ timeout }).catch(() => undefined);
  if (await ask.isVisible().catch(() => false)) await ask.getByRole("button", { name: "Koppla", exact: true }).click();
}

/**
 * Arbetsordern håller driftronden (2026-10-27): nothing is made by itself, so a test that starts a round first makes
 * the round's work order for a period (today in Swedish time and a year on, unless `from`/`to` say otherwise), as Skapa
 * arbetsorder för ronden would, with its risk step confirmed. `extra` sets customer, place, project and title. Returns its id.
 */
async function createRoundWorkOrder(request, base, scheduleId, { from, to, ...extra } = {}) {
  const start = from ?? new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
  const end = to ?? `${Number(start.slice(0, 4)) + 1}${start.slice(4)}`;
  return createWorkOrder(request, base, { title: "QA rondens arbetsorder", ...extra, roundScheduleId: scheduleId, plannedStartDate: start, dueDate: end });
}

module.exports = { createWorkOrder, createRoundWorkOrder, withWorkOrder, chooseWorkOrder, RISK_DONE };
