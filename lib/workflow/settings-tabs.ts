/**
 * Flikarna under Inställningar och Installation. Since 2026-10-15 ("undvik undersidor, lägga ihop fler
 * saker som skulle kunna ligga i samma kategori som tjänster, nycklar känns lite samma") every tab is ONE page: what used
 * to be a page of its own under a tab is a part of the tab's page, with an anchor (settings-<part>). Pure, so the tab row,
 * the breadcrumbs, the search and the tests read the same structure. Plan: docs/proposals/installningar-produktadmin-2026-10-15.md.
 *
 * Every older address keeps working: a page that became a part is an alias of its tab and lands on its part (the page
 * rolls there), and ?section=<part> on a tab's address does the same. The only tab that still has two pages (a second
 * row of buttons) is Webbplats och utskick: the landing editor is a wide editor, Utskick a tool of its own (C6, 2026-10-21) and
 * Beteendeanalys beside them once the landing page is public. Addresses that moved to another tab are sent on by app/page.tsx.
 */

export type SettingsSectionDef = {
  /** The page (?view=) the section opens. */
  view: string;
  label: string;
};
export type SettingsTabDef = {
  /** The tab's own address: its first section's page. */
  key: string;
  label: string;
  /** One short sentence: what the tab is for. */
  intro: string;
  /** The tab's pages. One for every tab but Webbplats; several pages show a second row of buttons. */
  sections: SettingsSectionDef[];
  /** Older addresses that open this tab's page, and the part of the page each lands on (null: the top). */
  aliases?: Record<string, string | null>;
};

export type SettingsTabOptions = { admin: boolean; cloud: boolean; ai: boolean; integrations: boolean; credits: boolean; prices?: boolean };
/** `companies`: whether Kundföretag is a tab (Community: only when the installation has more than its own company, 2026-11-10). */
export type ProductTabOptions = { landingEditor: boolean; pricing: boolean; ai: boolean; serverKeys?: boolean; landingPublished?: boolean; companies?: boolean };

const tab = (key: string, label: string, intro: string, aliases?: Record<string, string | null>, sections: SettingsSectionDef[] = [{ view: key, label }]): SettingsTabDef =>
  ({ key: sections[0]?.view ?? key, label, intro, sections, ...(aliases ? { aliases } : {}) });

/**
 * Inställningar (UX-granskningen C2, 2026-10-21/22; replaces the nine tabs of 2026-10-15): Mina inställningar and the
 * company's pages – Företag · Användare · Arbetssätt · Kopplingar. Användare is a tab again (2026-11-02; a menu button of
 * its own 2026-11-01): the list, with the person's own page under it and the button Operatörskonton; view=administration opens
 * it, ?section=log too. What was a tab of its own is a part of one of them,
 * and its older address lands on the part: Abonnemang (credits) on Företag, Priser och offert (quote_settings) and Workflow AI
 * (ai_settings) on Arbetssätt. Värden och referenser keeps its page, reached from Arbetssätt (C5 moves it to the forms).
 * Hjälp is no setting: it left the tab row for the profile menu. A member sees Mina inställningar only.
 */
