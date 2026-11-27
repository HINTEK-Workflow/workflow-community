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
  assert.equal(await settings.getByLabel("Adress", { exact: true }).inputValue(), "#steg-start");
  // The company's blue bar (2026-11-12): its own links, set in Sidhuvud, drawn on the page at once.
  await canvas.getByTestId("landing-company-bar").click({ position: { x: 4, y: 4 } });
  const company = page.getByTestId("landing-company-settings");
  await company.waitFor();
  await company.locator("#landing-company-item-0-label").fill(`Hem ${marker}`);
  await canvas.getByTestId("landing-company-bar").getByRole("link", { name: `Hem ${marker}` }).waitFor();
  await company.locator("#landing-company-item-0-href").fill("javascript:alert(1)");
  await company.getByRole("alert").first().waitFor();

  // ---- A free section: text in place, points, order, visibility.
  const machineTitle = canvas.getByRole("textbox", { name: "Steg 1 – rubrik", exact: true });
  await machineTitle.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(`Maskinlarm ${marker}`);
  await page.keyboard.press("Enter");
  await canvas.getByRole("textbox", { name: "Steg 1 – rubrik", exact: true }).filter({ hasText: marker }).waitFor();
  const before = await canvas.locator("section[id^='t-']").evaluateAll((nodes) => nodes.map((node) => node.id));
  await canvas.getByRole("button", { name: /^Flytta Steg 1 nedåt$/ }).click();
  const after = await canvas.locator("section[id^='t-']").evaluateAll((nodes) => nodes.map((node) => node.id));
  assert.notDeepEqual(after, before, "a section moves");
  assert.equal(after[before.indexOf("t-start1") + 1], "t-start1", "it moved one step down");
  await canvas.getByTestId("section-toggle-topic:start3").click();
  assert.equal(await canvas.getByTestId("section-toggle-topic:start3").getAttribute("aria-pressed"), "false", "a section can be hidden");
  await canvas.getByTestId("section-toggle-topic:start3").click();
  await canvas.locator('[data-landing-select="topic:start3"]').click({ position: { x: 4, y: 40 } });
  const topic = page.getByTestId("landing-topic-settings");
  await topic.waitFor();
  // Only the points: the section's pictures (Kom igång's gallery) are list items too.
  const bullets = canvas.locator("#t-start3 [data-testid='landing-topic-bullets'] > li");
  const bulletCount = await bullets.count();
  await topic.getByTestId("landing-topic-add-bullet").click();
  assert.equal(await bullets.count(), bulletCount + 1, "a point is added");
  await topic.getByRole("button", { name: `Ta bort punkt ${bulletCount + 1}` }).click();
  assert.equal(await bullets.count(), bulletCount, "and removed");

  // ---- Its picture: choose one of ours, upload one of his own, remove it.
  await topic.locator("#landing-topic-image-library").selectOption("/landing/felanmalan-operatorsterminal.webp");
  // The section's own picture window, not its gallery (Kom igång has both).
  await page.waitForFunction(() => document.querySelector("#t-start3 [data-testid='landing-topic-window'] img")?.getAttribute("src") === "/landing/felanmalan-operatorsterminal.webp");
  await topic.getByTestId("landing-topic-image-file").setInputFiles({ name: "egen.png", mimeType: "image/png", buffer: PNG });
  // The upload's own address (/landing-images/…), not the library picture chosen just before: removing it before the upload
  // has answered would let the late answer put the picture back.
  await page.waitForFunction(() => /^\/landing-images\/[A-Za-z0-9._-]+\.webp$/.test(document.querySelector("#t-start3 [data-testid='landing-topic-window'] img")?.getAttribute("src") ?? ""), null, { timeout: 15000 });
  await topic.getByTestId("landing-topic-image-remove").click();
  await canvas.locator("#t-start3").getByTestId("landing-image-empty").waitFor();
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
  assert.ok(sent.layout.length >= 10 && sent.header.nav.length === 3, "the menu: Kom igång, Resten av arbetet and Planer (2026-11-16)");
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
  // Thirteen cards, four in a row (Planering is the fifth, Tavlor och skärmar the sixth since 2026-11-21), each with its area icon; a card's settings in the panel.
  assert.equal(await canvas.getByTestId("landing-feature-card").count(), 13);
  await canvas.locator('[data-landing-select="card:4"]').click({ position: { x: 4, y: 4 } });
  const cardPanel = page.getByTestId("landing-card-settings");
  await cardPanel.waitFor();
  await cardPanel.locator("#landing-card-icon").selectOption("project");
  await canvas.locator('[data-landing-select="card:4"] [data-area="project"]').waitFor();
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
  await page.waitForFunction(() => document.querySelector('[data-landing-select="card:4"] [data-testid="landing-read-more-card"]')?.getAttribute("data-off") === "true");
  await ribbon.getByRole("button", { name: "Undersidor", exact: true }).click();
  const list = page.getByTestId("landing-pages-settings");
  await list.waitFor();
  await list.getByTestId("landing-pages-toggle-planering").click();
  await page.waitForFunction(() => !document.querySelector('[data-landing-select="card:4"] [data-testid="landing-read-more-card"]')?.getAttribute("data-off"));
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
  assert.equal(sent.features.items.length, 13);
  return { sent };
}

/**
 * Kom igång with films (2026-11-19): the first step gets a film, subtitles and a poster in the section's panel, sent to our
 * own server in pieces (a film just over 8 MB is five pieces of at most 2 MB), and is saved. The film is a buffer that starts like an mp4 (ftyp); the
 * test needs no real film, the browser's player only has to get it from our own address.
 */
