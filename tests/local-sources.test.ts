import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { INSTANCE_DEFAULTS } from "../lib/instance-defaults";

// The suggested Azure address, when the installation has one (the community edition has none).
const AZURE_PRESET = (INSTANCE_DEFAULTS.azurePreset as { endpoint?: string } | null)?.endpoint ?? null;

// Lokalt förankrat (2026-10-03): what the server and the browser run is served from the installation itself –
// no CDN, web font service, analytics or external script. Only integrations the administrator switches on call out.
const ROOTS = ["app", "components", "features", "lib", "public", "ee"];
const EXTENSIONS = new Set([".ts", ".tsx", ".css", ".mjs", ".js", ".html", ".json", ".webmanifest"]);
/** Integrations an administrator switches on with their own key, and links shown as text – never loaded by the page. */
const ALLOWED = [
  "api.openai.com", "eu.api.openai.com", // Workflow AI with the installation's own OpenAI key
  "apiafr.scb.se", // company lookup with the installation's own SCB key
  "app.hintekwork.com", "workflow.hintek.se", // Workflow's own address (lib/instance-defaults.ts; the community edition replaces it) and the old one
  "github.com", // a link on Workflow's landing page
  "www.facebook.com", "www.linkedin.com", "www.instagram.com", // Workflow's own accounts, links in the landing page's footer (2026-11-11)
  "fontawesome.com", // the attribution the footer's brand icons require (CC BY 4.0), a comment in ee/landing/ui/footer-icons.tsx; never fetched
  "raw.githubusercontent.com", // the Community install command shown as text on Workflow's landing page (never loaded by the app)
  "chatgpt.com", // a link in the MCP instructions
  "www.google.com", "maps.apple.com", // Öppna i karta: a place's position opened by the person in a new tab (Platser, 2026-10-04)
  "creativecommons.org", // the licence link in the map's attribution (CC BY 4.0)
  // Tillbud och olycksfall (2026-10-30): links to the authorities' own report pages, opened by the person in a new tab.
  "www.anmalarbetsskada.se", "www.elsakerhetsverket.se", "www.av.se",
  "www.gnu.org", // the licence's own page, a link a person may click under Om Workflow in the Community edition; nothing is fetched
  "api.w.org", // WordPress's name for its REST link (rel="https://api.w.org/") that Min webbsida reads in a site's answer; never fetched
  "developers.facebook.com", // Så skapar du en egen Meta-app (2026-11-12): a link in the Meta card's guide, opened by the person in a new tab
  "www.paxml.se", // the schema reference written into a PAXml file (lib/payroll/paxml.ts); a reader may use it, Workflow never fetches it
  "www.youtube.com", // Filmer (2026-11-20): Öppna på YouTube, a published film's own address opened by the person in a new tab; never embedded or fetched
];
/**
 * Lantmäteriet's map (2026-10-04) and addresses (2026-10-08): only the server talks to Lantmäteriet. Its addresses
 * may appear in the server's map and geo modules and nowhere else, so nothing the browser runs can reach it.
 */
const SERVER_MODULES = ["lib/map/", "lib/geo/"];
const SERVER_ONLY = new Map<string, string[]>([
  ...["api.lantmateriet.se", "api-ver.lantmateriet.se", "apimanager.lantmateriet.se", "apimanager-ver.lantmateriet.se", "dl1.lantmateriet.se"].map((host) => [host, SERVER_MODULES] as [string, string[]]),
  // Inloggning med Microsoft (2026-10-11): off until the superadmin enters keys; only the server's sign-in modules
  // name Microsoft (the browser is sent there by the sign-in itself, never loads anything from it).
  // Operatörssidan (2026-10-30): the Microsoft group sign-in and its Graph membership check, on the server only.
  ...["login.microsoftonline.com", "graph.microsoft.com"].map((host) => [host, ["lib/auth/microsoft-core.ts", "lib/auth/microsoft.ts", "lib/operator/microsoft-group.ts", "lib/operator/microsoft-group-server.ts"]] as [string, string[]]),
  // Offert till Fortnox (2026-10-09): only with the company's own key, sent by the server's one client module.
  ["api.fortnox.se", ["lib/quotes/fortnox-client.ts"]],
  // The installation's own suggested Azure resource (the EU provider, 2026-10-24): in the installation's defaults only; the
  // community edition replaces that file and has none. The server alone calls the address the owner saved.
  ...(AZURE_PRESET ? [[new URL(AZURE_PRESET).host, ["lib/instance-defaults.ts"]] as [string, string[]]] : []),
  // Solar (2026-10-13 natt): Workflow's own keys under Servernycklar, read only, one server module.
  ...["sgidp.b2clogin.com", "sgidp.onmicrosoft.com", "api.solar.eu"].map((host) => [host, ["lib/integrations/solar.ts"]] as [string, string[]]),
  // YouTube (2026-11-20): Google's sign-in, tokens and the YouTube Data API with the company's own keys, from the server's one client
  // module (the browser is only sent to the sign-in page by Koppla YouTube and never loads anything from Google).
  ...["accounts.google.com", "oauth2.googleapis.com", "www.googleapis.com"].map((host) => [host, ["lib/youtube/api.ts"]] as [string, string[]]),
  // Kontrollera nya versioner (K4.8, 2026-11-28): Community only and off from the start; the server reads the public list of releases.
  ["api.github.com", ["lib/updates/version-check-server.ts"]],
]);
// The commercial part's own outside hosts (2026-10-25: Workflow's key vault), named only in ee/, used only by its modules; a host
// the core names too (api.github.com) keeps the core's modules beside ee/'s.
for (const { host, modules } of existsSync("ee/server-hosts.json") ? JSON.parse(readFileSync("ee/server-hosts.json", "utf8")) as { host: string; modules: string[] }[] : [])
  SERVER_ONLY.set(host, [...(SERVER_ONLY.get(host) ?? []), ...modules]);