export function settingsTabDefs(options: SettingsTabOptions): SettingsTabDef[] {
  const aiHere = options.ai && options.cloud;
  const pricesHere = options.cloud && options.prices !== false;
  const company: SettingsTabDef[] = !options.admin ? [] : [
    // Företag: the profile, agreements, logo and document profile, the subscription (Cloud) or what Cloud adds (Local),
    // the Kom igång guide and – Cloud – how long the history is kept.
    tab("company", "Företag", options.credits
      ? (options.cloud ? "Företagsuppgifter, avtal, logotyp och rapporter, abonnemang och fakturor." : "Företagsuppgifter, avtal, logotyp och rapporter, och vad Cloud lägger till.")
      : "Företagsuppgifter, avtal, logotyp och rapporter.",
      { company_settings: null, ...(options.cloud ? { history_retention: "history" } : {}), ...(options.credits ? { credits: "billing" } : {}) }),
    // Användare (2026-11-02): the list, the person's own page and Bjud in; Säkerhet and Administrationshistorik under it.
    tab("administration", "Användare", "Medarbetare, inbjudningar och rättigheter."),
    // Arbetssätt: the company's functions, prices and quotes (Cloud), Workflow AI (Cloud with AI) and the way to the values.
    tab("company_features", "Arbetssätt", [
      "Vilka funktioner företaget använder", pricesHere ? "priser och offert" : null, aiHere ? "Workflow AI" : null, "företagets värden",
    ].filter(Boolean).join(", ").replace(/, ([^,]+)$/, " och $1") + ".",
      { ...(aiHere ? { ai_settings: "ai" } : {}), ...(pricesHere ? { quote_settings: "prices" } : {}), company_values: null }),
    // Kopplingar (formerly Kopplingar och nycklar, before that Avancerat): the company's connections, each with its keys. Cloud.
    ...(options.cloud && options.integrations ? [tab("advanced", "Kopplingar", "Bokföring, lön, maskiner, API och MCP samt webb och sociala medier – ett område i taget, med sina nycklar.",
      { integrations: null })] : []),
    // Min webbsida (2026-11-10): the company's own WordPress pages, edited here; every company's admin, Cloud.
    ...(options.cloud ? [tab("company_website", "Min webbsida", "Företagets egen WordPress-webbplats: sidorna redigeras här.", { website_editor: null })] : []),
    // Inlägg (2026-11-10): drafts for the company's Facebook page and Instagram account, with picture and preview; nothing is
    // published until an admin presses Publicera. Beside Min webbsida; every company's admin, Cloud.
    ...(options.cloud ? [tab("company_posts", "Inlägg", "Inlägg till Facebook, Instagram och LinkedIn: utkast, bild och förhandsvisning.")] : []),
  ];
  return [
    tab("settings", "Mina inställningar", "Din egen arbetsyta: utseende, konto, inloggning och notiser."),
    ...company,
  ];
}

/**
 * Installation (superadmin only), C6 (UX-granskningen, 2026-10-21; replaces the six tabs of 2026-10-15):
 * five pages without duplicates – Kundföretag · Priser · Tjänster och nycklar · Drift och säkerhet · Webbplats och utskick.
 * Every key and choice is in exactly one place: the OpenAI key and the e-mail server's details only on Tjänster och
 * nycklar, which mails are sent and web push on Drift och säkerhet, the mailings (a tool, not a setting) on Webbplats och
 * utskick, and what AI costs and how it is used under Priser → Avancerat. The older addresses land on their new place:
 * mail_settings on the e-mail card of Tjänster och nycklar, mailings on Utskick, ai_admin on Priser → Avancerat, view_as on
 * Visa som. Beteendeanalys is a page of Webbplats och utskick once the landing page is public (its address still opens it).
 */
export function productTabDefs(options: ProductTabOptions): SettingsTabDef[] {
  const site: SettingsSectionDef[] = [
    ...(options.landingEditor ? [{ view: "landing_editor", label: "Landningssidan" }] : []),
    { view: "mailings", label: "Utskick" },
    ...(options.landingEditor && options.landingPublished ? [{ view: "behavior_analytics", label: "Beteendeanalys" }] : []),
  ];
  return [
    tab("product_overview", "Översikt", options.pricing ? "Det som behöver din uppmärksamhet: nya företag, betalningar, nycklar och driftlarm." : "Det som behöver din uppmärksamhet: nya företag, nycklar och driftlarm."),
    ...(options.companies === false ? [] : [tab("customer_companies", "Kundföretag", options.pricing ? "Kundföretagen, deras ägare, abonnemang och krediter – aldrig deras arbete." : "Företagen i installationen och deras ägare – aldrig deras arbete.")]),
    // Priser; what AI costs under its Avancerat. Without ee/'s prices the tab is the AI cost alone, under its own address.
    ...(options.pricing
      ? [tab("pricing_admin", "Priser", options.ai ? "Planer, priser, kampanjer och rabattkoder, och vad AI kostar." : "Planer, priser, kampanjer och rabattkoder.", options.ai ? { ai_admin: "ai" } : undefined)]
      : options.ai ? [tab("ai_admin", "AI-kostnad", "Vad AI kostar och hur det används.")] : []),
    // Tjänster och nycklar: every outside service and its key on one page, with the overview of what is missing on top.
    tab("server_keys", "Tjänster och nycklar", options.pricing ? "Tjänster som Workflow använder och deras nycklar: betalning, AI, inloggning, grossister, e-post och kartor." : "Tjänster som Workflow använder och deras nycklar: AI, inloggning, grossister, e-post och kartor.", { services: null, mail_settings: "keys-email" }),
    // Drift och säkerhet: who may sign in and how, which mails are sent, web push, the superadmin's two steps and Visa som
    // (2026-10-15: here, not on Kundföretag); the installation's security log under Avancerat.
    tab("login_settings", "Drift och säkerhet", "Vem som får logga in, automatiska mejl, webbpush, superadmins säkerhet, Visa som och servrarna.", { view_as: "view-as" }),
    // PDF-mallar (2026-11-03): the documents' texts, what is shown and in which order; the layout stays with the design.
    tab("pdf_templates", "PDF-mallar", "Klicka på en text i dokumentet och skriv."),
    // PLC-apparater (2026-11-06): the simulator's devices – picture, terminals and function from a fixed list.
    tab("plc_devices", "PLC-apparater", "Bild, plintar och funktion för simulatorns apparater."),
    tab(site[0].view, "Webbplats och utskick", options.landingEditor ? "Den publika landningssidan och utskicken till användarna." : "Utskicken till användarna.", undefined, site),
  ];
}

