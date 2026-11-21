// What an installation without the commercial part shows and refuses (2026-11-02): no payment rows, no key vault, a source
// link and a licence notice, and a limit per company where companies share the installation's keys.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { after, beforeEach, test } from "node:test";
import { EE_PRESENT } from "@ee/present";
import { aiCompanyRule, allowCompanyAiCall, AI_COMPANY_LIMIT_REASON } from "../lib/ai/company-limit";
import { parseEnv } from "../lib/env";
import { publicInstance } from "../lib/instance";
import { BILLING_KEY_IDS, serverKeyStatuses } from "../lib/integrations/server-keys";
import { CENTRAL_FIELD_IDS, isCloudOnlyField, visibleCentralFields } from "../lib/secrets/central-fields";
import { productTabDefs } from "../lib/workflow/settings-tabs";
import { hitRateLimit, RATE_RULES, setRateLimitStoreForTests, type RateLimitStore } from "../lib/security/rate-limit";

const read = (file: string) => readFileSync(file, "utf8");

// ---------- Stripe ----------

test("without billing the payment keys are not rows at all; with billing they stay as they were", () => {
  const withBilling = serverKeyStatuses({}).map((row) => row.id);
  assert.ok(withBilling.includes("stripe_secret") && withBilling.includes("stripe_webhook"), "the default is every row");
  const without = serverKeyStatuses({}, { billing: false }).map((row) => row.id);
  for (const id of BILLING_KEY_IDS) assert.ok(!without.includes(id), id);
  assert.deepEqual(without, withBilling.filter((id) => !BILLING_KEY_IDS.includes(id)), "nothing else changes");
  // Cloud has no OpenAI card (2026-11-21, F11); Community keeps it.
  const cloudRows = serverKeyStatuses({}, { openai: false }).map((row) => row.id);
  assert.deepEqual(cloudRows, withBilling.filter((id) => id !== "openai"));
  assert.deepEqual(visibleCentralFields(true), CENTRAL_FIELD_IDS);
  // Without billing neither the payment keys nor a key only the commercial part uses (GitHub-ärenden, 2026-11-13).
  assert.deepEqual(visibleCentralFields(false), CENTRAL_FIELD_IDS.filter((field) => !field.startsWith("stripe.") && !isCloudOnlyField(field)));
});

test("the server follows features.billing: the rows, a hidden key's check and save, and the status page", () => {
  const handler = read("lib/api-handlers/integration-keys.ts");
  // The OpenAI card is Community's only (2026-11-21, F11).
  assert.match(handler, /serverKeyStatuses\(\{ \.\.\.env, \.\.\.resolvedAsEnv\(secrets\) \}, \{ billing: publicInstance\(\)\.features\.billing, openai: publicInstance\(\)\.community \}\)/);
  assert.match(handler, /if \(!status\) throw new ApiError\(404, "Nyckeln finns inte i den här installationen\."\)/);
  assert.match(handler, /!publicInstance\(\)\.features\.billing && \(BILLING_KEY_IDS as readonly string\[\]\)\.includes\(SERVER_SECRET_ROW\[command\.field\]\)/);
  assert.ok(handler.indexOf("BILLING_KEY_IDS as readonly") < handler.indexOf("await requireFreshAuth(ctx.user.id, ctx.auth);\n      const value = command.action === \"save_server_secret\""));
  assert.match(read("lib/secrets/central-store.ts"), /visibleCentralFields\(publicInstance\(\)\.features\.billing\)/);
});

