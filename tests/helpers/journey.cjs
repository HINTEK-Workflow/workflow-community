/* eslint-disable @typescript-eslint/no-require-imports -- Shared checks of the journeys per yrkesprofil (tests/journey-*.browser.cjs). */
// Resor per yrkesprofil (2026-11-03: "När du sedan kontrollerar resor uppdatera även webbplatskartan"): one journey per
// preset of lib/workflow/work-profile.ts, walked as the QA member (3002) with the profile set by the QA owner (3001), on a
// computer (1440 px) and a phone (390 px). Navigation is part of every journey: the menu, the breadcrumbs, Tillbaka/Framåt,
// the tab rows and the phone's tab bar and Hem. What is expected is read from the app's own pure functions (loaded with jiti),
// never from a copy: breadcrumbTrail, resolveMenu/sidebarMenu, nativeLayoutAllowed and the profile table.
//
// The bases: KFID_TEST_BASE_URL (the owner, 3001), KFID_TEST_WORKER_URL (3002), KFID_TEST_SUPERADMIN_URL (3004) – the same
// overrides as tests/customer-journey.browser.cjs, so a dev server can stand in (see docs/resor.md).
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.join(__dirname, "..", "..");
const jiti = createJiti(__filename, { fsCache: false, moduleCache: true, alias: { "@": root } });
const load = (file) => jiti(path.join(root, file));
const NAV = load("lib/workflow/navigation.ts");
const MENU = load("lib/workflow/menu-items.ts");
const LAYOUT = load("lib/workflow/native-layout.ts");
const PROFILES = load("lib/workflow/work-profile.ts");
const APP_FEEL = load("lib/workflow/app-feel.ts");
const NATIVE = load("lib/workflow/native-mode.ts");

const bases = {
  owner: process.env.KFID_TEST_BASE_URL || "http://localhost:3001",
  worker: process.env.KFID_TEST_WORKER_URL || "http://localhost:3002",
  superadmin: process.env.KFID_TEST_SUPERADMIN_URL || "http://localhost:3004",
};
for (const url of Object.values(bases)) assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname), "Loopback only");
const WORKER_EMAIL = "qa-worker@role-test.invalid";
// The local test database (kfid_v3_test), for a journey that cleans up what it made (only rows named "QA Resa …").
const sql = (statement) => require("node:child_process").execFileSync("docker", ["exec", "hintek-workflow-postgres", "sh", "-lc",
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d kfid_v3_test -Atc "$1"', "--", statement], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const JOURNEY_PREFIX = "QA Resa";

const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
};
// The words the app must never show (the pattern of tests/customer-journey.browser.cjs).
const ENGLISH = /\b(Loading|Save|Cancel|Delete|Error|Submit|Search|undefined|null|NaN|Invalid Date|Untitled|Failed|Unknown|Dashboard|Sign in|Sign out|Required|Something went wrong|No results|Not found)\b/;
const consentVersion = /CONSENT_VERSION = "([^"]+)"/.exec(readFileSync(path.join(root, "lib", "analytics", "consent.ts"), "utf8"))[1];

/**
 * The head of a page as measured in it: the title's place, every head button's box and kind, the group's right edge, the tab
 * row's place and any sideways scroll. Shared with tests/page-tops.browser.cjs (one template for page tops, 2026-11-02).
 */