async function runLandingFilm(page, { marker }) {
  const canvas = page.getByTestId("landing-canvas");
  await page.getByTestId("landing-ribbon").getByRole("button", { name: "Startsidan", exact: true }).click();
  await canvas.locator('[data-landing-select="topic:start1"]').click({ position: { x: 4, y: 40 } });
  const topic = page.getByTestId("landing-topic-settings");
  const film = topic.getByTestId("landing-topic-film-settings");
  await film.waitFor();
  // A film left from an earlier run (Standardtexter keeps films) is removed first.
  if (/Film uppladdad/.test(await film.getByTestId("landing-topic-film-state").innerText())) await film.getByTestId("landing-topic-film-remove").click();
  await film.getByTestId("landing-topic-film-state").filter({ hasText: /^Ingen film uppladdad\./ }).waitFor();
  const bytes = Buffer.alloc(8 * 1024 * 1024 + 4096, 7);
  bytes.set([0, 0, 0, 0x20, ...Buffer.from("ftypisom")]);
  // Pieces of 2 MB, each the request's raw body with its place in the address (2026-11-24).
  const pieces = [];
  const listen = (response) => {
    const url = new URL(response.url());
    if (url.pathname === "/api/administration/landing-films" && response.request().method() === "POST" && url.searchParams.get("kind") === "film")
      pieces.push([response.status(), Number(url.searchParams.get("offset")), response.request().headers()["content-type"]]);
  };
  page.on("response", listen);
  await film.getByTestId("landing-topic-film-file").setInputFiles({ name: "film.mp4", mimeType: "video/mp4", buffer: bytes });
  // A regular expression: a plain hasText would also match "Ingen film uppladdad." (case and position are ignored).
  await film.getByTestId("landing-topic-film-state").filter({ hasText: /^Film uppladdad\./ }).waitFor({ timeout: 60000 });
  const piece = 2 * 1024 * 1024;
  assert.deepEqual(pieces, Array.from({ length: Math.ceil(bytes.length / piece) }, (_, index) => [200, index * piece, "application/octet-stream"]), "the film went in pieces of 2 MB, in order");
  // A file that is no film is refused with a plain message, and the film stays.
  await film.getByTestId("landing-topic-film-file").setInputFiles({ name: "film.mp4", mimeType: "video/mp4", buffer: Buffer.from("<html>inte en film</html>") });
  await film.getByRole("alert").filter({ hasText: "Filen är ingen MP4-film." }).waitFor();
  await film.getByTestId("landing-topic-film-subtitles-file").setInputFiles({ name: "film.vtt", mimeType: "text/vtt", buffer: Buffer.from("WEBVTT\n\n1\n00:00:00.500 --> 00:00:02.000\nHej och välkommen.\n") });
  await film.getByTestId("landing-topic-film-state").filter({ hasText: /Undertexter uppladdade\./ }).waitFor();
  page.off("response", listen);
  await film.locator("#landing-topic-film-play").fill(`Se filmen ${marker}`);
  await film.getByTestId("landing-topic-film-poster-image-file").setInputFiles({ name: "omslag.png", mimeType: "image/png", buffer: PNG });
  // The canvas shows the poster and the button (which does not play in the editor).
  const shown = canvas.locator("#t-start1").getByTestId("landing-topic-film");
  await shown.waitFor();
  await page.waitForFunction(() => /^\/landing-images\//.test(document.querySelector("#t-start1 [data-testid='landing-topic-film'] img")?.getAttribute("src") ?? ""), null, { timeout: 15000 });
  assert.equal(await shown.getByTestId("landing-topic-film-play").isDisabled(), true, "the film does not play in the editor");
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/administration/pricing") && response.request().method() === "PATCH");
  await page.getByTestId("landing-save").click();
  const response = await saved;
  assert.equal(response.status(), 200, "the film is accepted by the server's schema");
  const sent = response.request().postDataJSON().landing.topics.find((item) => item.id === "start1").film;
  assert.match(sent.src, /^\/landing-films\/[a-f0-9-]{36}\.mp4$/);
  assert.match(sent.subtitles, /^\/landing-films\/[a-f0-9-]{36}\.vtt$/);
  assert.equal(sent.playLabel, `Se filmen ${marker}`);
  return { film: sent, size: bytes.length };
}

/**
 * The film as a visitor sees it: the poster and the button, nothing of the film fetched before the click, then the browser's own
 * player with controls and the subtitles to choose, from our own address with Range. Phone and computer widths without sideways scroll.
 */
async function runPublicFilm(publicPage, base, { film, size, marker }) {
  const requests = [];
  publicPage.on("request", (request) => requests.push(request.url()));
  // The content policy (docs/drift/CSP.md): the film and its subtitles break no rule, also where the policy only reports.
  await publicPage.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`));
  });
  for (const width of [390, 1440]) {
    await publicPage.setViewportSize({ width, height: 900 });
    const answer = await publicPage.goto(`${base}/`);
    // The full policy is report-only until CSP_ENFORCE is set; the enforced header then carries only the thin one.
    const policy = [answer.headers()["content-security-policy"], answer.headers()["content-security-policy-report-only"]].filter(Boolean).join(" | ");
    assert.match(policy, /media-src 'self'(?: blob:)?;/, "media only from our own origin");
    const section = publicPage.locator("#t-start1");
    const play = section.getByTestId("landing-topic-film-play");
    await play.scrollIntoViewIfNeeded();
    // The button's own words and the section's heading (which an earlier step has written).
    assert.ok((await play.getAttribute("aria-label")).startsWith(`Se filmen ${marker}: `), await play.getAttribute("aria-label"));
    assert.equal(await section.locator("video").count(), 0, "no player before the click");
    assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no sideways page scroll at ${width} px`);
  }
  assert.ok(!requests.some((url) => url.includes("/landing-films/")), "nothing of the film is fetched before the click");
  // The step's film fills the card's content (2026-11-20): as wide as the text column it stands in.
  const frame = await publicPage.locator("#t-start1").getByTestId("landing-topic-film").boundingBox();
  const column = await publicPage.locator("#t-start1").getByTestId("landing-topic-film").evaluate((node) => node.parentElement.getBoundingClientRect().width);
  assert.ok(Math.abs(frame.width - column) < 2, `the film is as wide as the card's content (${frame.width} of ${column} px)`);
  assert.ok(Math.abs(frame.width / frame.height - 16 / 9) < 0.05, "16:9");
  const own = new URL(base).host;
  const fetched = publicPage.waitForRequest((request) => request.url().includes("/landing-films/"), { timeout: 15000 });
  await publicPage.locator("#t-start1").getByTestId("landing-topic-film-play").click();
  // The pop-up (2026-11-20): never in place; as wide as the window allows up to 1200 px at 1440.
  const dialog = publicPage.getByTestId("landing-film-dialog");
  await dialog.waitFor();
  assert.equal(await publicPage.locator("#t-start1 video").count(), 0, "not in place");
  const video = dialog.getByTestId("landing-film-video");
  await video.waitFor();
  const shown = await video.boundingBox();
  assert.ok(shown.width >= 1000 && shown.width <= 1201, `a large pop-up at 1440 px (${Math.round(shown.width)} px)`);
  assert.ok(Math.abs(shown.width / shown.height - 16 / 9) < 0.05, "16:9 in the pop-up");
  assert.equal(await video.getAttribute("src"), film.src);
  assert.equal(await video.getAttribute("preload"), "metadata");
  assert.ok(await video.evaluate((node) => node.controls), "the browser's own controls");
  const track = video.locator("track");
  assert.equal(await track.getAttribute("label"), "Svenska");
  assert.equal(await track.getAttribute("srclang"), "sv");
  assert.equal(await track.evaluate((node) => node.default), false, "the subtitles are chosen in the player, not shown from the start");
  await fetched;
  assert.ok(requests.filter((url) => url.includes("/landing-films/")).every((url) => new URL(url).host === own), "only from our own server");
  assert.deepEqual(await publicPage.evaluate(() => window.__cspViolations.filter((line) => /media|landing-films/.test(line))), [], "the film breaks no content policy rule");
  // Esc closes it, and the page scrolls again.
  await publicPage.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.ok(await publicPage.evaluate(() => document.documentElement.style.overflow !== "hidden"));
  // Range: a part of the film, as the player asks when the visitor seeks.
  const part = await publicPage.request.get(`${base}${film.src}`, { headers: { Range: "bytes=100-199" } });
  assert.equal(part.status(), 206);
  assert.equal(part.headers()["content-range"], `bytes 100-199/${size}`);
  assert.equal((await part.body()).length, 100);
  assert.match(part.headers()["cache-control"] ?? "", /immutable/);
  const subtitles = await publicPage.request.get(`${base}${film.subtitles}`);
  assert.match(subtitles.headers()["content-type"] ?? "", /^text\/vtt/);
}

