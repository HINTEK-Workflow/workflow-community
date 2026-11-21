import assert from "node:assert/strict";
import test from "node:test";
import { COMPANY_VIEWS, PRODUCT_VIEWS, SETTINGS_VIEWS, activeTab, landingPart, productTabDefs, settingsPartAnchor, settingsPlace, settingsTabDefs } from "../lib/workflow/settings-tabs";
import { breadcrumbTrail } from "../lib/workflow/navigation";
import { MY_SETTINGS_GROUPS, SETTINGS_SECTIONS } from "../lib/workflow/native-mode";

// Flikarna under Inställningar och Installation. Since 2026-10-15 ("undvik undersidor, lägga ihop fler
// saker som skulle kunna ligga i samma kategori som tjänster, nycklar känns lite samma") every tab is one page, one
// sentence each, and every older address still leads to its page – and to its part of the page.

const admin = { admin: true, cloud: true, ai: true, integrations: true, credits: true };
const product = { landingEditor: true, pricing: true, ai: true, serverKeys: true, landingPublished: false };
const labels = (tabs: { label: string }[]) => tabs.map((tab) => tab.label);

test("Inställningar: Mina inställningar and the company's pages (C2, 2026-10-22; Användare a tab, 2026-11-02; Min webbsida and Inlägg moved to Mer › Webb och inlägg 2026-11-20); a member keeps Mina inställningar", () => {
  assert.deepEqual(labels(settingsTabDefs(admin)), ["Mina inställningar", "Företag", "Användare", "Arbetssätt", "Kopplingar"], "five tabs");
  assert.deepEqual(settingsTabDefs(admin).map((tab) => tab.key), ["settings", "company", "administration", "company_features", "advanced"]);
  for (const gone of ["company_website", "company_posts"]) assert.equal(activeTab(settingsTabDefs(admin), gone), null, `${gone} is no tab of Inställningar`);
  for (const tab of settingsTabDefs(admin)) assert.equal(tab.sections.length, 1, `${tab.label}: no sub-pages`);
  assert.deepEqual(settingsTabDefs({ ...admin, admin: false }).map((tab) => tab.key), ["settings"], "a member: Mina inställningar; Hjälp is in the profile menu");
  // Local: no Kopplingar (server keys); Företag offers Cloud; Arbetssätt has no AI or prices.
  assert.deepEqual(labels(settingsTabDefs({ ...admin, cloud: false })), ["Mina inställningar", "Företag", "Användare", "Arbetssätt"]);
  assert.deepEqual(settingsTabDefs({ ...admin, cloud: false }).find((tab) => tab.key === "company_features")!.aliases, { company_values: null }, "Workflow AI and prices are not parts of Arbetssätt in Local");
  assert.equal(settingsTabDefs({ ...admin, credits: false }).find((tab) => tab.key === "company")!.aliases?.credits, undefined, "no billing or credits, no Abonnemang on Företag");
  assert.equal(settingsTabDefs({ ...admin, integrations: false }).some((tab) => tab.key === "advanced"), false, "no API och MCP, no Kopplingar");
  for (const gone of ["ai_settings", "quote_settings", "company_values", "credits", "help"]) assert.equal(settingsTabDefs(admin).some((tab) => tab.key === gone), false, `${gone} is no tab`);
});

// C6 (UX-granskningen, 2026-10-21): five pages without duplicates, replacing the six tabs of 2026-10-15.
test("Installation: Översikt first (beslut 11), then five tabs (C6) and PDF-mallar (2026-11-03) and PLC-apparater (2026-11-06); Webbplats och utskick has its pages, Beteendeanalys only once the landing page is public", () => {
  assert.deepEqual(labels(productTabDefs(product)), ["Översikt", "Kundföretag", "Priser", "Tjänster och nycklar", "Drift och säkerhet", "PDF-mallar", "PLC-apparater", "Webbplats och utskick"]);
  assert.deepEqual(productTabDefs(product).map((tab) => tab.key), ["product_overview", "customer_companies", "pricing_admin", "server_keys", "login_settings", "pdf_templates", "plc_devices", "landing_editor"]);
  for (const tab of productTabDefs(product).filter((item) => item.label !== "Webbplats och utskick")) assert.equal(tab.sections.length, 1, `${tab.label}: no sub-pages`);
  const site = (options: typeof product) => productTabDefs(options).find((tab) => tab.label === "Webbplats och utskick")!.sections.map((section) => section.view);
  assert.deepEqual(site(product), ["landing_editor", "mailings"], "the landing editor and the mailings: tools, not settings");
  assert.deepEqual(site({ ...product, landingPublished: true }), ["landing_editor", "mailings", "behavior_analytics"]);
  // Without ee/ (no prices, no landing editor) the tabs open the page that exists.
  const bare = productTabDefs({ landingEditor: false, pricing: false, ai: true, serverKeys: false });
  // Without a landing page (Community) the tab is Utskick alone and is called so (2026-11-20).
  assert.deepEqual(labels(bare), ["Översikt", "Kundföretag", "AI-kostnad", "Tjänster och nycklar", "Drift och säkerhet", "PDF-mallar", "PLC-apparater", "Utskick"]);
  assert.equal(bare.find((tab) => tab.label === "Utskick")?.key, "mailings", "without the landing editor the tab is Utskick alone");
  assert.equal(bare.find((tab) => tab.label === "Utskick")?.sections.length, 1);
  assert.equal(bare.find((tab) => tab.label === "AI-kostnad")?.key, "ai_admin");
  assert.equal(productTabDefs({ landingEditor: false, pricing: false, ai: false }).some((tab) => tab.key === "ai_admin" || tab.key === "pricing_admin"), false);
});

