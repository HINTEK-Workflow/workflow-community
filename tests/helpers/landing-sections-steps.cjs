/* eslint-disable @typescript-eslint/no-require-imports -- Browser test helper (CommonJS). */
const assert = require("node:assert/strict");

// The landing editor's new parts (owner 2026-11-04): buttons with address and visibility, free sections, order, pictures,
// the choice between his stored text and a new default. The steps run on an open editor page (the QA session in
// tests/landing-sections.browser.cjs); `answerUpload` is only used when the upload cannot reach a real server.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const confirmDialog = (page) => page.locator("[role=alertdialog], [role=dialog]").last();

async function runLandingSections(page, { marker }) {
  const canvas = page.getByTestId("landing-canvas");
  const save = page.getByTestId("landing-save");
  const ribbon = page.getByTestId("landing-ribbon");
  const saveStatus = page.getByTestId("landing-save-status");
  const unsaved = () => saveStatus.filter({ hasText: /inte är sparade/ }).waitFor();

  // ---- A button: its text in place, its address and visibility in the panel.
  const first = canvas.getByRole("textbox", { name: "Överst – knapp 1", exact: true });
  await first.waitFor();
  await first.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(`Prova ${marker}`);
  await page.keyboard.press("Enter");
  await unsaved();
  const settings = page.getByTestId("landing-link-settings");
  await settings.waitFor();
  const address = settings.getByLabel("Adress", { exact: true });
  assert.equal(await address.inputValue(), "/demo?via=button", "the primary button leads to the demo and counts the start");
  await address.fill("javascript:alert(1)");
  await settings.getByTestId("landing-link-href-error").waitFor();
  assert.equal(await canvas.locator('[data-testid="landing-demo"]').getAttribute("href").then((href) => href.includes("javascript")), false, "a wrong address is never taken");
  await address.fill("/demo?via=button&x=1");
  await page.waitForFunction(() => document.querySelector('[data-testid="landing-demo"]')?.getAttribute("href")?.endsWith("/demo?via=button&x=1"));
  await settings.getByLabel("Vanliga adresser").selectOption("/login");
  await page.waitForFunction(() => document.querySelector('[data-testid="landing-demo"]')?.getAttribute("href")?.endsWith("/login"));
  await settings.getByLabel("Vanliga adresser").selectOption("/demo?via=button");
  // Hide the second button: dimmed in the editor, gone in the preview.
  await canvas.getByRole("textbox", { name: "Överst – knapp 2", exact: true }).click();
  await settings.getByRole("checkbox", { name: "Visas" }).click();
  await page.waitForFunction(() => document.querySelector('[data-landing-select="link:hero.buttons.1"]')?.getAttribute("data-off") === "true");

  // ---- A new button next to it (the ribbon), then removed again.
  await ribbon.getByRole("button", { name: "Knapp", exact: true }).click();
  await canvas.getByRole("textbox", { name: "Överst – knapp 4", exact: true }).waitFor();
  await settings.getByTestId("landing-link-remove").click();
  assert.equal(await canvas.getByRole("textbox", { name: "Överst – knapp 4", exact: true }).count(), 0);

  // ---- The header's buttons and the menu are editable too.
  // Logga in is the person icon in the blue bar (2026-11-12), selectable in the editor.
  await canvas.getByTestId("landing-login-top").first().waitFor();
  await canvas.getByRole("textbox", { name: "Meny – länk 1", exact: true }).click();
  await settings.waitFor();
  assert.equal(await settings.getByLabel("Adress", { exact: true }).inputValue(), "#t-controls");
  // The company's blue bar (2026-11-12): its own links, set in Sidhuvud, drawn on the page at once.
  await canvas.getByTestId("landing-company-bar").click({ position: { x: 4, y: 4 } });
  const company = page.getByTestId("landing-company-settings");
  await company.waitFor();
  await company.locator("#landing-company-item-0-label").fill(`Hem ${marker}`);
  await canvas.getByTestId("landing-company-bar").getByRole("link", { name: `Hem ${marker}` }).waitFor();
  await company.locator("#landing-company-item-0-href").fill("javascript:alert(1)");
  await company.getByRole("alert").first().waitFor();

  // ---- A free section: text in place, points, order, visibility.
  const machineTitle = canvas.getByRole("textbox", { name: "Maskinkoppling och larm – rubrik", exact: true });
  await machineTitle.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(`Maskinlarm ${marker}`);
  await page.keyboard.press("Enter");
  await canvas.getByRole("textbox", { name: "Maskinkoppling och larm – rubrik", exact: true }).filter({ hasText: marker }).waitFor();
  const before = await canvas.locator("section[id^='t-']").evaluateAll((nodes) => nodes.map((node) => node.id));
  await canvas.getByRole("button", { name: /^Flytta Maskinkoppling och larm nedåt$/ }).click();
  const after = await canvas.locator("section[id^='t-']").evaluateAll((nodes) => nodes.map((node) => node.id));
  assert.notDeepEqual(after, before, "a section moves");
  assert.equal(after[before.indexOf("t-machine") + 1], "t-machine", "it moved one step down");
  await canvas.getByTestId("section-toggle-topic:operator").click();
  assert.equal(await canvas.getByTestId("section-toggle-topic:operator").getAttribute("aria-pressed"), "false", "a section can be hidden");
  await canvas.getByTestId("section-toggle-topic:operator").click();
  await canvas.locator('[data-landing-select="topic:ai"]').click({ position: { x: 4, y: 40 } });
  const topic = page.getByTestId("landing-topic-settings");
  await topic.waitFor();
  const bullets = canvas.locator("#t-ai li");
  const bulletCount = await bullets.count();
  await topic.getByTestId("landing-topic-add-bullet").click();
  assert.equal(await bullets.count(), bulletCount + 1, "a point is added");
  await topic.getByRole("button", { name: `Ta bort punkt ${bulletCount + 1}` }).click();
  assert.equal(await bullets.count(), bulletCount, "and removed");

  // ---- Its picture: choose one of ours, upload one of his own, remove it.
  await topic.locator("#landing-topic-image-library").selectOption("/landing/operator-terminal.webp");
  await page.waitForFunction(() => document.querySelector("#t-ai img")?.getAttribute("src") === "/landing/operator-terminal.webp");
  await topic.getByTestId("landing-topic-image-file").setInputFiles({ name: "egen.png", mimeType: "image/png", buffer: PNG });
  // The upload's own address (/landing-images/…), not the library picture chosen just before: removing it before the upload
  // has answered would let the late answer put the picture back.
  await page.waitForFunction(() => /^\/landing-images\/[A-Za-z0-9._-]+\.webp$/.test(document.querySelector("#t-ai img")?.getAttribute("src") ?? ""), null, { timeout: 15000 });
  await topic.getByTestId("landing-topic-image-remove").click();
  await canvas.locator("#t-ai").getByTestId("landing-image-empty").waitFor();
  await topic.getByTestId("landing-topic-image-remove").waitFor();
  await topic.locator("#landing-topic-image-library").selectOption("/landing/ai-simulering.webp");

  // ---- A section of his own: added before the closing part, edited, removed.
  await ribbon.getByRole("button", { name: "Avsnitt", exact: true }).click();
  const added = canvas.getByRole("textbox", { name: "Nytt avsnitt – rubrik", exact: true });
  await added.waitFor();
  await added.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Mitt avsnitt");
  await page.keyboard.press("Enter");
  await canvas.getByRole("textbox", { name: "Nytt avsnitt – rubrik", exact: true }).filter({ hasText: "Mitt avsnitt" }).waitFor();
  const ids = await canvas.locator("section[id^='t-']").evaluateAll((nodes) => nodes.map((node) => node.id));
  assert.ok(ids[ids.length - 1].startsWith("t-avsnitt-"), "the new section is last of the free ones, before the closing part");
  await ribbon.getByRole("button", { name: "Ta bort", exact: true }).click();
  await confirmDialog(page).getByRole("button", { name: "Ta bort", exact: true }).click();
  await canvas.getByRole("textbox", { name: "Nytt avsnitt – rubrik", exact: true }).waitFor({ state: "detached" });

  // ---- Frågor och svar (2026-11-11): a question added from the ribbon, written in place (the panel follows), moved; one removed in the panel.
  const faqItems = canvas.getByTestId("landing-faq-item");
  const faqCount = await faqItems.count();
  await ribbon.getByRole("button", { name: "Fråga", exact: true }).click();
  const faqPanel = page.getByTestId("landing-faq-settings");
  await faqPanel.waitFor();
  assert.equal(await faqItems.count(), faqCount + 1, "a question is added");
  await canvas.getByRole("textbox", { name: `Fråga ${faqCount + 1}`, exact: true }).click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(`Fråga ${marker}?`);
  await page.keyboard.press("Enter");
  await page.waitForFunction((text) => [...document.querySelectorAll("[data-testid=landing-faq-settings] input")].some((input) => input.value === text), `Fråga ${marker}?`);
  await faqPanel.getByRole("button", { name: `Flytta fråga ${faqCount + 1} upp` }).click();
  await canvas.getByRole("textbox", { name: `Fråga ${faqCount}`, exact: true }).filter({ hasText: marker }).waitFor();
  await faqPanel.getByRole("button", { name: `Ta bort fråga ${faqCount + 1}` }).click();
  assert.equal(await faqItems.count(), faqCount, "the last default question is removed, the new one stays");

  // ---- The preview leaves out what is hidden.
  await page.getByRole("radio", { name: "Förhandsgranska" }).or(page.getByRole("button", { name: "Förhandsgranska" })).first().click();
  assert.equal(await page.locator('[data-landing-select="link:hero.buttons.1"]').count(), 0, "a hidden button is not in the preview");
  await page.getByRole("radio", { name: "Redigera" }).or(page.getByRole("button", { name: "Redigera", exact: true })).first().click();

  // ---- Saved: the request carries the new parts, and the page shows them signed out.
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/administration/pricing") && response.request().method() === "PATCH");
  await save.click();
  const response = await saved;
  assert.equal(response.status(), 200, "the new parts are accepted by the server's schema");
  const sent = response.request().postDataJSON().landing;
  assert.ok(sent.topics.some((item) => item.title === `Maskinlarm ${marker}`) && sent.hero.buttons[0].label === `Prova ${marker}` && sent.hero.buttons[1].visible === false);
  assert.ok(sent.faq.items.some((item) => item.question === `Fråga ${marker}?`), "the questions are saved with the page");
  assert.ok(sent.layout.length >= 10 && sent.header.nav.length === 3, "the light bar: Kontroller, Maskiner and AI (2026-11-12)");
  assert.equal(sent.header.company.items[0].label, `Hem ${marker}`, "the blue bar's own links are saved");
  assert.ok(sent.header.company.items[0].href.startsWith("https://"), "an unsafe address is never stored");
  await saveStatus.filter({ hasText: /sparad/ }).waitFor();
  return { sent };
}