// Names that are identifiers, never fetched: XML namespaces (w3.org, the sitemap's sitemaps.org) and schema.org types.
const IGNORED = /(^|\.)(example(\.\w+)?|invalid|test|local|localhost)$|^127\.|^www\.w3\.org$|^www\.sitemaps\.org$|^schema\.org$|^json-schema\.org$/;
const FORBIDDEN = /fonts\.googleapis|fonts\.gstatic|cdnjs|jsdelivr|unpkg|googletagmanager|google-analytics|plausible\.io|posthog|sentry\.io|segment\.(io|com)|hotjar/i;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" || name === "tests" ? [] : files(full);
    return EXTENSIONS.has(path.extname(name)) ? [full] : [];
  });
}

test("the app loads nothing from third parties: no CDN, web fonts, analytics or unknown hosts", () => {
  const problems: string[] = [];
  // ee/ is absent in the core-only check and in the community edition.
  for (const root of ROOTS.filter((dir) => existsSync(dir))) {
    for (const file of files(root)) {
      // Sajtens typsnitt (Min webbsida, 2026-11-10): the server reads a site's Google Fonts css and copies the files to Workflow, so
      // the browser never loads them; only that server module may name the host, and nothing else forbidden may hide behind it.
      const raw = readFileSync(file, "utf8");
      const text = file.split(path.sep).join("/") === "lib/website/look-server.ts" ? raw.replace(/"fonts.googleapis.com"/g, "") : raw;
      if (FORBIDDEN.test(text)) problems.push(`${file}: ${FORBIDDEN.exec(text)![0]}`);
      for (const match of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
        const host = match[1].toLowerCase();
        const serverOnly = SERVER_ONLY.get(host);
        if (serverOnly) { if (!serverOnly.some((prefix) => file.split(path.sep).join("/").startsWith(prefix))) problems.push(`${file}: ${host} outside the server's map and geo modules`); continue; }
        if (!IGNORED.test(host) && !ALLOWED.includes(host)) problems.push(`${file}: ${host}`);
      }
    }
  }
  assert.deepEqual([...new Set(problems)], []);
});

test("the map's tiles come from this server: no browser code reaches Lantmäteriet or imports the server's map module", () => {
  const problems: string[] = [];
  for (const root of ["app", "components", "features"].filter((dir) => existsSync(dir))) {
    for (const file of files(root)) {
      const text = readFileSync(file, "utf8");
      const browser = /^["']use client["']/m.test(text) || file.startsWith(`components${path.sep}`) || file.startsWith(`features${path.sep}`);
      if (/lantmateriet\.se/i.test(text)) problems.push(`${file}: mentions lantmateriet.se`);
      if (browser && /lib\/map\/(topowebb|sqlite-remote)/.test(text)) problems.push(`${file}: imports the server's map module`);
    }
  }
  // The viewer asks only our own tile address.
  const viewer = readFileSync("features/workflow/map-view.tsx", "utf8");
  assert.match(viewer, /L\.tileLayer\("\/api\/map\/tiles\/\{z\}\/\{x\}\/\{y\}\.png"/);
  // A built client bundle, when there is one, carries no Lantmäteriet address.
  const staticDir = path.join(".next", "static");
  if (existsSync(staticDir)) {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const full = path.join(dir, name); return statSync(full).isDirectory() ? walk(full) : full.endsWith(".js") ? [full] : []; });
    for (const file of walk(staticDir)) if (/lantmateriet\.se/i.test(readFileSync(file, "utf8"))) problems.push(`${file}: client bundle mentions lantmateriet.se`);
  }
  assert.deepEqual(problems, []);
});

test("the map's attribution names the source, ©Lantmäteriet, that the tiles are unchanged and CC BY 4.0 with its link", () => {
  const attribution = readFileSync("lib/map/attribution.ts", "utf8");
  assert.match(attribution, /Topografisk webbkarta Nedladdning, raster/);
  assert.match(attribution, /©Lantmäteriet/);
  assert.match(attribution, /https:\/\/creativecommons\.org\/licenses\/by\/4\.0\//);
  const viewer = readFileSync("features/workflow/map-view.tsx", "utf8");
  for (const part of ["MAP_SOURCE_NAME", "©Lantmäteriet", "MAP_LICENSE_URL", "oförändrade"]) assert.ok(viewer.includes(part), part);
});