/** A small buffer that starts like an mp4 (ftyp): the editor and the server only check the first bytes. */
const fakeMp4 = (fill) => { const bytes = Buffer.alloc(64 * 1024, fill); bytes.set([0, 0, 0, 0x20, ...Buffer.from("ftypisom")]); return bytes; };

/**
 * A feature page's film and the start page's (2026-11-20): the page Arbetsorder gets a film, a phone version and subtitles in
 * its panel; the start page's top gets the same film from the list of films already on the page. Saved; the page's picture stays.
 */
async function runLandingPageFilm(page) {
  const canvas = page.getByTestId("landing-canvas");
  const ribbon = page.getByTestId("landing-ribbon");
  await ribbon.getByRole("button", { name: "Undersidor", exact: true }).click();
  await page.getByTestId("landing-pages-settings").getByTestId("landing-pages-open-arbetsorder").click();
  const settings = page.getByTestId("landing-page-settings");
  const film = settings.getByTestId("landing-page-film-settings");
  await film.waitFor();
  const state = film.getByTestId("landing-page-film-state");
  if (/^Film uppladdad/.test(await state.innerText())) await film.getByTestId("landing-page-film-remove").click();
  await state.filter({ hasText: /^Ingen film uppladdad\./ }).waitFor();
  await film.getByTestId("landing-page-film-file").setInputFiles({ name: "arbetsorder.mp4", mimeType: "video/mp4", buffer: fakeMp4(1) });
  await state.filter({ hasText: /^Film uppladdad\./ }).waitFor({ timeout: 60000 });
  await film.getByTestId("landing-page-film-small-file").setInputFiles({ name: "arbetsorder-720.mp4", mimeType: "video/mp4", buffer: fakeMp4(2) });
  await state.filter({ hasText: /Mobilversion uppladdad\./ }).waitFor({ timeout: 60000 });
  await film.getByTestId("landing-page-film-subtitles-file").setInputFiles({ name: "arbetsorder.vtt", mimeType: "text/vtt", buffer: Buffer.from("WEBVTT\n\n1\n00:00:00.500 --> 00:00:02.000\nEn arbetsorder.\n") });
  await state.filter({ hasText: /Undertexter uppladdade\./ }).waitFor();
  // The canvas: the page's own picture with the play button over it, which does not play in the editor.
  const shown = canvas.getByTestId("landing-page-film");
  await shown.waitFor();
  assert.equal(await shown.getByTestId("landing-page-film-play").isDisabled(), true, "the film does not play in the editor");
  assert.match(await shown.locator("img").first().getAttribute("src"), /arbetsorder-detalj/, "the page's picture is the poster");
  // The start page's top: the same film chosen from the list, no new upload.
  await ribbon.getByRole("button", { name: "Startsidan", exact: true }).click();
  await canvas.locator('[data-landing-select="hero:main"]').click({ position: { x: 4, y: 4 } });
  const hero = page.getByTestId("landing-hero-settings").getByTestId("landing-hero-film-settings");
  await hero.waitFor();
  const choose = hero.getByTestId("landing-hero-film-choose");
  const title = await settingsTitle(page, "arbetsorder");
  await choose.selectOption({ label: title });
  await hero.getByTestId("landing-hero-film-state").filter({ hasText: /^Film uppladdad\..*Mobilversion uppladdad\./ }).waitFor();
  await canvas.getByTestId("landing-hero-film-play").waitFor();
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/administration/pricing") && response.request().method() === "PATCH");
  await page.getByTestId("landing-save").click();
  const response = await saved;
  assert.equal(response.status(), 200, "the page's film is accepted by the server's schema");
  const sent = response.request().postDataJSON().landing;
  const pageFilm = sent.pages.items.find((item) => item.slug === "arbetsorder").film;
  assert.match(pageFilm.src, /^\/landing-films\/[a-f0-9-]{36}\.mp4$/);
  assert.match(pageFilm.small, /^\/landing-films\/[a-f0-9-]{36}\.mp4$/);
  assert.notEqual(pageFilm.small, pageFilm.src);
  assert.match(pageFilm.subtitles, /\.vtt$/);
  assert.equal(sent.hero.film.src, pageFilm.src, "the start page got the chosen film");
  assert.equal(sent.hero.film.small, pageFilm.small);
  return { pageFilm };
}

/** A page's title as the editor holds it (the list of films names a page by its title). */
const settingsTitle = (page, slug) => page.evaluate(async (wanted) => (await (await fetch("/api/administration/pricing")).json()).pricing.landing.pages.items.find((item) => item.slug === wanted).title, slug);

/**
 * A feature page's film as a visitor sees it: the picture with the play button, nothing of the film before the click, the player in
 * the picture's place after it; the full film first on a computer, the phone version first at 390 px. The start page's top too.
 */
