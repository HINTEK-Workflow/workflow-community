/* eslint-disable @typescript-eslint/no-require-imports -- Read-only production browser smoke harness. */
const assert = require("node:assert/strict");
const { chromium } = require("/tmp/kfid-browser/node_modules/playwright");

const base = process.env.KFID_PRODUCTION_BASE_URL || "https://workflow.hintek.se";
const token = process.env.KFID_PRODUCTION_TOKEN;
if (!token) throw new Error("KFID_PRODUCTION_TOKEN is required");

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([
      {
        name: "__Secure-next-auth.session-token",
        value: token,
        url: base,
        httpOnly: true,
        secure: true,
      },
    ]);
    const overviewResponse = await context.request.get(`${base}/api/workspace`);
    assert.equal(overviewResponse.status(), 200);
    const overview = await overviewResponse.json();
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const response = await page.goto(`${base}/?view=settings`);
    assert.equal(response.status(), 200);
    const theme = page.locator("#theme");
    await theme.waitFor();
    assert.deepEqual(await theme.locator("option").evaluateAll((options) =>
      options.map((option) => option.value),
    ), ["light", "dark", "blue", "customer"]);
    const brand = page.getByLabel("HINTEK Workflow startsida").first();
    await brand.waitFor();
    await brand.getByText("KFID", { exact: true }).waitFor();
    assert.match(await brand.innerText(), /HINTEK|Workflow/i);
    for (const name of ["light", "dark", "blue", "customer"]) {
      await theme.selectOption(name);
      await page.waitForFunction(
        (selected) => document.documentElement.dataset.theme === selected,
        name,
      );
    }
    // The overview carries only the latest control and no customers; customers are read with action=customers.
    assert.ok(overview.controls.length <= 1);
    assert.equal(overview.customers, undefined);
    const customers = await (await context.request.get(`${base}/api/workspace?action=customers`)).json();
    assert.equal(customers.customers.length, 2);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
  }
  console.log("PASS production branding, four themes and unchanged workspace counts");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