test("every tab says in one short sentence what it is for", () => {
  for (const tab of [...settingsTabDefs(admin), ...settingsTabDefs({ ...admin, cloud: false }), ...productTabDefs({ ...product, landingPublished: true })]) {
    assert.match(tab.intro, /^[A-ZÅÄÖ][^.]*\.$/, `${tab.label}: one sentence`);
    assert.ok(tab.intro.length <= 110, `${tab.label}: short (${tab.intro.length})`);
  }
});

test("old addresses: every earlier page still opens, under its new tab and on its part of the page", () => {
  const settings = settingsTabDefs(admin);
  // view → [tab, part the page rolls to (null: the top)]. history_retention and advanced&section=history/log are also
  // sent on by app/page.tsx to the tab they moved to.
  const expected: Record<string, [string, string | null]> = {
    settings: ["Mina inställningar", null],
    company: ["Företag", null],
    company_settings: ["Företag", null],
    administration: ["Användare", null],
    history_retention: ["Företag", "history"],
    credits: ["Företag", "billing"],
    company_features: ["Arbetssätt", null],
    ai_settings: ["Arbetssätt", "ai"],
    quote_settings: ["Arbetssätt", "prices"],
    company_values: ["Arbetssätt", null],
    advanced: ["Kopplingar", null],
    integrations: ["Kopplingar", null],
  };
  for (const [view, [tab, part]] of Object.entries(expected)) {
    assert.equal(activeTab(settings, view)?.tab.label, tab, view);
    assert.equal(landingPart(settings, view), part, `${view}: part`);
  }
  // ?section= names a part of the tab's page; anything but a plain name is ignored.
  assert.equal(activeTab(settings, "operator_accounts"), null, "Operatörskonton is a page under Användare, without a tab (2026-11-02)");
  assert.ok((COMPANY_VIEWS as readonly string[]).includes("operator_accounts"), "it marks Inställningar, and Visa mer draws it");
  assert.ok(!(SETTINGS_VIEWS as readonly string[]).includes("operator_accounts"), "no tab row over it");
  assert.equal(landingPart(settings, "administration", "log"), "log");
  assert.equal(landingPart(settings, "company", "history"), "history");
  assert.equal(landingPart(settings, "company", "<script>"), null);
  assert.equal(settingsPartAnchor("history"), "settings-history");

  const products = productTabDefs({ ...product, landingPublished: true });
  const productExpected: Record<string, [string, string | null]> = {
    customer_companies: ["Kundföretag", null], view_as: ["Drift och säkerhet", "view-as"],
    pricing_admin: ["Priser", null], ai_admin: ["Priser", "ai"],
    landing_editor: ["Webbplats och utskick", null], behavior_analytics: ["Webbplats och utskick", null], mailings: ["Webbplats och utskick", null],
    // C6: the e-mail server is only on Tjänster och nycklar – the old address lands on its card.
    mail_settings: ["Tjänster och nycklar", "keys-email"],
    login_settings: ["Drift och säkerhet", null],
    server_keys: ["Tjänster och nycklar", null], services: ["Tjänster och nycklar", null],
  };
  for (const [view, [tab, part]] of Object.entries(productExpected)) {
    assert.equal(activeTab(products, view)?.tab.label, tab, view);
    assert.equal(landingPart(products, view), part, `${view}: part`);
  }
  assert.equal(landingPart(products, "server_keys", "scb"), "scb", "?section=scb lands on the SCB card (the key alarm's link)");
  assert.equal(activeTab(productTabDefs(product), "behavior_analytics"), null, "while hidden the page has no tab, but its address still opens it");
  // The lists the shell and the server use cover every page.
  for (const view of Object.keys(expected)) assert.ok((SETTINGS_VIEWS as readonly string[]).includes(view), view);
  assert.ok(!(PRODUCT_VIEWS as readonly string[]).includes("website_editor"), "no website tab under Installation any more");
  for (const view of Object.keys(productExpected)) assert.ok((PRODUCT_VIEWS as readonly string[]).includes(view), view);
  assert.ok(!(COMPANY_VIEWS as readonly string[]).includes("settings") && !(SETTINGS_VIEWS as readonly string[]).includes("help"), "Hjälp is no setting (C2)");
  assert.equal(activeTab(settings, "help"), null, "Hjälp has no tab");
  assert.ok((COMPANY_VIEWS as readonly string[]).includes("quote_settings"));
  assert.ok((COMPANY_VIEWS as readonly string[]).includes("ai_settings"), "Workflow AI stays an admin page");
});