async function runPublicPageFilm(publicPage, base, { pageFilm }) {
  const requests = [];
  const listen = (request) => requests.push(request.url());
  publicPage.on("request", listen);
  const firstSource = (video) => video.evaluate((node) => node.querySelector("source")?.getAttribute("src") ?? node.getAttribute("src"));
  // A blank page between the passes: the player of the previous pass keeps fetching the film until its document is gone, and such a
  // request must not count as fetched before the click on the next page.
  const fresh = async (width) => {
    await publicPage.goto("about:blank");
    await publicPage.setViewportSize({ width, height: 900 });
    requests.length = 0;
  };
  for (const [width, expected] of [[1440, pageFilm.src], [390, pageFilm.small]]) {
    await fresh(width);
    await publicPage.goto(`${base}/funktioner/arbetsorder`);
    const box = publicPage.getByTestId("landing-page-film");
    await box.waitFor();
    assert.match(await box.locator("img").first().getAttribute("src"), /arbetsorder-detalj/, "the picture stays as the poster");
    const play = box.getByTestId("landing-page-film-play");
    await visibleWithin(play, box, `the play button over the picture at ${width} px`);
    assert.equal(await publicPage.locator("video").count(), 0, "no player before the click");
    assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no sideways page scroll at ${width} px`);
    await publicPage.screenshot({ path: path.join(shots(), `sidfilm-${width}.png`) });
    const early = requests.filter((url) => url.includes("/landing-films/"));
    assert.deepEqual(early, [], `nothing of the film is fetched before the click at ${width} px`);
    const fetched = publicPage.waitForRequest((request) => request.url().includes("/landing-films/") && request.url().endsWith(".mp4"), { timeout: 15000 });
    await play.click();
    const video = publicPage.getByTestId("landing-film-dialog").getByTestId("landing-film-video");
    await video.waitFor();
    // The same large pop-up as on the start page (2026-11-20: the page's top card was too small to watch in).
    const box2 = await video.boundingBox();
    assert.ok(width === 390 ? Math.abs(box2.width - 390) < 2 : box2.width >= 1000, `the pop-up's film at ${width} px is ${Math.round(box2.width)} px wide`);
    await publicPage.screenshot({ path: path.join(shots(), `sidfilm-popup-${width}.png`) });
    assert.equal(await firstSource(video), expected, width === 390 ? "the phone gets the phone version" : "the computer gets the full film");
    assert.equal(await video.getAttribute("preload"), "metadata");
    assert.equal(await video.locator("track").getAttribute("srclang"), "sv");
    assert.equal(new URL((await fetched).url()).pathname, expected, "the first film file fetched is the expected one");
  }
  // The start page's top: the button over the drawn overview, nothing fetched before the click.
  for (const width of [390, 1440]) {
    await fresh(width);
    await publicPage.goto(`${base}/`);
    const play = publicPage.getByTestId("landing-hero-film-play");
    await play.waitFor();
    assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no sideways page scroll on the start page at ${width} px`);
    await play.scrollIntoViewIfNeeded();
    await publicPage.screenshot({ path: path.join(shots(), `startfilm-${width}.png`) });
    assert.deepEqual(requests.filter((url) => url.includes("/landing-films/")), [], "nothing of the start page's film before the click");
  }
  publicPage.off("request", listen);
}

/** The page's film and the start page's removed in the editor: saved without them, and the public page is as before. */
async function runLandingPageFilmRemove(page, publicPage, base) {
  const canvas = page.getByTestId("landing-canvas");
  const ribbon = page.getByTestId("landing-ribbon");
  await ribbon.getByRole("button", { name: "Undersidor", exact: true }).click();
  await page.getByTestId("landing-pages-settings").getByTestId("landing-pages-open-arbetsorder").click();
  const film = page.getByTestId("landing-page-settings").getByTestId("landing-page-film-settings");
  await film.getByTestId("landing-page-film-remove").click();
  await film.getByTestId("landing-page-film-state").filter({ hasText: /^Ingen film uppladdad\./ }).waitFor();
  await canvas.getByTestId("landing-page-film").waitFor({ state: "detached" });
  await ribbon.getByRole("button", { name: "Startsidan", exact: true }).click();
  await canvas.locator('[data-landing-select="hero:main"]').click({ position: { x: 4, y: 4 } });
  await page.getByTestId("landing-hero-film-remove").click();
  await canvas.getByTestId("landing-hero-film-play").waitFor({ state: "detached" });
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/administration/pricing") && response.request().method() === "PATCH");
  await page.getByTestId("landing-save").click();
  const sent = (await saved).request().postDataJSON().landing;
  assert.equal(sent.pages.items.find((item) => item.slug === "arbetsorder").film, undefined, "the page's film is removed");
  assert.equal(sent.hero.film, undefined, "the start page's film is removed");
  if (publicPage) {
    await publicPage.goto(`${base}/funktioner/arbetsorder`);
    await publicPage.getByTestId("landing-subpage").waitFor();
    assert.equal(await publicPage.getByTestId("landing-page-film").count(), 0, "the page looks as before");
  }
}

const path = require("node:path");
/** Where the film screenshots go (looked at by hand): LANDING_SHOTS, else the system's temporary folder. */
const shots = () => process.env.LANDING_SHOTS || require("node:os").tmpdir();

/** A play button is clearly there: visible, inside its poster, and at least 44 px high. */
async function visibleWithin(button, frame, message) {
  assert.ok(await button.isVisible(), message);
  const [own, outer] = [await button.boundingBox(), await frame.boundingBox()];
  assert.ok(own.height >= 44 && own.x >= outer.x - 1 && own.y >= outer.y - 1 && own.x + own.width <= outer.x + outer.width + 1 && own.y + own.height <= outer.y + outer.height + 1, `${message} (${Math.round(own.width)}×${Math.round(own.height)} inside its poster)`);
}

/**
 * The film page's settings (2026-11-20): Sidor, Filmer shows the page on the canvas with the films uploaded by the earlier
 * steps; a number in the panel puts the feature page's film first in the series. Saved.
 */
async function runLandingFilmsPanel(page) {
  const canvas = page.getByTestId("landing-canvas");
  await page.getByTestId("landing-ribbon").getByRole("button", { name: "Filmer", exact: true }).click();
  await canvas.getByTestId("landing-films-page").waitFor();
  // The films are listed under Media (2026-11-21); the film page stays on the canvas.
  await page.getByTestId("landing-films-settings").getByTestId("landing-films-open-media").click();
  const settings = page.getByTestId("landing-media-settings");
  await settings.waitFor();
  const rows = settings.getByTestId("landing-films-row");
  assert.ok(await rows.count() >= 2, "the step's film and the page's film are listed (the start page shares the page's)");
  assert.ok(await canvas.getByTestId("landing-films-item").count() >= 2);
  const firstTitle = await canvas.getByTestId("landing-films-item").first().locator("h2").innerText();
  // The last row (the feature page's film) gets number 1 and moves first on the page.
  await rows.last().getByTestId("landing-films-order-input").fill("1");
  await page.waitForFunction((before) => document.querySelector("[data-testid=landing-films-item] h2")?.textContent !== before, firstTitle);
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/administration/pricing") && response.request().method() === "PATCH");
  await page.getByTestId("landing-save").click();
  const sent = (await saved).request().postDataJSON().landing;
  assert.equal(sent.pages.items.find((item) => item.slug === "arbetsorder").film.order, 1, "the number is saved on the film");
  assert.equal(sent.hero.film.order, 1, "and on the same film on the start page");
  await page.getByTestId("landing-ribbon").getByRole("button", { name: "Startsidan", exact: true }).click();
}

/**
 * The pop-up's controls (2026-11-22): one row right under the film – the 10 s buttons round, symbol only and in the middle,
 * named by their words; Nästa film on the same row, cut rather than wrapped – at 1280 × 720 and 390 × 844. ← → skip at once with
 * "+10 s" in the middle of the film, quick presses add up, and space neither closes the pop-up nor scrolls the page.
 */
async function runFilmControls(publicPage, dialog) {
  const before = publicPage.viewportSize();
  for (const size of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await publicPage.setViewportSize(size);
    await publicPage.waitForTimeout(200);
    const video = await dialog.getByTestId("landing-film-video").boundingBox();
    const back = await dialog.getByTestId("landing-film-back").boundingBox();
    const forward = await dialog.getByTestId("landing-film-forward").boundingBox();
    const next = await dialog.getByTestId("landing-film-next").boundingBox();
    for (const [name, box] of [["back", back], ["forward", forward]]) assert.ok(Math.abs(box.width - box.height) < 1 && box.width >= 44, `${name} is a round button of at least 44 px at ${size.width} px`);
    assert.ok(Math.abs((back.x + forward.x + forward.width) / 2 - (video.x + video.width / 2)) < 2, `the 10 s buttons in the middle under the film at ${size.width} px`);
    for (const box of [back, forward, next]) assert.ok(Math.abs(box.y - back.y) < 2 && box.y >= video.y + video.height && box.y - (video.y + video.height) < 24, `one row right under the film at ${size.width} px`);
    assert.ok(next.x + next.width <= video.x + video.width + 1 && next.x >= forward.x + forward.width, `Nästa film to the right on the same row at ${size.width} px`);
    await publicPage.screenshot({ path: path.join(shots(), `filmspelare-${size.width}.png`) });
  }
  assert.equal(await dialog.getByTestId("landing-film-back").innerText(), "", "symbol only");
  assert.equal(await dialog.getByTestId("landing-film-back").getAttribute("aria-label"), "10 s bakåt");
  assert.equal(await dialog.getByTestId("landing-film-forward").getAttribute("title"), "10 s framåt");
  assert.match(await dialog.getByTestId("landing-film-next").getAttribute("title"), /^Nästa film: /, "the next film's whole title as the tooltip");
  // The keys, with the focus where the pop-up puts it (Stäng).
  const scroll = await publicPage.evaluate(() => window.scrollY);
  await publicPage.keyboard.press("ArrowRight");
  await publicPage.keyboard.press("ArrowRight");
  assert.equal(await dialog.getByTestId("landing-film-jump").innerText(), "+20 s", "two quick presses add up");
  await publicPage.keyboard.press("ArrowLeft");
  assert.equal(await dialog.getByTestId("landing-film-jump").innerText(), "−10 s", "the other way starts over");
  await publicPage.keyboard.press(" ");
  await publicPage.waitForTimeout(200);
  assert.equal(await dialog.isVisible(), true, "space does not press Stäng");
  assert.equal(await publicPage.evaluate(() => window.scrollY), scroll, "the keys do not scroll the page");
  await dialog.getByTestId("landing-film-jump").waitFor({ state: "detached", timeout: 3000 });
  await publicPage.setViewportSize(before);
}

/**
 * The film page as a visitor sees it (2026-11-20): every film once in the series' order, the play button clear on every poster
 * at 320–1440 px, nothing of a film before the click; a film opens in the pop-up, Nästa film plays the next one there and Esc closes.
 */
async function runPublicFilmsPage(publicPage, base) {
  const requests = [];
  const listen = (request) => requests.push(request.url());
  publicPage.on("request", listen);
  await publicPage.goto("about:blank");
  requests.length = 0;
  for (const width of [320, 390, 768, 1440]) {
    await publicPage.setViewportSize({ width, height: 900 });
    await publicPage.goto(`${base}/filmer`);
    await publicPage.getByTestId("landing-films-page").waitFor();
    const items = publicPage.getByTestId("landing-films-item");
    assert.ok(await items.count() >= 2, "the films are listed");
    for (let at = 0; at < await items.count(); at += 1) {
      const item = items.nth(at);
      await item.scrollIntoViewIfNeeded();
      await visibleWithin(item.getByTestId("landing-films-play"), item.locator("div").first(), `film ${at + 1}'s play button at ${width} px`);
    }
    assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no sideways page scroll on the film page at ${width} px`);
    await publicPage.screenshot({ path: path.join(shots(), `filmsidan-${width}.png`), fullPage: true });
  }
  assert.deepEqual(requests.filter((url) => url.includes("/landing-films/")), [], "nothing of a film before the click");
  // The first film (numbered 1 by runLandingFilmsPanel) in the pop-up, then the next one.
  const first = publicPage.getByTestId("landing-films-item").first();
  const firstTitle = await first.locator("h2").innerText();
  await first.getByTestId("landing-films-play").click();
  const dialog = publicPage.getByTestId("landing-film-dialog");
  await dialog.waitFor();
  assert.equal(await dialog.getByTestId("landing-film-dialog-title").innerText(), firstTitle);
  assert.equal(await dialog.getByTestId("landing-film-all").count(), 0, "no Alla filmer on the film page itself");
  // A click beside the film never closes the pop-up (2026-11-22); only Stäng and Esc do.
  await publicPage.mouse.click(5, 5);
  await publicPage.waitForTimeout(300);
  assert.equal(await dialog.isVisible(), true, "a click beside the film leaves the pop-up open");
  const next = dialog.getByTestId("landing-film-next");
  const secondTitle = await publicPage.getByTestId("landing-films-item").nth(1).locator("h2").innerText();
  assert.ok((await next.innerText()).includes(secondTitle), "Nästa film names the next one in the series");
  await publicPage.screenshot({ path: path.join(shots(), "filmsidan-popup-1440.png") });
  await runFilmControls(publicPage, dialog);
  const source = () => document.querySelector("[data-testid=landing-film-video]")?.querySelector("source")?.getAttribute("src") ?? document.querySelector("[data-testid=landing-film-video]")?.getAttribute("src");
  const before = await publicPage.evaluate(source);
  await next.click();
  await publicPage.waitForFunction(([read, was]) => new Function(`return (${read})()`)() !== was, [source.toString(), before]);
  assert.equal(await dialog.getByTestId("landing-film-dialog-title").innerText(), secondTitle);
  await publicPage.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  // On the start page the pop-up links to all the films.
  await publicPage.goto(`${base}/`);
  await publicPage.locator("#t-start1").getByTestId("landing-topic-film-play").click();
  assert.match(await publicPage.getByTestId("landing-film-all").getAttribute("href"), /\/filmer$/);
  await publicPage.getByTestId("landing-film-close").click();
  // Stäng closes the pop-up (the top's Se filmer button is hidden earlier in landing-sections.browser.cjs, so it is not looked for here).
  await publicPage.getByTestId("landing-film-dialog").waitFor({ state: "detached" });
  publicPage.off("request", listen);
}

/**
 * Nytt i systemet (2026-11-20): the block on the start page shows the latest versions and leads to /nytt, which lists more; the
 * footer has the link; the Community section's button plays the installation film (step 1's, uploaded by runLandingFilm) in the pop-up.
 * In the editor the block's count is changed and the page is opened on the canvas, then put back.
 */
async function runPublicNews(publicPage, base) {
  await publicPage.goto(`${base}/`);
  const block = publicPage.getByTestId("landing-news");
  await block.waitFor();
  assert.equal(await block.getByTestId("landing-news-item").count(), 2, "two versions, as runLandingNewsPanel set (one by default)");
  const version = await block.getByTestId("landing-news-item").first().getAttribute("data-version");
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const points = await block.getByTestId("landing-news-item").first().locator("li").count();
  assert.ok(points >= 1 && points <= 3, `the version's highlights are shown, at most three (${points})`);
  assert.match(await block.getByTestId("landing-news-all").getAttribute("href"), /\/nytt$/);
  assert.match(await publicPage.getByTestId("landing-footer-news").getAttribute("href"), /\/nytt$/, "the footer's link");
  // The Community plan card's button opens the installation film in the pop-up, never leaves the page (2026-11-22:
  // moved from the Community section to the plan card); the section itself has no film button any more.
  assert.equal(await publicPage.locator("#t-open").getByTestId("landing-topic-film-button").count(), 0, "no film button in the Community section");
  const filmButton = publicPage.getByTestId("landing-community-film");
  await filmButton.scrollIntoViewIfNeeded();
  await filmButton.click();
  const dialog = publicPage.getByTestId("landing-film-dialog");
  await dialog.waitFor();
  assert.match(await dialog.getByTestId("landing-film-dialog-title").innerText(), /Installera Workflow|Maskinlarm/, "step 1's film (its heading was written by an earlier step)");
  await publicPage.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  for (const width of [320, 390, 768, 1440]) {
    await publicPage.setViewportSize({ width, height: 900 });
    await publicPage.goto(`${base}/nytt`);
    await publicPage.getByTestId("landing-news-page").waitFor();
    assert.ok(await publicPage.getByTestId("landing-news-item").count() >= 3, "the page lists more versions");
    assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no sideways page scroll on /nytt at ${width} px`);
    await publicPage.screenshot({ path: path.join(shots(), `nytt-${width}.png`), fullPage: true });
  }
  assert.ok((await publicPage.title()).length > 0);
}

/** The news block's settings in the editor: two versions on the start page, the page hidden (no link to it), then back to the defaults. */
async function runLandingNewsPanel(page) {
  const canvas = page.getByTestId("landing-canvas");
  await page.getByTestId("landing-ribbon").getByRole("button", { name: "Startsidan", exact: true }).click();
  await canvas.locator('[data-landing-select="news:main"]').click({ position: { x: 4, y: 4 } });
  const settings = page.getByTestId("landing-news-settings");
  await settings.waitFor();
  await settings.getByTestId("landing-news-count").fill("2");
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="landing-news"] [data-testid="landing-news-item"]').length === 2);
  await settings.getByTestId("landing-news-page-visible").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="landing-news-all"]')?.closest("[data-off]") !== null);
  await settings.getByTestId("landing-news-page-visible").click();
  // The page on the canvas, from the ribbon.
  await page.getByTestId("landing-ribbon").getByRole("button", { name: "Nytt", exact: true }).click();
  await canvas.getByTestId("landing-news-page").waitFor();
  await page.getByTestId("landing-ribbon").getByRole("button", { name: "Startsidan", exact: true }).click();
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/administration/pricing") && response.request().method() === "PATCH");
  await page.getByTestId("landing-save").click();
  const sent = (await saved).request().postDataJSON().landing;
  assert.equal(sent.news.count, 2, "the count is saved");
  assert.equal(sent.news.page.visible, true);
}

/**
 * Allt i ett system in the editor (2026-11-21): the section selects its panel, a role renamed there shows on the canvas, egenkontroll's
 * node is there, and the map is saved with the name. The name is put back by the reset at the end.
 */
async function runLandingMapPanel(page, { marker }) {
  const canvas = page.getByTestId("landing-canvas");
  await page.getByTestId("landing-ribbon").getByRole("button", { name: "Startsidan", exact: true }).click();
  await canvas.locator('[data-landing-select="map:main"]').click({ position: { x: 4, y: 4 } });
  const settings = page.getByTestId("landing-map-settings");
  await settings.waitFor();
  await settings.getByTestId("landing-map-control-settings").waitFor();
  await settings.locator("#landing-map-role-name-screen").fill(`Skärm ${marker}`);
  await canvas.getByText(`Skärm ${marker}`).first().waitFor();
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/administration/pricing") && response.request().method() === "PATCH");
  await page.getByTestId("landing-save").click();
  const sent = (await saved).request().postDataJSON().landing;
  assert.equal(sent.map.roles.find((role) => role.id === "screen").name, `Skärm ${marker}`, "the role's name is saved");
  assert.ok(sent.layout.some((entry) => entry.id === "map" && entry.visible), "the map is a part of the page, shown");
}

/**
 * Allt i ett system as a visitor sees it: from 1280 px the large map, where a click on a role dims what it does not use and Visa allt
 * shows everything again; at 390 px the list, the same click, and no sideways scroll.
 */
async function runPublicMap(publicPage, base) {
  await publicPage.setViewportSize({ width: 1440, height: 900 });
  await publicPage.goto(`${base}/#karta`);
  const map = publicPage.getByTestId("landing-map");
  await map.waitFor();
  const graph = map.getByTestId("landing-map-graph");
  await graph.waitFor();
  assert.equal(await graph.locator("[data-dim]").count(), 0, "everything shown before a click");
  const operator = graph.getByTestId("landing-map-role-operator");
  await operator.click();
  assert.equal(await operator.getAttribute("aria-pressed"), "true");
  assert.equal(await graph.getByTestId("landing-map-product-felanmalan").getAttribute("data-dim"), null, "the operator's function stays lit");
  assert.equal(await graph.getByTestId("landing-map-product-arbetsorder").getAttribute("data-dim"), "true", "the rest is dimmed");
  assert.equal(await graph.getByTestId("landing-map-role-staff").getAttribute("data-dim"), "true");
  await publicPage.screenshot({ path: path.join(shots(), "karta-1440-operator.png"), fullPage: false });
  await map.getByTestId("landing-map-show-all").click();
  assert.equal(await graph.locator("[data-dim]").count(), 0, "Visa allt shows everything again");
  // A second click on the same node shows everything too, and the keyboard works.
  await operator.focus();
  await publicPage.keyboard.press("Enter");
  await publicPage.keyboard.press("Enter");
  assert.equal(await graph.locator("[data-dim]").count(), 0);
  await publicPage.setViewportSize({ width: 390, height: 844 });
  const list = map.getByTestId("landing-map-list");
  await list.waitFor();
  assert.ok(!(await graph.isVisible()), "the large map is not shown on a phone");
  await list.getByTestId("landing-map-list-role-customer").click();
  assert.equal(await list.getByTestId("landing-map-list-product-offert").getAttribute("data-dim"), null);
  assert.equal(await list.getByTestId("landing-map-list-product-tavlor").getAttribute("data-dim"), "true");
  assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no sideways page scroll with the map at 390 px");
  await map.screenshot({ path: path.join(shots(), "karta-390.png") });
  await map.getByTestId("landing-map-show-all").click();
  assert.equal(await list.locator("[data-dim]").count(), 0);
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
  // Tavlor och skärmar (2026-11-20): a page of its own, without a picture until there is a screenshot of a board.
  await publicPage.goto(`${base}/funktioner/tavlor`);
  await publicPage.getByRole("heading", { level: 1, name: /Läget på en tavla/ }).waitFor();
  for (const width of [320, 390, 768, 1440]) {
    await publicPage.setViewportSize({ width, height: 900 });
    assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no sideways page scroll on Tavlor at ${width} px`);
    await publicPage.screenshot({ path: path.join(shots(), `tavlor-${width}.png`), fullPage: true });
  }
  // Tre sätt right under the top of the start page.
  await publicPage.goto(`${base}/`);
  assert.equal(await publicPage.getByTestId("landing-way").count(), 3);
  assert.equal(await publicPage.getByTestId("landing-way-mark").count(), 3, "each card has its large, faint icon");
  for (const width of [320, 390, 768, 1440]) {
    await publicPage.setViewportSize({ width, height: 900 });
    assert.ok(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no sideways page scroll with Tre sätt at ${width} px`);
    await publicPage.getByTestId("landing-ways").screenshot({ path: path.join(shots(), `tre-satt-${width}.png`) });
  }
}

