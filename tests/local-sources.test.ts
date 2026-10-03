import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// Lokalt förankrat (2026-10-03): what the server and the browser run is served from the installation itself –
// no CDN, web font service, analytics or external script. Only integrations the administrator switches on call out.
const ROOTS = ["app", "components", "features", "lib", "public", "ee"];
const EXTENSIONS = new Set([".ts", ".tsx", ".css", ".mjs", ".js", ".html", ".json", ".webmanifest"]);
/** Integrations an administrator switches on with their own key, and links shown as text – never loaded by the page. */
const ALLOWED = [
  "api.openai.com", "eu.api.openai.com", // Workflow AI with the installation's own OpenAI key
  "apiafr.scb.se", // company lookup with the installation's own SCB key
  "workflow.hintek.se", // HINTEK's own default address (lib/instance-defaults.ts; the community edition replaces it)
  "github.com", // a link on HINTEK's landing page
  "chatgpt.com", // a link in the MCP instructions
];
const IGNORED = /(^|\.)(example(\.\w+)?|invalid|test|local|localhost)$|^127\.|^www\.w3\.org$|^schema\.org$|^json-schema\.org$/;
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
      const text = readFileSync(file, "utf8");
      if (FORBIDDEN.test(text)) problems.push(`${file}: ${FORBIDDEN.exec(text)![0]}`);
      for (const match of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
        const host = match[1].toLowerCase();
        if (!IGNORED.test(host) && !ALLOWED.includes(host)) problems.push(`${file}: ${host}`);
      }
    }
  }
  assert.deepEqual([...new Set(problems)], []);
});