test("the pages follow features.billing: the Betalning group, the cookie text and the checkout banners", () => {
  assert.match(read("features/integrations/integration-keys.tsx"), /features\.billing \|\| group\.id !== "payment"/);
  const cookie = read("components/cookie-notice.tsx");
  assert.match(cookie, /features\.billing\s*\? "Workflow laddar inga skript, typsnitt eller bilder från andra webbplatser\. Produktbilder hämtas av vår server, inte av din webbläsare\. Loggar du in med Google eller Microsoft, eller betalar via Stripe/);
  assert.match(cookie, /: "Workflow laddar inga skript, typsnitt eller bilder från andra webbplatser\. Har installationen kopplat en grossist hämtas produktbilderna av installationens server/);
  const page = read("app/page.tsx");
  assert.match(page, /features\.billing && params\.checkout === "canceled"/);
  assert.match(page, /features\.billing && params\.checkout === "success"/);
  assert.match(read("features/kfid/administration.tsx"), /features\.billing\s*\? "Arbetsdata lagras på servern/);
  const companies = read("features/kfid/customer-companies.tsx");
  for (const pattern of [/features\.credits \? <><Button[^\n]*\n\s*setCreditCompany/, /features\.credits \? \{ icon: Coins, label: "Krediter"/, /features\.credits \? <div><dt[^>]*>Kreditsaldo/, /features\.billing \? <div><dt[^>]*>Faktura-e-post/, /features\.billing \? "Kundföretag, abonnemang och krediter\."/, /features\.billing \? "Fakturor, betalningar, krediter/]) assert.match(companies, pattern);
});

test("the product tabs speak of payments only where the installation sells", () => {
  const options = { landingEditor: false, ai: true };
  const intro = (pricing: boolean) => productTabDefs({ ...options, pricing }).filter((tab) => ["product_overview", "customer_companies", "server_keys"].includes(tab.key)).map((tab) => tab.intro).join(" ");
  assert.match(intro(true), /betalningar[\s\S]*abonnemang och krediter[\s\S]*betalning/);
  assert.doesNotMatch(intro(false), /betalning|abonnemang|krediter/);
});

test("Kundföretag is a tab only when the installation has more than its own company (Community, 2026-11-10)", () => {
  const options = { landingEditor: false, pricing: false, ai: true };
  const keys = (companies?: boolean) => productTabDefs({ ...options, companies }).map((tab) => tab.key);
  assert.ok(keys().includes("customer_companies"), "as before when nothing is said (Cloud)");
  assert.ok(keys(true).includes("customer_companies"));
  assert.ok(!keys(false).includes("customer_companies"));
  assert.equal(keys(false)[0], "product_overview", "Översikt stays first and leads to Alla företag");
  const page = readFileSync("app/page.tsx", "utf8");
  assert.ok(page.includes("prisma.organization.count({ where: { id: { not: user.activeOrganizationId"), "counted besides the installation's own");
  assert.ok(page.includes("customerCompaniesTab={customerCompaniesTab}"));
});

test("the weekly letter of Workflow's release notes is off without the commercial part; the mailings stay", () => {
  assert.equal(publicInstance({}).features.releaseNewsletter, EE_PRESENT);
  const server = readFileSync("lib/mail/release-newsletter-server.ts", "utf8");
  for (const name of ["pendingReleaseNewsletter", "weeklyDraftDue", "runWeeklyDraft"])
    assert.ok(server.slice(server.indexOf(`export async function ${name}`)).split("\n").slice(0, 4).join("\n").includes("features.releaseNewsletter"), name);
  assert.ok(readFileSync("features/workflow/mailings.tsx", "utf8").includes('data.weekly.available === false ? null : <Panel title="Veckobrev"'));
});

test("no core text names Workflow's key to Solar: the installation's own name comes from the instance", () => {
  for (const file of ["lib/integrations/solar.ts", "lib/catalogue/solar-categories.ts", "lib/integrations/wholesale-api.ts"]) {
    const text = read(file);
    assert.doesNotMatch(text, /Workflows (nyckel|klient-id)/, file);
    assert.match(text, /publicInstance\(\)\.name/, file);
  }
  // Built from the quoted word, which the Community export's rewrite keeps (a regex literal would be rewritten with the code).
  assert.doesNotMatch(read("lib/catalogue/gate-text.ts"), new RegExp("HINTEK"));
});

// ---------- the key vault ----------

const server = { NODE_ENV: "development" as const, DATABASE_URL: "postgresql://x:y@127.0.0.1:5432/kfid_v3_test", AUTH_SECRET: "a".repeat(40), INTEGRATION_KEYS_SECRET: "b".repeat(40), APP_URL: "http://localhost:3000" };

test("CENTRAL_SECRET_STORE=vault is refused where there is no key vault to use", () => {
  assert.equal(parseEnv({ ...server }).CENTRAL_SECRET_STORE, "database", "the default in every edition");
  if (EE_PRESENT) assert.equal(parseEnv({ ...server, CENTRAL_SECRET_STORE: "vault" }).CENTRAL_SECRET_STORE, "vault");
  else assert.throws(() => parseEnv({ ...server, CENTRAL_SECRET_STORE: "vault" }), /CENTRAL_SECRET_STORE=vault needs the commercial part/);
});

// ---------- the source link ----------

test("the source link is the installation's own setting, and only ever an http(s) address", () => {
  assert.equal(publicInstance({}).community, !EE_PRESENT);
  assert.equal(publicInstance({ INSTANCE_SOURCE_URL: "https://git.example.se/workflow" }).sourceUrl, "https://git.example.se/workflow");
  for (const bad of ["javascript:alert(1)", "ftp://x", "not a url", "https://has space"]) assert.equal(publicInstance({ INSTANCE_SOURCE_URL: bad }).sourceUrl, "", bad);
  const about = read("features/kfid/workspace.tsx");
  assert.match(about, /\{instance\.community \? <p data-testid="about-licence">/, "only in the Community build");
  assert.match(about, /GNU Affero General Public License v3\.0/);
  assert.match(about, /href=\{instance\.sourceUrl\}/);
});

// ---------- quotas ----------

const counts = new Map<string, number>();
const memory: RateLimitStore = {
  async hit(key) {
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return { count, windowStart: new Date() };
  },
  async read(key) {
    return counts.has(key) ? { count: counts.get(key)!, windowStart: new Date() } : null;
  },
  async clear(key) {
    counts.delete(key);
  },
};
beforeEach(() => {
  counts.clear();
  setRateLimitStoreForTests(memory);
});
after(() => setRateLimitStoreForTests(null));

test("one company reaching Solar's limit does not touch another company", async () => {
  const rule = { ...RATE_RULES.solarOrganization, limit: 3 };
  for (let index = 0; index < 3; index += 1) assert.equal((await hitRateLimit(rule, "company-a")).allowed, true);
  assert.equal((await hitRateLimit(rule, "company-a")).allowed, false);
  assert.equal((await hitRateLimit(rule, "company-b")).allowed, true);
  assert.ok(RATE_RULES.solarOrganization.limit >= RATE_RULES.solarMasterUser.limit, "the company's limit is never below one person's");
  const route = read("app/api/catalogue/route.ts");
  for (const pattern of [/hitRateLimit\(RATE_RULES\.solarOrganization, organizationId\)/, /stock: \{\}, message: SOLAR_COMPANY_LIMIT_TEXT/, /found: false, message: SOLAR_COMPANY_LIMIT_TEXT/]) assert.match(route, pattern);
});

test("the AI limit per company: only without credits, settable per installation, and it never lets a wrong value through", async () => {
  assert.equal(aiCompanyRule(undefined)?.limit, RATE_RULES.aiOrganization.limit);
  assert.equal(aiCompanyRule("50")?.limit, 50);
  assert.equal(aiCompanyRule("0"), null, "0 turns it off");
  for (const bad of ["many", "-1", "1.5"]) assert.equal(aiCompanyRule(bad)?.limit, RATE_RULES.aiOrganization.limit, bad);
  assert.match(AI_COMPANY_LIMIT_REASON, /gränsen är nådd/);

  const saved = { limit: process.env.AI_COMPANY_CALLS_PER_HOUR, credits: process.env.CREDITS_ENABLED };
  try {
    process.env.AI_COMPANY_CALLS_PER_HOUR = "2";
    process.env.CREDITS_ENABLED = "false";
    assert.equal(await allowCompanyAiCall("company-a"), true);
    assert.equal(await allowCompanyAiCall("company-a"), true);
    assert.equal(await allowCompanyAiCall("company-a"), false, "the third call in the hour");
    assert.equal(await allowCompanyAiCall("company-b"), true, "another company has its own count");
    if (EE_PRESENT) {
      process.env.CREDITS_ENABLED = "true";
      counts.clear();
      for (let index = 0; index < 5; index += 1) assert.equal(await allowCompanyAiCall("company-a"), true, "with credits each company pays for its own use");
      assert.equal(counts.size, 0, "nothing is counted");
    }
  } finally {
    for (const [name, value] of [["AI_COMPANY_CALLS_PER_HOUR", saved.limit], ["CREDITS_ENABLED", saved.credits]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("every way to an AI model counts the company", () => {
  for (const file of ["lib/ai/agent-run.ts", "lib/api-handlers/ai-chat.ts", "lib/import/ai.ts"]) assert.match(read(file), /allowCompanyAiCall\(/, file);
});

test("the installers name the image after the folder, like the containers, so two installations never share a build", () => {
  // In the Community export the overlay's files lie at the root; here they lie in community/overlay.
  const overlay = (file: string) => read(existsSync(`community/overlay/${file}`) ? `community/overlay/${file}` : file);
  assert.match(overlay("install.ps1"), /SetValue \$lines "APP_IMAGE" "workflow-community-\$\(\$prefix\):local"/);
  assert.match(overlay("install.sh"), /set_value APP_IMAGE "workflow-community-\$prefix:local" \.env/);
  assert.match(overlay("docker-compose.yml"), /image: \$\{APP_IMAGE:-workflow-community:local\}/);
});

// Lösenordet vid installationen (2026-11-20): admin:create refuses a common password. The installers say the rule before
// the password is typed, ask again (at most three times) when admin:create refuses it, and a later run with .env in place
// but no account goes on to create the account instead of stopping.
test("the installers ask for a new password when admin:create refuses it, and a new run creates a missing account", () => {
  const overlay = (file: string) => read(existsSync(`community/overlay/${file}`) ? `community/overlay/${file}` : file);
  const admin = read("scripts/admin/create-admin.ts");
  assert.match(admin, /const EXIT_PASSWORD_REFUSED = 2;/);
  assert.match(admin, /const EXIT_HAS_ACCOUNTS = 3;/);
  assert.match(admin, /isCommonPassword\(password\)\) throw new ExitError\(COMMON_PASSWORD_REFUSAL, EXIT_PASSWORD_REFUSED\)/);
  assert.match(admin, /throw new ExitError\("Lösenordet måste ha minst 12 tecken\.", EXIT_PASSWORD_REFUSED\)/);
  assert.match(admin, /process\.env\.ADMIN_CREATE_CHECK === "1"/);
  assert.match(admin, /process\.exitCode = error instanceof ExitError \? error\.code : 1;/);
  const rule = "Lösenordet ska ha minst 12 tecken och får inte vara ett vanligt lösenord som Password1234.";
  const sh = overlay("install.sh");
  const ps = overlay("install.ps1");
  for (const [name, script] of [["install.sh", sh], ["install.ps1", ps]] as const) {
    assert.ok(script.includes(rule), `${name}: the rule before the password`);
    assert.match(script, /-e ADMIN_CREATE_CHECK=1 app npm run -s admin:create/, `${name}: checks for a missing account`);
    assert.ok(script.includes("Installationen har inget konto ännu, så det skapas nu."), name);
    assert.ok(script.includes("Kontot kunde inte skapas efter tre försök. Kör installationsraden igen och välj ett annat lösenord. Dina inställningar behålls."), name);
    assert.equal(script.includes('"Kontot kunde inte skapas."'), false, `${name}: the old dead end is gone`);
    // .env is still written only when it is missing, so a new run never replaces settings.
    assert.equal(script.match(/Behåller dina befintliga inställningar \(\.env\)/g)?.length, 1, name);
  }
  assert.match(sh, /for attempt in 1 2 3; do/);
  assert.match(sh, /if \(\( status == 0 \|\| status == 3 \)\); then created=true; break; fi/);
  assert.match(sh, /\(\( status == 2 \)\) \|\| fail /);
  assert.match(sh, /if ! \$new_install && docker compose exec -T -e ADMIN_CREATE_CHECK=1/);
  assert.match(ps, /for \(\$attempt = 1; \$attempt -le 3; \$attempt\+\+\)/);
  assert.match(ps, /if \(\$status -eq 0 -or \$status -eq 3\) \{ \$created = \$true; break \}/);
  assert.match(ps, /if \(\$status -ne 2\) \{/);
  assert.match(ps, /if \(-not \$newInstall -and \(Succeeds \{ docker compose exec -T -e ADMIN_CREATE_CHECK=1/);
  for (const file of ["INSTALLATION.md", "INSTALLATION.en.md"]) {
    const doc = overlay(file);
    assert.match(doc, /Password1234/, file);
    assert.match(doc, /(tre gånger|three times)/, file);
  }
});