/**
 * The picture pop-up on a phone (2026-11-19): opened from a feature page at 390×844, a double tap zooms the picture 2×, a
 * second double tap shows it whole again, a turned phone (844×390) gives it nearly the whole height, and Stäng closes it.
 * `shots` (a folder) saves a screenshot in each position for a person to look at.
 */
async function runPublicLightboxPhone(browser, base, { cookies = [], path = "/funktioner/planering", shots } = {}) {
  const phone = await browser.newContext({ locale: "sv-SE", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  if (cookies.length) await phone.addCookies(cookies);
  const page = await phone.newPage();
  const shot = async (name) => { if (shots) await page.screenshot({ path: require("node:path").join(shots, `lightbox-${name}.png`) }); };
  const zoomIs = (value) => page.waitForFunction((wanted) => (document.querySelector("[data-testid=landing-lightbox-image]")?.dataset.zoom ?? "") === wanted, value);
  try {
    await page.goto(`${base}${path}`);
    const open = page.getByRole("button", { name: /^Visa större/ }).first();
    await open.scrollIntoViewIfNeeded();
    await open.tap();
    const box = page.getByTestId("landing-lightbox");
    const image = page.getByTestId("landing-lightbox-image");
    await image.waitFor();
    await page.waitForFunction(() => document.querySelector("[data-testid=landing-lightbox-image]")?.complete);
    const whole = await image.boundingBox();
    assert.ok(whole.width >= 390 - 24, `the picture fits the width on a phone (${whole.width} px)`);
    await shot("portrait");
    const doubleTap = async () => {
      const at = await image.boundingBox();
      const x = at.x + at.width / 2, y = at.y + at.height / 2;
      await page.touchscreen.tap(x, y);
      await page.waitForTimeout(80);
      await page.touchscreen.tap(x, y);
    };
    await doubleTap();
    await zoomIs("2.00");
    await page.waitForTimeout(300); // the zoom glides in
    const zoomed = await image.boundingBox();
    assert.ok(Math.abs(zoomed.width - whole.width * 2) < 4, `a double tap zooms 2× (${whole.width} → ${zoomed.width} px)`);
    await shot("portrait-zoomed");
    await page.waitForTimeout(400); // not read as a third tap
    await doubleTap();
    await zoomIs("");
    await page.waitForTimeout(300);
    assert.ok(Math.abs((await image.boundingBox()).width - whole.width) < 2, "a second double tap shows the picture whole");
    assert.equal(await box.count(), 1, "a double tap never closes the pop-up");
    // A turned phone: the picture takes nearly the whole height (or the whole width), the buttons and the caption stay reachable.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(200);
    const turned = await image.boundingBox();
    assert.ok(turned.height >= 390 - 24 || turned.width >= 844 - 140, `a turned phone gives the picture the screen (${Math.round(turned.width)}×${Math.round(turned.height)})`);
    assert.ok(turned.width > whole.width, "the turned picture is larger than upright");
    await shot("landscape");
    await doubleTap();
    await zoomIs("2.00");
    await page.waitForTimeout(300);
    await shot("landscape-zoomed");
    await page.getByTestId("landing-lightbox-close").tap();
    await box.waitFor({ state: "detached" });
    assert.ok(await page.evaluate(() => document.documentElement.style.overflow !== "hidden"), "the page scrolls again after closing");
  } finally {
    await phone.close();
  }
}

/** Reset: the ribbon's Standardtexter brings back every default, also the sections and buttons. */
async function runLandingReset(page, { marker }) {
  const canvas = page.getByTestId("landing-canvas");
  await page.getByTestId("landing-ribbon").getByRole("button", { name: "Standardtexter", exact: true }).click();
  await confirmDialog(page).getByRole("button", { name: "Återställ", exact: true }).click();
  await canvas.getByRole("textbox", { name: "Överst – knapp 1", exact: true }).filter({ hasNotText: marker }).waitFor();
  await canvas.getByRole("textbox", { name: "Steg 1 – rubrik", exact: true }).filter({ hasNotText: marker }).waitFor();
  assert.equal(await page.locator('[data-landing-select="link:hero.buttons.1"]').getAttribute("data-off"), null, "the hidden button is back");
  // A single section back to its default text.
  await canvas.getByRole("textbox", { name: "Steg 2 – rubrik", exact: true }).click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Annan rubrik");
  await page.keyboard.press("Enter");
  await canvas.locator('[data-landing-select="topic:start2"]').click({ position: { x: 4, y: 40 } });
  await page.getByTestId("landing-topic-reset").click();
  await canvas.getByRole("textbox", { name: "Steg 2 – rubrik", exact: true }).filter({ hasNotText: "Annan rubrik" }).waitFor();
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

/**
 * Media (2026-11-21), the tab Filmer: the film on the start page and the feature page is one row with both places and a link to
 * each; a new file replaces it on both; a new film is added only to the series by its name, hidden. The tab Bilder: a picture is put on
 * one more place without a new upload and hidden there. Everything is saved with the one Spara.
 */
async function runLandingFilmsOverview(page) {
  await page.getByTestId("landing-ribbon").getByRole("button", { name: "Media", exact: true }).click();
  const settings = page.getByTestId("landing-media-settings");
  await settings.waitFor();
  await settings.getByTestId("landing-media-tabs").getByRole("radio", { name: "Filmer" }).click();
  const shared = settings.getByTestId("landing-films-row").filter({ has: page.getByTestId("landing-films-place").filter({ hasText: "Startsidan, överst" }) });
  assert.equal(await shared.getByTestId("landing-films-place").count(), 2, "the shared film lists the start page and the feature page");
  const links = await shared.getByTestId("landing-films-place-link").evaluateAll((items) => items.map((item) => item.getAttribute("href")));
  assert.ok(links.some((href) => /\/(\?landing=1)?$/.test(href)) && links.some((href) => href.endsWith("/funktioner/arbetsorder")), `links to both places: ${links.join(", ")}`);
  const before = await shared.getAttribute("data-film");
  await shared.getByTestId("landing-films-replace-file").setInputFiles({ name: "ny.mp4", mimeType: "video/mp4", buffer: fakeMp4(7) });
  await page.waitForFunction((old) => !document.querySelector(`[data-testid=landing-films-row][data-film="${old}"]`), before);
  // A new film only on the film page and in Nästa film.
  const add = settings.getByTestId("landing-films-add");
  await add.getByTestId("landing-films-add-target").selectOption("serie");
  await add.getByTestId("landing-films-add-name").fill("Översiktsfilm");
  await add.getByTestId("landing-films-add-file").setInputFiles({ name: "serie.mp4", mimeType: "video/mp4", buffer: fakeMp4(8) });
  const added = settings.getByTestId("landing-films-row").filter({ hasText: "Översiktsfilm" });
  await added.waitFor();
  await added.getByTestId("landing-films-shown").click();
  await added.getByTestId("landing-films-state").filter({ hasText: "Dold" }).waitFor();
  assert.ok(await settings.getByTestId("landing-films-unused-remove").isDisabled(), "unused films wait until the page is saved");
  // Bilder: a picture already on the page put on a place without one, without a new upload.
  await settings.getByTestId("landing-media-tabs").getByRole("radio", { name: "Bilder" }).click();
  const images = settings.getByTestId("landing-images-overview");
  await images.waitFor();
  const firstImage = images.getByTestId("landing-images-row").first();
  const imageSrc = await firstImage.getAttribute("data-image");
  const placesBefore = await firstImage.getByTestId("landing-images-place").count();
  assert.ok(await firstImage.getByTestId("landing-images-place-link").first().getAttribute("href"), "every place has a link");
  const also = firstImage.getByTestId("landing-images-also");
  await also.selectOption({ index: 1 });
  await page.waitForFunction(([src, count]) => document.querySelectorAll(`[data-testid=landing-images-row][data-image="${src}"] [data-testid=landing-images-place]`).length === count + 1, [imageSrc, placesBefore]);
  assert.ok(await images.getByTestId("landing-images-unused-remove").isDisabled(), "unused pictures wait until the page is saved");
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/administration/pricing") && response.request().method() === "PATCH");
  await page.getByTestId("landing-save").click();
  const sent = (await saved).request().postDataJSON().landing;
  assert.notEqual(sent.hero.film.src, before, "the start page has the new file");
  assert.equal(sent.pages.items.find((item) => item.slug === "arbetsorder").film.src, sent.hero.film.src, "and the feature page the same one");
  const series = sent.seriesFilms.find((item) => item.name === "Översiktsfilm");
  assert.ok(series && series.show === false && series.key === "oversiktsfilm", "the new series film is saved, hidden");
  const uses = JSON.stringify(sent).split(`"src":"${imageSrc}"`).length - 1;
  assert.ok(uses >= placesBefore + 1, `the picture is saved on one more place (${uses})`);
  await page.getByTestId("landing-ribbon").getByRole("button", { name: "Startsidan", exact: true }).click();
}

module.exports = { runLandingFilmsOverview, runLandingMapPanel, runPublicMap, runLandingNewsPanel, runPublicNews, runLandingFilmsPanel, runPublicFilmsPage, runLandingSections, runLandingSubpages, runLandingFilm, runPublicFilm, runPublicSubpage, runPublicLightboxPhone, runLandingReset, runStaleNotice, runLandingPageFilm, runPublicPageFilm, runLandingPageFilmRemove };
