// The app view on a phone (A2, 2026-10-22): a page made for a larger screen is drawn as a short box with "Visa sidan"
// (components/native/hidden-page.tsx) until the person turns on Visa mer for that page, which the device remembers.
// Whether a test meets the box therefore depends on what came before it in the same browser, and the page itself is
// first drawn before the shell has decided (the server's guess), so "count() right now" raced it (feature-settings and
// mobile-navigation-qa, 2026-10-24). These helpers wait for states, never for a fixed time.

/** The shell has decided device, level and the app look (`html[data-shell=ready]`, components/app-shell.tsx). */
async function waitForShell(page, { timeout = 30_000 } = {}) {
  await page.waitForSelector("html[data-shell=ready]", { timeout });
}

/** Two animation frames: what the last state change drew has been painted. */
const settleFrames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

/**
 * Opens the page in the app view even when it is made for a larger screen: waits until `ready` (a locator for the page
 * itself) is shown and stays, pressing "Visa sidan" when the box is shown instead. Works the same when the device already
 * shows more (no box), and on a larger screen. Returns whether "Visa sidan" was pressed.
 */
async function openInAppView(page, ready, { timeout = 30_000 } = {}) {
  const deadline = Date.now() + timeout;
  const left = () => Math.max(1, deadline - Date.now());
  await waitForShell(page, { timeout: left() });
  const box = page.getByTestId("native-hidden-switch");
  let pressed = false;
  while (Date.now() < deadline) {
    await ready.or(box).first().waitFor({ timeout: left() });
    if (await box.isVisible()) {
      if (await box.isEnabled()) { await box.click({ timeout: left() }); pressed = true; }
      await settleFrames(page);
      continue;
    }
    // The page is shown: it must still be there once the shell's next frame is drawn (not the server's first guess).
    await settleFrames(page);
    if (await ready.isVisible() && !(await box.isVisible())) return pressed;
  }
  throw new Error(`openInAppView: the page did not open within ${timeout} ms (${page.url()})`);
}

/**
 * The bars of the ordinary pages (header, bottom bar) are back: at the top of the page they are always shown, while a
 * scroll by the app itself (an autosave moving the current step) can have slid them away for a moment.
 */
async function barsShown(page, { timeout = 10_000 } = {}) {
  await page.waitForFunction(() => {
    window.scrollTo(0, 0);
    return !document.querySelector(".workspace-shell")?.hasAttribute("data-chrome-hidden");
  }, null, { timeout, polling: 100 });
  await settleFrames(page);
}

/**
 * Visa mer on the open page of the app on a phone (components/native/show-more.tsx): the whole page's content (level 3),
 * whatever an earlier test left as the person's phone choice (Visa allt on or off). The button is only drawn once the
 * page knows it has more, so it is waited for a moment; without it (Visa allt already on, or nothing more) nothing is
 * pressed. Ends when the content level is 3. Returns whether Visa mer was pressed.
 */
async function showMoreOnPage(page, { timeout = 10_000 } = {}) {
  await waitForShell(page, { timeout: 30_000 });
  const content = () => page.evaluate(() => document.documentElement.dataset.detail);
  if (await content() === "3") return false;
  const button = page.getByTestId("show-more");
  await button.waitFor({ timeout }).catch(() => {});
  if (!(await button.count()) || (await button.textContent()).trim() !== "Visa mer") return false;
  await button.click();
  await page.waitForFunction(() => document.documentElement.dataset.detail === "3", null, { timeout });
  await settleFrames(page);
  return true;
}

module.exports = { waitForShell, openInAppView, showMoreOnPage, barsShown, settleFrames };
