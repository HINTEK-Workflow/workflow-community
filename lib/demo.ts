/** Session cookie that switches `/?view=…` to the in-browser public demo. It grants no access. */
export const DEMO_COOKIE = "hwf_demo";
/** The demo's invented company (renamed 2026-11-07 so no real company is shown); the demo machine's operator page shows it too. */
export const DEMO_COMPANY = "Kopplingsbyrån AB";

/**
 * The pages (views) the public demo answers (app/page.tsx). A page of the menu that is in neither this list nor
 * DEMO_NOT_AVAILABLE makes tests/demo-coverage.test.ts fail, so the demo cannot silently fall behind the product (2026-11-04).
 */
export const DEMO_VIEWS = ["demo", "stats", "notifications", "new_task", "workflow_task", "new_project", "projects", "planning", "project_planning", "capacity", "rounds", "project", "tasks", "work_orders", "time", "customers", "place", "report_archive", "self_inspection", "deviations", "instruments", "calculators", "tools", "help", "settings", "administration", "operator_accounts", "company", "company_features", "customer_invoices", "ai_settings", "company_values", "quote_settings", "quotes", "quote", "integrations", "invoice_bases", "purchases", "purchase", "articles", "maintenance", "forms", "import", "advanced", "boards", "agents", "news", "documents"] as const;

/**
 * demo / demo on the login page (2026-11-04) opens the public demo, exactly like the demo button. It is an exact match
 * of the two typed values, checked in the browser before anything is sent: it creates no account or session, and every other
 * pair, including "demo" with another password, goes to the ordinary sign-in and fails there like any wrong password.
 */
export const DEMO_LOGIN_NAME = "demo";
export const isDemoLogin = (email: string, password: string) => email === DEMO_LOGIN_NAME && password === DEMO_LOGIN_NAME;
/** Where the login page sends demo / demo; `via=login` is only counted as the way in (Beteendeanalys). */
export const DEMO_LOGIN_HREF = "/demo?via=login";

/** The version the demo says it shows; it is the running build's, so it can only differ from package.json if the build does (tests/demo-coverage.test.ts). */
export const demoVersionText = (version: string) => `Version ${version}`;
/** The Demo page (2026-11-05: "där görs alla val och information och koppling mot PLC"): only the demo has it, and a visit starts there. */
export const DEMO_PAGE_HREF = "/?view=demo";
/** What /demo only uses itself: the way in (counted) and Avsluta demon; never passed on to the page. */
const DEMO_ROUTE_ONLY = new Set(["via", "exit"]);
/**
 * Where /demo sends the visitor once the demo is on (2026-11-22: a link to one of the demo's pages, /demo?view=work_orders, opened
 * the Demo page instead, and the page's own address /?view=work_orders without the demo meets the login). With a view the page opens
 * inside the demo with the rest of its address (projectId, taskId …); without one the Demo page as before. The address is always
 * relative to the app (it cannot lead elsewhere), keys are plain names and values are capped; app/page.tsx decides as always what
 * the view shows in the demo (an unknown page opens Översikt, a page the demo lacks says so).
 */
export function demoEntryHref(params: URLSearchParams): string {
  const view = params.get("view") ?? "";
  if (!/^[a-z_]{1,40}$/.test(view) || view === "demo") return DEMO_PAGE_HREF;
  const next = new URLSearchParams({ view });
  for (const [key, value] of params) {
    if (key === "view" || DEMO_ROUTE_ONLY.has(key) || next.has(key) || !/^[A-Za-z][A-Za-z_]{0,39}$/.test(key) || value.length > 200) continue;
    next.set(key, value);
  }
  return `/?${next}`;
}
/** Prova maskinkopplingen, a part of the Demo page; the simulator opens with its ready machine. */
export const DEMO_MACHINE_HREF = `${DEMO_PAGE_HREF}#maskin`;
export const DEMO_SIMULATOR_EXAMPLE = "demokoppling";
/** The simulator with the demo machine loaded and in RUN; with the Workflow window it also connects to it. Every button to the simulator on the Demo page uses this. */
export const DEMO_SIMULATOR_HREF = `/plc-simulator?exempel=${DEMO_SIMULATOR_EXAMPLE}`;
export const demoSimulatorHref = (workflowWindow?: string | null) => workflowWindow ? `${DEMO_SIMULATOR_HREF}&wf=${encodeURIComponent(workflowWindow)}` : DEMO_SIMULATOR_HREF;
/** The three windows on the Demo page (2026-11-04, moved from Översikt 2026-11-05). */
export const DEMO_OPERATOR_HREF = "/operator/demo?demokoppling=1";
export const DEMO_START_STEPS = ["Beskriv maskinen", "Kör PLC:n", "Skriv på operatörssidan", "Se resultatet i Workflow"] as const;
export const DEMO_START_ITEMS = [
  { key: "workflow", title: "Workflow", line: "Larm, arbetsordrar och maskinens beskrivning." },
  { key: "simulator", title: "PLC-simulatorn", line: "Knapp, fläkt och motorskydd i ett eget fönster." },
  { key: "operator", title: "Operatörsterminalen", line: "Välj maskin och skriv vad som har hänt." },
] as const;
export type DemoStartKey = (typeof DEMO_START_ITEMS)[number]["key"];

/**
 * Pages of the menu that the demo does not have, each with the reason (shown nowhere; it makes the choice visible when a new
 * page is added). A page is moved to DEMO_VIEWS when the demo gets its answers.
 */
export const DEMO_NOT_AVAILABLE: Readonly<Record<string, string>> = {
  ai: "Workflow AI är chatten, ingen egen sida. I demon ger chatten färdiga exempelsvar från demoföretaget, utan AI-nyckel och utan server (features/demo/demo-ai.ts).",
  web_posts: "Webb och inlägg publicerar på företagets egna konton och webbplats via servern; demon har inga kopplingar.",
};