/** Every page that sits under Inställningar (the tabs' pages and the older addresses); their parent is Inställningar. Hjälp is not one since C2 (2026-10-22). */
export const SETTINGS_VIEWS = ["settings", "company", "administration", "quote_settings", "company_features", "company_values", "ai_settings", "credits", "advanced", "company_settings", "integrations", "history_retention", "company_website", "company_posts"] as const;
/**
 * The company's pages under Inställningar (admins only). Operatörskonton is a sub-page of Användare (2026-11-02), without a
 * tab row: it marks Inställningar, and Visa mer draws it after Företagets inställningar.
 */
export const COMPANY_VIEWS = [...SETTINGS_VIEWS.filter((view) => view !== "settings"), "operator_accounts"] as const;
/** Every page under Installation (superadmin only). */
export const PRODUCT_VIEWS = ["product_overview", "customer_companies", "pricing_admin", "ai_admin", "landing_editor", "pdf_templates", "plc_devices", "mailings", "mail_settings", "login_settings", "server_keys", "services", "view_as", "behavior_analytics"] as const;

/** The widest structure, to name a page's tab whatever the installation has (breadcrumbs, search). */
const ALL_SETTINGS = settingsTabDefs({ admin: true, cloud: true, ai: true, integrations: true, credits: true });
const ALL_PRODUCT = productTabDefs({ landingEditor: true, pricing: true, ai: true, serverKeys: true, landingPublished: true });

/** The tab and page a view is shown under: its own page, or – for an older address – its tab's first page. */
export function activeTab(tabs: readonly SettingsTabDef[], view: string): { tab: SettingsTabDef; section: SettingsSectionDef } | null {
  for (const candidate of tabs) {
    const own = candidate.sections.find((item) => item.view === view);
    if (own) return { tab: candidate, section: own };
    if (candidate.aliases && Object.hasOwn(candidate.aliases, view)) return { tab: candidate, section: candidate.sections[0] };
  }
  return null;
}

/** A part's anchor on its tab's page (`SettingsPart`/`SettingsGroup` set it; the tab row rolls to it). */
export const settingsPartAnchor = (part: string) => `settings-${part}`;

/**
 * The part of the page an address lands on: ?section=<part> when it names one, otherwise the part an older address
 * became (?view=view_as → Visa som on Inloggning och säkerhet), otherwise none (the top).
 */
export function landingPart(tabs: readonly SettingsTabDef[], view: string, section?: string | null): string | null {
  if (section && /^[a-z][a-z-]{0,40}$/.test(section)) return section;
  for (const candidate of tabs) if (candidate.aliases && Object.hasOwn(candidate.aliases, view)) return candidate.aliases[view];
  return null;
}

/** The address of a page under a tab. */
export function sectionHref(section: SettingsSectionDef): string {
  return `/?view=${section.view}`;
}

/**
 * Where a page sits: Inställningar or Installation, its tab, and – when the tab has several pages (Webbplats) –
 * the page's name. Used by the breadcrumbs (Installation › Webbplats › Beteendeanalys).
 */
export function settingsPlace(view: string): { area: "settings" | "product"; tab: SettingsTabDef; section: SettingsSectionDef | null } | null {
  for (const [area, tabs] of [["settings", ALL_SETTINGS], ["product", ALL_PRODUCT]] as const) {
    const found = activeTab(tabs, view);
    if (found) return { area, tab: found.tab, section: found.tab.sections.length > 1 ? found.section : null };
  }
  return null;
}
