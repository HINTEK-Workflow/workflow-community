/**
 * Säkerhetsavstämningen on a round occurrence's protocol: the check comes before the work, so a test that fills in a round's
 * protocol answers it first (Ja, Nej, Nej: the conditions hold) and presses Klart.
 */
async function confirmRoundSafety(page, { timeout = 30_000 } = {}) {
  const panel = page.getByTestId("round-safety");
  await panel.waitFor({ timeout });
  await page.getByTestId("round-safety-stillValid-yes").click();
  await page.getByTestId("round-safety-changed-no").click();
  await page.getByTestId("round-safety-newRisks-no").click();
  await page.getByTestId("round-safety-confirm").click();
  // On the phone the panel leaves the protocol once the check is done; elsewhere it stays and says so.
  await page.waitForFunction(() => { const shown = document.querySelector("[data-testid=round-safety]"); return !shown || shown.getAttribute("data-state") === "done"; }, undefined, { timeout });
}

module.exports = { confirmRoundSafety };