const measureHead = (page) => page.evaluate(() => {
  const visible = (element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
  const header = [...document.querySelectorAll(".workspace-main [data-standard-header]")].find(visible) ?? null;
  const title = header?.querySelector("h1.page-title") ?? null;
  const group = header ? [...header.querySelectorAll("[data-standard-actions]")].find(visible) ?? null : null;
  const buttons = group ? [...group.querySelectorAll('[data-slot="button"]')].filter(visible).map((element) => {
    const box = element.getBoundingClientRect();
    return { text: element.textContent.trim().slice(0, 40), top: Math.round(box.top), height: Math.round(box.height), right: Math.round(box.right), variant: element.getAttribute("data-variant") };
  }) : [];
  const main = document.querySelector(".workspace-main")?.getBoundingClientRect();
  return {
    titleTop: title ? Math.round(title.getBoundingClientRect().top) : null,
    titleLeft: title ? Math.round(title.getBoundingClientRect().left) : null,
    headerRight: header ? Math.round(header.getBoundingClientRect().right) : null,
    groupRight: group ? Math.round(group.getBoundingClientRect().right) : null,
    buttons,
    tabsAboveTitle: Boolean(title && [...document.querySelectorAll('[data-testid="section-tabs-area"]')].some((tabs) => visible(tabs) && tabs.getBoundingClientRect().bottom <= title.getBoundingClientRect().top)),
    sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    mainRight: main ? Math.round(main.right) : null,
  };
});

/** What the head template asks of one page (docs/design-standard.md): one row of buttons of one height, top right, the main action last. */
function headProblems(head, where) {
  const problems = [];
  if (head.tabsAboveTitle) problems.push(`${where}: the tab row stands above the heading`);
  if (new Set(head.buttons.map((button) => button.height)).size > 1) problems.push(`${where}: head buttons of different heights ${JSON.stringify(head.buttons.map((b) => [b.text, b.height]))}`);
  if (head.wide !== false && new Set(head.buttons.map((button) => button.top)).size > 1) problems.push(`${where}: head buttons on more than one row ${JSON.stringify(head.buttons.map((b) => [b.text, b.top]))}`);
  if (head.wide !== false && head.buttons.length && Math.abs(head.groupRight - head.headerRight) > 1) problems.push(`${where}: the buttons are not top right (${head.groupRight} of ${head.headerRight})`);
  const primary = head.buttons.findIndex((button) => button.variant === "default");
  if (head.wide !== false && primary >= 0 && primary !== head.buttons.length - 1) problems.push(`${where}: the main action is not furthest right ${JSON.stringify(head.buttons.map((b) => [b.text, b.variant]))}`);
  return problems;
}

const paramsOf = (url) => Object.fromEntries(new URL(url).searchParams);
const viewOf = (url) => new URL(url).searchParams.get("view") || "stats";
const relative = (url) => { const parsed = new URL(url); return `${parsed.pathname}${parsed.search}`; };
const cut = (text) => String(text ?? "").replace(/\s+/g, " ").trim().replace(/…$/, "");

/** The QA member's record as the owner sees it, and a save of it through the admin's own form action. */
async function memberApi(owner) {
  const read = async () => {
    const response = await owner.context.request.get(`${owner.base}/api/administration`);
    assert.equal(response.status(), 200, "the owner reads Användare");
    const organization = (await response.json()).organizations[0];
    const member = organization.members.find((item) => item.user.email === WORKER_EMAIL);
    assert.ok(member, "the QA member exists");
    return { organization, member };
  };
  const { organization, member } = await read();
  const save = async (data) => {
    const response = await owner.context.request.post(`${owner.base}/api/administration`, { headers: { origin: owner.base },
      data: { action: "member_save", organizationId: organization.id, email: WORKER_EMAIL, name: member.user.name || "QA Medarbetare", role: "MEMBER", canDeleteControls: Boolean(member.canDeleteControls), ...data } });
    assert.equal(response.status(), 200, await response.text());
  };
  return { organization, member, save, read };
}

/**
 * Gives the QA member the profile and the rights it suggests (as the admin's Använd förslaget does), and returns the way
 * back to the member's own record. The profile only decides what stands first; the rights are what the admin saves.
 */
async function asProfile(owner, profile, { grants } = {}) {
  const api = await memberApi(owner);
  const record = api.member.workflowPermissions ?? {};
  const original = { grants: record.grants ?? [], profile: record.workProfile?.profile ?? null, view: record.workView?.view ?? null };
  const given = grants ?? PROFILES.suggestedRights(profile).grants;
  await api.save({ workflowPermissions: { version: 1, grants: given }, workProfile: profile, workView: null });
  const stored = (await api.read()).member.workflowPermissions;
  assert.equal(stored.workProfile?.profile, profile, `the member has the profile ${profile}`);
  return {
    grants: given,
    definition: PROFILES.WORK_PROFILE[profile],
    restore: () => api.save({ workflowPermissions: { version: 1, grants: original.grants }, workProfile: original.profile, workView: original.view }),
  };
}

/** The member's access as the menu functions read it (MenuAccess): a member of a Cloud company with every module on. */
const memberAccess = (grants, memberRole = "MEMBER") => ({ memberRole, workflowPermissions: { version: 1, grants: [...grants] }, canBuildForms: memberRole !== "MEMBER", localStorageMode: false, ai: true, importPage: true, modules: null });

/**
 * One person's browser on one device, signed in through the loopback QA session. Collects every page error, browser
 * dialog and broken rule as a problem; `done()` fails the journey with all of them at once.
 */
async function openJourney(browser, { base, device = "desktop", name }) {
  const context = await browser.newContext({ ...DEVICES[device], locale: "sv-SE", timezoneId: "Europe/Stockholm" });
  await context.addCookies([{ name: "wf-consent", value: `${consentVersion}.n`, url: base }]);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const who = `${name ?? new URL(base).port} ${device === "desktop" ? 1440 : 390}`;
  const problems = [];
  page.on("pageerror", (error) => problems.push(`${who}: page error on ${relative(page.url())}: ${error.message}`));
  page.on("dialog", async (dialog) => { problems.push(`${who}: browser dialog on ${relative(page.url())}: ${dialog.message()}`); await dialog.dismiss().catch(() => undefined); });
  const signed = await context.request.post(`${base}/api/qa/session`, { headers: { origin: base, "content-type": "application/json" }, data: {}, maxRedirects: 0 });
  assert.equal(signed.status(), 303, `${who}: signed in through the QA session`);
  let steps = 0;

  const journey = {
    context, page, base, device, who, problems,
    desktop: device === "desktop",
    note: (text) => problems.push(`${who}: ${text}`),

    /** The page has drawn: the shell decided, a heading (or the app's top bar or Hem) shown, the skeletons gone. */
    async settled() {
      await page.waitForSelector("html[data-shell=ready]", { timeout: 60_000 });
      // A form page lies over the page it was opened from, whose heading stays in the document hidden: a shown one counts.
      await page.waitForFunction(() => [...document.querySelectorAll(".workspace-main h1, [data-testid=native-top-title], [data-testid=native-home], [data-testid=overview-page]")]
        .some((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; }), undefined, { timeout: 60_000, polling: 100 });
      await page.waitForFunction(() => !document.querySelector('[data-testid="page-skeleton"]'), undefined, { timeout: 30_000 }).catch(() => undefined);
      await page.waitForTimeout(400);
    },

    /** Starts (or restarts) the journey on an address: a new history, so Tillbaka has nothing to go to before the first step. */
    async start(address) {
      await page.goto(`${base}${address}`);
      await journey.settled();
      steps = 0;
      await journey.check();
    },

    /**
     * One step the way a person takes it: a click that changes the address. Afterwards Tillbaka is offered (a computer's
     * floating group; the phone draws none), and the page passes the checks.
     */
    async step(locator, { to, trail = "strict", what } = {}) {
      const before = page.url();
      await locator.first().click();
      await page.waitForURL((url) => url.href !== before && (!to || (to instanceof RegExp ? to.test(url.href) : to(url))), { timeout: 60_000 });
      await journey.settled();
      steps += 1;
      await journey.check({ trail, what });
    },

    /** Tillbaka in the floating group (computer) or the phone's top bar; afterwards a computer offers Framåt. */
    async back({ to, trail = "strict" } = {}) {
      const before = page.url();
      // The phone: the top bar's ‹ (the page above, or the visit before), else the browser's back as the edge swipe.
      if (journey.desktop) await page.getByTestId("floating-nav-back").click();
      else if (await page.getByTestId("native-top-back").isVisible()) await page.getByTestId("native-top-back").click();
      else await page.goBack();
      await page.waitForURL((url) => url.href !== before && (!to || (to instanceof RegExp ? to.test(url.href) : to(url))), { timeout: 60_000 });
      await journey.settled();
      steps = Math.max(0, steps - 1);
      if (journey.desktop && (await page.getByTestId("floating-nav-forward").count()) === 0) journey.note(`no Framåt after Tillbaka on ${relative(page.url())}`);
      await journey.check({ trail });
    },

    /** Framåt in the floating group (computer). */
    async forward({ to, trail = "strict" } = {}) {
      const before = page.url();
      await page.getByTestId("floating-nav-forward").click();
      await page.waitForURL((url) => url.href !== before && (!to || (to instanceof RegExp ? to.test(url.href) : to(url))), { timeout: 60_000 });
      await journey.settled();
      steps += 1;
      await journey.check({ trail });
    },

    /** A filter or a search changes what the list shows but is no step: Tillbaka still leads where it led before. */
    async noStep(action, { what = "a filter" } = {}) {
      const aria = journey.desktop ? await page.getByTestId("floating-nav-back").getAttribute("aria-label").catch(() => null) : null;
      await action();
      await page.waitForTimeout(500);
      if (!journey.desktop) return;
      const after = await page.getByTestId("floating-nav-back").getAttribute("aria-label").catch(() => null);
      if (aria !== after) journey.note(`${what} on ${relative(page.url())} changed where Tillbaka leads (${aria} → ${after})`);
    },

    /**
     * The checks of every page the journey passes. `trail`: strict (the links are breadcrumbTrail's and the last crumb is the
     * heading), links (the links only), sub (a part of the page names itself under it), loose (starts at Översikt, ends with
     * the heading: a form page adds its own name), none.
     */
    async check({ trail = "strict", what } = {}) {
      const where = `${who} ${what ? `${what} ` : ""}${relative(page.url())}`;
      const read = () => page.evaluate((english) => {
        const visible = (element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
        const main = document.querySelector(".workspace-main") ?? document.body;
        const words = new RegExp(english).exec(main.innerText);
        const crumbs = [...document.querySelectorAll("[data-testid=breadcrumbs]")].find(visible);
        return {
          sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          english: words ? words[0] : null,
          crumbs: crumbs ? [...crumbs.querySelectorAll(":scope > ol > li:not([data-testid=breadcrumb-more])")].map((item) => {
            const link = item.querySelector("a");
            return { href: link ? link.getAttribute("href") : null, text: (link ?? item).textContent.trim() };
          }) : null,
          h1: [...document.querySelectorAll(".workspace-main h1")].filter(visible).map((element) => element.textContent.trim())[0] ?? null,
          floating: Boolean(document.querySelector("[data-testid=floating-nav]")),
          back: Boolean(document.querySelector("[data-testid=floating-nav-back]")),
          home: Boolean(document.querySelector("[data-testid=native-home]")),
          anyHeading: [...document.querySelectorAll("h1")].some(visible),
          topTitle: [...document.querySelectorAll("[data-testid=native-top-title]")].filter(visible).map((element) => element.textContent.trim())[0] ?? null,
        };
      }, ENGLISH.source);
      // The shell draws the new trail a moment after the page (after a back step the old one can stand for a frame): wait up to
      // three seconds for the trail breadcrumbTrail gives before calling it wrong.
      const wantedLinks = viewOf(page.url()) === "stats" ? null : JSON.stringify(NAV.breadcrumbTrail({ view: viewOf(page.url()), params: paramsOf(page.url()) }).map((crumb) => crumb.href));
      let state = await read();
      for (let tries = 0; journey.desktop && trail === "strict" && wantedLinks && tries < 6 && JSON.stringify(state.crumbs?.map((crumb) => crumb.href)) !== wantedLinks; tries += 1) {
        await page.waitForTimeout(500);
        state = await read();
      }
      if (process.env.JOURNEY_VERBOSE) console.log(`  check ${where} h1=${state.h1} trail=${JSON.stringify(state.crumbs?.map((crumb) => crumb.href ?? crumb.text))} back=${state.back}`);
      if (state.sideways > 1) journey.note(`${where}: runs out sideways by ${state.sideways} px`);
      if (state.english) journey.note(`${where}: an English word "${state.english}"`);
      if (!journey.desktop) {
        if (state.floating) journey.note(`${where}: the phone draws a floating group`);
        // The app's own top bar (or the page's own heading, as Översikt's) names every screen but Hem (no breadcrumbs at level 1).
        if (!state.home && !state.topTitle && !state.anyHeading) journey.note(`${where}: neither the top bar nor the page has a title`);
        return;
      }
      if (steps > 0 && !state.back) journey.note(`${where}: no Tillbaka after a step`);
      problems.push(...headProblems(await measureHead(page), where));
      if (trail === "none") return;
      const view = viewOf(page.url());
      if (view === "stats") return; // Översikt (any of its tabs) is the trail's root and draws none
      if (!state.crumbs) { journey.note(`${where}: no breadcrumbs`); return; }
      const expected = NAV.breadcrumbTrail({ view, params: paramsOf(page.url()) });
      const last = state.crumbs.at(-1);
      if (last?.href) journey.note(`${where}: the last crumb is a link`);
      if (!["links", "sub"].includes(trail) && state.h1 && last && !cut(state.h1).startsWith(cut(last.text)) && !cut(last.text).startsWith(cut(state.h1))) journey.note(`${where}: the last crumb "${last.text}" is not the heading "${state.h1}"`);
      if (state.crumbs[0]?.href !== "/?view=stats") journey.note(`${where}: the trail does not start at Översikt`);
      const shown = state.crumbs.map((crumb) => crumb.href);
      const wanted = expected.map((crumb) => crumb.href);
      if ((trail === "strict" || trail === "links") && JSON.stringify(shown) !== JSON.stringify(wanted)) journey.note(`${where}: the trail ${JSON.stringify(shown)} is not breadcrumbTrail's ${JSON.stringify(wanted)}`);
      // A part of the page that names itself (useSubPageTrail: a SplitPane's area): breadcrumbTrail's page becomes a link, the part follows it.
      if (trail === "sub" && JSON.stringify(shown) !== JSON.stringify([...wanted.slice(0, -1), `/?view=${view}`, null])) journey.note(`${where}: the trail ${JSON.stringify(shown)} is not breadcrumbTrail's ${JSON.stringify(wanted)} with the part under the page`);
    },

    /** The computer's menu is the one resolveMenu gives the profile: its buttons lifted first, its hidden ones away. */
    async checkMenu(profile, grants) {
      if (!journey.desktop) return;
      const definition = PROFILES.WORK_PROFILE[profile];
      const access = memberAccess(grants);
      const open = MENU.menuKeyOfView(viewOf(page.url()));
      const tucked = PROFILES.workProfileTucked(profile, definition.menuHidden);
      const groups = MENU.sidebarMenu(MENU.resolveMenu(access, { hidden: [...definition.menuHidden], shortcuts: [] }, open, definition.menuFirst, tucked));
      const wanted = groups.flat().map((entry) => entry.key);
      // A button of Verktyg lifted by the profile is a shortcut (menu-shortcut-<key>); Verktyg itself is menu-item-tools.
      const shown = await page.locator("nav[aria-label=Huvudmeny] [data-testid^=menu-item-], nav[aria-label=Huvudmeny] [data-testid^=menu-shortcut-]").evaluateAll((items) => items.map((item) => item.dataset.testid.replace(/^menu-(item|shortcut)-/, "")));
      if (JSON.stringify(shown) !== JSON.stringify(wanted)) journey.note(`the menu for ${profile} is ${JSON.stringify(shown)}, resolveMenu gives ${JSON.stringify(wanted)}`);
      for (const key of definition.menuHidden) if (key !== open && shown.includes(key)) journey.note(`the menu for ${profile} shows the tucked-away ${key}`);
    },

    /**
     * What the profile tucks away is reachable, never forbidden: the computer opens Fler and goes to the page, the phone finds it
     * lower down in Mer (Fler, the office's rows under Kontor). Only the buttons the person may use are looked for.
     */
    async checkTucked(profile, grants) {
      const access = memberAccess(grants);
      const definition = PROFILES.WORK_PROFILE[profile];
      const allowed = definition.menuHidden.filter((key) => MENU.menuItemAllowed(key, access));
      if (!allowed.length) return;
      if (journey.desktop) {
        await page.getByTestId("menu-item-more").click();
        for (const key of allowed) if (!(await page.getByTestId(`menu-item-${key}`).count())) journey.note(`Fler for ${profile} has no ${key}`);
        await journey.step(page.getByTestId(`menu-item-${allowed[0]}`), { trail: "links" });
      } else {
        // The phone's level hides pages made for a larger screen, for everyone alike; what it offers comes from the app's own function.
        const groups = MENU.resolveMenu(access, { hidden: [...definition.menuHidden], shortcuts: [] }, null, definition.menuFirst, PROFILES.workProfileTucked(profile, definition.menuHidden));
        const offered = NATIVE.nativeMoreTools(NATIVE.nativeMoreSections(groups, {}), definition.workView === "supervisor" ? 3 : 1).flatMap((section) => section.rows.map((row) => row.key));
        const rows = await journey.moreRows();
        for (const key of allowed.filter((item) => offered.includes(item))) if (!rows.includes(key)) journey.note(`Mer for ${profile} has no ${key}`);
        await page.getByTestId("native-sheet-close").click();
      }
    },

    /** The phone's Ny: the profile's choices first, as far as the person may make them. */
    async checkPhoneNew(profile) {
      if (journey.desktop) return;
      if (!(await page.getByTestId("native-tab-new").count())) return;
      await page.getByTestId("native-tab-new").click();
      const shown = await page.locator("[data-testid=native-new-choices] [data-testid^=native-new-]").evaluateAll((items) => items.map((item) => item.dataset.testid.replace("native-new-", "")));
      const wanted = PROFILES.WORK_PROFILE[profile].newFirst.filter((key) => shown.includes(key));
      if (JSON.stringify(shown.slice(0, wanted.length)) !== JSON.stringify(wanted)) journey.note(`Ny for ${profile} is ${JSON.stringify(shown)}, the profile puts ${JSON.stringify(wanted)} first`);
      await page.getByTestId("native-sheet-close").click();
    },

    /** The way to change what is shown stands at the foot of the first page, on the computer and on Hem. */
    async checkChangeLink() {
      const link = page.getByTestId("work-profile-change").getByRole("link", { name: "Ändra vad du ser" });
      if (!(await link.count())) journey.note("the first page has no way to change what is shown");
    },

    /** The phone's Hem and tab bar are the profile's, within what the person may use (nativeLayoutAllowed). */
    async checkPhoneHome(profile, grants) {
      if (journey.desktop) return;
      const definition = PROFILES.WORK_PROFILE[profile];
      const { allowedHome, allowedTabs } = LAYOUT.nativeLayoutAllowed(memberAccess(grants));
      await page.getByTestId("native-home-tiles").waitFor();
      const tabs = await page.locator("[data-testid=native-tab-bar] [data-slot-key]").evaluateAll((items) => items.map((item) => item.dataset.slotKey));
      const wantedTabs = definition.tabs.filter((key) => allowedTabs.includes(key));
      if (JSON.stringify(tabs.filter((key) => key !== "more")) !== JSON.stringify(wantedTabs)) journey.note(`the tab bar for ${profile} is ${JSON.stringify(tabs)}, the profile gives ${JSON.stringify(wantedTabs)}`);
      // Fortsätt and Checka in show only when there is something to continue or check in to; Notiser is a list of its own.
      const conditional = new Set(["continue", "checkin", "notices"]);
      // A Hem nobody has arranged starts with what the person is doing now, then the day's lists (appkänslan, punkt 11,
      // 2026-11-23: proposedHomeOrder); the journeys' people have not arranged theirs.
      const wantedTiles = APP_FEEL.proposedHomeOrder(definition.home).filter((key) => allowedHome.includes(key) && !conditional.has(key));
      const keys = [...LAYOUT.HOME_TILE_KEYS, "add"];
      const tiles = await page.locator("[data-testid=native-home-tiles] [data-testid^=native-tile-]").evaluateAll((items, known) => items.map((item) => item.dataset.testid.replace("native-tile-", "")).filter((key) => known.includes(key)), keys);
      const ordered = tiles.filter((key) => wantedTiles.includes(key));
      if (JSON.stringify(ordered) !== JSON.stringify(wantedTiles)) journey.note(`Hem for ${profile} shows ${JSON.stringify(tiles)}, the profile gives ${JSON.stringify(wantedTiles)}`);
      const extra = tiles.filter((key) => !definition.home.includes(key) && !conditional.has(key) && key !== "add");
      if (extra.length) journey.note(`Hem for ${profile} shows tiles outside the profile: ${extra.join(", ")}`);
    },

    /** The phone's Mer: rows by key, so a journey can see what the profile's menu offers there. */
    async moreRows() {
      await page.getByTestId("native-tab-more").click();
      await page.locator("[data-testid^=native-more-]").first().waitFor();
      return page.locator("[data-testid^=native-more-]").evaluateAll((items) => items.map((item) => item.dataset.testid.replace("native-more-", "")));
    },

    /** Fails with every problem the journey met (after the context is closed). */
    async done() {
      await context.close().catch(() => undefined);
      return problems;
    },
  };
  return journey;
}

/**
 * Runs a journey on both devices and fails once with everything found. `walk(journey, profileState)` is called with a desktop
 * journey and then a phone journey, as the QA member (or `as`: owner, superadmin); the profile is put back afterwards, also when a
 * step throws.
 */
async function runJourney({ name, profile, grants, walk, as = "worker" }) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const problems = [];
  let state = null;
  const owner = await openJourney(browser, { base: bases.owner, name: "ägaren" });
  try {
    if (profile) state = await asProfile(owner, profile, { grants });
    for (const device of ["desktop", "phone"]) {
      const journey = await openJourney(browser, { base: bases[as], device, name: profile ?? as });
      try {
        await walk(journey, state);
        console.log(`${name} ${device === "desktop" ? 1440 : 390}: walked`);
      } catch (error) {
        problems.push(`${journey.who}: stopped at ${relative(journey.page.url())}: ${error.message.split("\n")[0]}`);
        // A picture of where it stopped, for the log (tmp/ is never committed).
        const shot = path.join(root, "tmp", "journeys", `${name.replace(/[^a-zåäö0-9]+/gi, "-")}-${device}.png`);
        require("node:fs").mkdirSync(path.dirname(shot), { recursive: true });
        await journey.page.screenshot({ path: shot }).then(() => console.log(`screenshot: ${path.relative(root, shot)}`), () => undefined);
      }
      problems.push(...(await journey.done()));
    }
  } finally {
    if (state) await state.restore().catch((error) => problems.push(`the profile was not put back: ${error.message}`));
    await owner.done();
    await browser.close();
  }
  assert.deepEqual(problems, [], `${name}:\n${problems.join("\n")}`);
  console.log(`PASS ${name}`);
}

module.exports = { bases, NAV, MENU, LAYOUT, PROFILES, WORKER_EMAIL, JOURNEY_PREFIX, sql, measureHead, headProblems, asProfile, memberAccess, memberApi, openJourney, runJourney, relative, viewOf, paramsOf };