/**
 * Funktionssidorna (2026-11-14): a card's Läs mer opens its page in the same canvas ("Redigera undersidan"), its texts are
 * written in place, the page is hidden and shown again from the list of pages, and a card gets another icon. Then saved.
 */
async function runLandingSubpages(page, { marker }) {
  const canvas = page.getByTestId("landing-canvas");
  const ribbon = page.getByTestId("landing-ribbon");
  await page.getByTestId("landing-ribbon").getByRole("button", { name: "Startsidan", exact: true }).click();
  // Eight cards, four in a row, each with its area icon; a card's settings in the panel.
  assert.equal(await canvas.getByTestId("landing-feature-card").count(), 8);
  await canvas.locator('[data-landing-select="card:1"]').click({ position: { x: 4, y: 4 } });
  const cardPanel = page.getByTestId("landing-card-settings");
  await cardPanel.waitFor();
  await cardPanel.locator("#landing-card-icon").selectOption("project");
  await canvas.locator('[data-landing-select="card:1"] [data-area="project"]').waitFor();
  await cardPanel.locator("#landing-card-icon").selectOption("calendar");
  // Redigera undersidan: the page on the canvas, its texts in place.
  await canvas.getByTestId("landing-edit-page-planering").click();
  await canvas.getByTestId("landing-subpage").waitFor();
  const title = canvas.getByRole("textbox", { name: "Undersida – rubrik", exact: true });
  await title.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(`Planering ${marker}`);
  await page.keyboard.press("Enter");
  await canvas.getByRole("textbox", { name: "Undersida – rubrik", exact: true }).filter({ hasText: marker }).waitFor();
  const settings = page.getByTestId("landing-page-settings");
  await settings.waitFor();
  await settings.getByTestId("landing-page-seo-title").fill(`Planering i Workflow ${marker}`);
  // Hidden: its Läs mer is dimmed on the start page; shown again from the list of pages.
  await settings.getByTestId("landing-page-visible").click();
  await ribbon.getByRole("button", { name: "Startsidan", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-landing-select="card:1"] [data-testid="landing-read-more-card"]')?.getAttribute("data-off") === "true");
  await ribbon.getByRole("button", { name: "Undersidor", exact: true }).click();
  const list = page.getByTestId("landing-pages-settings");
  await list.waitFor();
  await list.getByTestId("landing-pages-toggle-planering").click();
  await page.waitForFunction(() => !document.querySelector('[data-landing-select="card:1"] [data-testid="landing-read-more-card"]')?.getAttribute("data-off"));
  // Opened from the list too.
  await list.getByTestId("landing-pages-open-underhall").click();
  await canvas.getByRole("textbox", { name: "Undersida – rubrik", exact: true }).filter({ hasText: "Maskiner, planer, förråd och kostnader" }).waitFor();
  await ribbon.getByRole("button", { name: "Startsidan", exact: true }).click();
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/administration/pricing") && response.request().method() === "PATCH");
  await page.getByTestId("landing-save").click();
  const response = await saved;
  assert.equal(response.status(), 200, "the pages are accepted by the server's schema");
  const sent = response.request().postDataJSON().landing;
  const planning = sent.pages.items.find((item) => item.slug === "planering");
  assert.ok(planning.title === `Planering ${marker}` && planning.visible === true && planning.seo.title.includes(marker));
  assert.equal(sent.features.items.length, 8);
  return { sent };
}

/** A feature page as a visitor sees it: the landing page's top and footer, the saved texts, its own title, no sideways scroll at 320 px. */
async function runPublicSubpage(publicPage, base, { marker }) {
  await publicPage.goto(`${base}/funktioner/planering`);
  await publicPage.getByTestId("landing-subpage").waitFor();
  await publicPage.getByRole("heading", { level: 1, name: `Planering ${marker}` }).waitFor();
  assert.ok((await publicPage.title()).includes(`Planering i Workflow ${marker}`), "its own title in search results");
  await publicPage.getByTestId("landing-header").waitFor();
  assert.equal(await publicPage.locator("[contenteditable]").count(), 0);
  for (const width of [320, 768, 1440]) {
    await publicPage.setViewportSize({ width, height: 900 });
    assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no sideways page scroll at ${width} px`);
  }
  assert.equal((await publicPage.goto(`${base}/funktioner/finns-inte`)).status(), 404, "an unknown page answers 404");
}

/** Reset: the ribbon's Standardtexter brings back every default, also the sections and buttons. */
async function runLandingReset(page, { marker }) {
  const canvas = page.getByTestId("landing-canvas");
  await page.getByTestId("landing-ribbon").getByRole("button", { name: "Standardtexter", exact: true }).click();
  await confirmDialog(page).getByRole("button", { name: "Återställ", exact: true }).click();
  await canvas.getByRole("textbox", { name: "Överst – knapp 1", exact: true }).filter({ hasNotText: marker }).waitFor();
  await canvas.getByRole("textbox", { name: "Maskinkoppling och larm – rubrik", exact: true }).filter({ hasNotText: marker }).waitFor();
  assert.equal(await page.locator('[data-landing-select="link:hero.buttons.1"]').getAttribute("data-off"), null, "the hidden button is back");
  // A single section back to its default text.
  await canvas.getByRole("textbox", { name: "Kontroller och formulär – rubrik", exact: true }).click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Annan rubrik");
  await page.keyboard.press("Enter");
  await canvas.locator('[data-landing-select="topic:controls"]').click({ position: { x: 4, y: 40 } });
  await page.getByTestId("landing-topic-reset").click();
  await canvas.getByRole("textbox", { name: "Kontroller och formulär – rubrik", exact: true }).filter({ hasNotText: "Annan rubrik" }).waitFor();
}

/** The notice about new default texts: his own text is listed, never replaced by itself; he chooses per part. */
async function runStaleNotice(page, { keepMine }) {
  const notice = page.getByTestId("landing-stale-notice");
  await notice.waitFor();
  const canvas = page.getByTestId("landing-canvas");
  const own = await canvas.getByRole("textbox", { name: "Funktioner – rubrik", exact: true }).textContent();
  assert.equal(own, "Min egen funktionsrubrik", "his text stands");
  if (keepMine) {
    await page.getByTestId("landing-keep-mine").click();
    await notice.waitFor({ state: "detached" });
    assert.equal(await canvas.getByRole("textbox", { name: "Funktioner – rubrik", exact: true }).textContent(), "Min egen funktionsrubrik");
  } else {
    await page.getByTestId("landing-use-default-features").click();
    await notice.waitFor({ state: "detached" });
    assert.notEqual(await canvas.getByRole("textbox", { name: "Funktioner – rubrik", exact: true }).textContent(), "Min egen funktionsrubrik");
  }
}

module.exports = { runLandingSections, runLandingSubpages, runPublicSubpage, runLandingReset, runStaleNotice };
