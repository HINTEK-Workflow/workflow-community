/* eslint-disable @typescript-eslint/no-require-imports -- Read-only production legal smoke. */
const assert = require("node:assert/strict");
const { chromium } = require("/tmp/kfid-browser/node_modules/playwright");

const base = process.env.KFID_PRODUCTION_BASE_URL || "https://workflow.hintek.se";
const token = process.env.KFID_PRODUCTION_TOKEN;
if (!token) throw new Error("KFID_PRODUCTION_TOKEN is required");

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addCookies([{ name: "__Secure-next-auth.session-token", value: token, url: base, httpOnly: true, secure: true }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const response = await page.goto(base);
    assert.equal(response.status(), 200);
    await page.getByRole("heading", { name: "Godkänn juridiska dokument" }).waitFor();
    await page.getByRole("heading", { name: "Tjänstevillkor för HINTEK Workflow" }).waitFor();
    await page.getByRole("heading", { name: "Integritetspolicy för HINTEK Workflow" }).waitFor();
    await page.getByRole("heading", { name: "Personuppgiftsbiträdesavtal för HINTEK Cloud" }).waitFor();
    await page.getByRole("button", { name: "Bekräfta alla och fortsätt" }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
  console.log("PASS published legal gate renders all required documents without accepting them");
})().catch((error) => { console.error(error); process.exit(1); });