test("breadcrumbs end with the tab's name; Webbplats och utskick alone shows a page under the tab", () => {
  const crumbs = (view: string) => breadcrumbTrail({ view }).map((crumb) => crumb.label);
  assert.deepEqual(crumbs("company_values"), ["Översikt", "Inställningar", "Arbetssätt", "Värden och referenser"], "the register is reached from Arbetssätt (C2)");
  assert.equal(breadcrumbTrail({ view: "company_values" })[2].href, "/?view=company_features");
  assert.deepEqual(crumbs("help"), ["Översikt", "Hjälp"]);
  assert.deepEqual(crumbs("credits"), ["Översikt", "Inställningar", "Företag"]);
  assert.deepEqual(crumbs("company_features"), ["Översikt", "Inställningar", "Arbetssätt"]);
  assert.deepEqual(crumbs("ai_settings"), ["Översikt", "Inställningar", "Arbetssätt"]);
  assert.deepEqual(crumbs("quote_settings"), ["Översikt", "Inställningar", "Arbetssätt"]);
  assert.deepEqual(crumbs("advanced"), ["Översikt", "Inställningar", "Kopplingar"]);
  // Webb och inlägg (2026-11-20): both tabs, and the old addresses, under Mer.
  for (const view of ["company_website", "company_posts", "web_posts"]) {
    assert.deepEqual(crumbs(view), ["Översikt", "Mer", "Webb och inlägg"], view);
    assert.equal(breadcrumbTrail({ view })[1].href, "/?view=tools", view);
    assert.equal(settingsPlace(view), null, `${view} is no page of Inställningar`);
    assert.ok(!(SETTINGS_VIEWS as readonly string[]).includes(view), view);
  }
  assert.deepEqual(crumbs("server_keys"), ["Översikt", "Installation", "Tjänster och nycklar"]);
  assert.deepEqual(crumbs("services"), ["Översikt", "Installation", "Tjänster och nycklar"]);
  assert.deepEqual(crumbs("mail_settings"), ["Översikt", "Installation", "Tjänster och nycklar"]);
  assert.deepEqual(crumbs("mailings"), ["Översikt", "Installation", "Webbplats och utskick", "Utskick"]);
  assert.deepEqual(crumbs("view_as"), ["Översikt", "Installation", "Drift och säkerhet"]);
  assert.deepEqual(crumbs("pricing_admin"), ["Översikt", "Installation", "Priser"]);
  assert.deepEqual(crumbs("behavior_analytics"), ["Översikt", "Installation", "Webbplats och utskick", "Beteendeanalys"]);
  assert.equal(breadcrumbTrail({ view: "behavior_analytics" })[2].href, "/?view=landing_editor");
  assert.equal(settingsPlace("tasks"), null);
});

test("Mina inställningar: four groups that hold every part once; Tabeller och mätningar is gone", () => {
  assert.deepEqual(MY_SETTINGS_GROUPS.map((group) => group.title), ["Utseende", "Visning på enheten", "Notiser och tips", "Konto"]);
  const all = MY_SETTINGS_GROUPS.flatMap((group) => group.sections);
  assert.deepEqual([...all].sort(), [...SETTINGS_SECTIONS].sort());
  assert.equal(new Set(all).size, all.length);
  assert.equal((SETTINGS_SECTIONS as readonly string[]).includes("tables"), false);
});
