// What an installation without the commercial part shows and refuses (2026-11-02): no payment rows, no key vault, a source
// link and a licence notice, and a limit per company where companies share the installation's keys.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
  assert.match(sh, /if ! \$new_install && docker compose exec -T --user node -e ADMIN_CREATE_CHECK=1/);
  assert.match(ps, /for \(\$attempt = 1; \$attempt -le 3; \$attempt\+\+\)/);
  assert.match(ps, /if \(\$status -eq 0 -or \$status -eq 3\) \{ \$created = \$true; break \}/);
  assert.match(ps, /if \(\$status -ne 2\) \{/);
  assert.match(ps, /if \(-not \$newInstall -and \(Succeeds \{ docker compose exec -T --user node -e ADMIN_CREATE_CHECK=1/);
  for (const file of ["INSTALLATION.md", "INSTALLATION.en.md"]) {
    const doc = overlay(file);
    assert.match(doc, /Password1234/, file);
    assert.match(doc, /(tre gånger|three times)/, file);
  }
});

// Uppdatering med backup och version (granskningen P6, 2026-11-24): the installers follow the newest release tag, not main;
// an update builds the new version first, then stops the app, takes a backup that is read back (the database restored into
// a temporary database, the file archive listed), and only then starts the new version, which migrates. A failed backup
// starts the old version again. The admin commands run as "node", and npm's update check is off.
test("the installers follow a release tag and take a backup that is read back before the database changes", () => {
  const overlay = (file: string) => read(existsSync(`community/overlay/${file}`) ? `community/overlay/${file}` : file);
  const sh = overlay("install.sh");
  const ps = overlay("install.ps1");
  for (const [name, script] of [["install.sh", sh], ["install.ps1", ps]] as const) {
    assert.match(script, /git ls-remote --tags --refs/, `${name}: finds the newest release tag`);
    assert.match(script, /WORKFLOW_VERSION/, `${name}: a version can be chosen`);
    assert.match(script, /clone --depth 1 --branch/, `${name}: a new installation is the tag`);
    assert.match(script, /fetch --force origin "refs\/tags\//, `${name}: an update fetches the tag`);
    assert.match(script, /pg_restore -U [^\n]*POSTGRES_USER"? -d "?`?\$check"? --no-owner --no-privileges --exit-on-error/, `${name}: the dump is restored into a temporary database`);
    assert.match(script, /tar -tzf \/backup\/storage\.tar\.gz/, `${name}: the file archive is listed back`);
    assert.match(script, /BACKUP_AGE_RECIPIENT/, `${name}: optional age encryption`);
    assert.match(script, /NPM_CONFIG_UPDATE_NOTIFIER/, `${name}: npm's update check is off`);
  }
  // The order: build while the old version runs, stop, backup, then start (and migrate).
  const order = (script: string, markers: string[]) => {
    let at = 0;
    for (const marker of markers) {
      const next = script.indexOf(marker, at);
      assert.ok(next >= at, `${marker} in order`);
      at = next;
    }
  };
  order(sh.slice(sh.indexOf("if $updating; then")), ["docker compose build app", "docker compose stop app", "backup_before_update", "docker compose start app", "docker compose up -d ||"]);
  order(ps.slice(ps.indexOf("if ($updating) {")), ["docker compose build app", "docker compose stop app", "BackupBeforeUpdate", "docker compose start app", "docker compose up -d }"]);
  for (const file of ["INSTALLATION.md", "INSTALLATION.en.md"]) {
    const doc = overlay(file);
    assert.doesNotMatch(doc, /(bara med tillägg|only ever gets additions)/, `${file}: the database is not only ever added to`);
    assert.match(doc, /pg_restore [^\n]*--single-transaction --exit-on-error/, `${file}: how to restore`);
    assert.match(doc, /dropdb -U "\$POSTGRES_USER" --force/, `${file}: the restore starts from an empty database`);
    assert.match(doc, /BACKUP_AGE_RECIPIENT=age1/, `${file}: encryption is offered`);
  }
  assert.match(overlay("docker-compose.yml"), /image: postgres:16-alpine@sha256:[0-9a-f]{64}/, "the database image is locked to a digest");
});

// K1.6 (2026-11-28): the backups are always encrypted. The installers need age and a recipient, or make a key pair in
// backup-key/ and say where the private key is; the plain files never stay; the nightly backup refuses to run unencrypted;
// the restore drill (published) writes the same protocol for Community.
test("Community backups are always encrypted, and the restore drill is published", () => {
  const overlay = (file: string) => read(existsSync(`community/overlay/${file}`) ? `community/overlay/${file}` : file);
  const sh = overlay("install.sh");
  const ps = overlay("install.ps1");
  assert.match(sh, /ensure_backup_encryption\(\) \{/);
  assert.match(sh, /age-keygen -o "\$key"/);
  assert.match(sh, /set_value BACKUP_AGE_RECIPIENT "\$recipient" "\$DIR\/\.env"/);
  assert.ok(sh.indexOf("\nensure_backup_encryption\n") > 0 && sh.indexOf("\nensure_backup_encryption\n") < sh.indexOf("if $updating; then"), "checked before the update's backup");
  assert.match(ps, /function EnsureBackupEncryption \{/);
  assert.match(ps, /age-keygen -o \$key/);
  const psCall = ps.replace(/\r/g, "").indexOf("\nEnsureBackupEncryption\n");
  assert.ok(psCall > 0 && psCall < ps.replace(/\r/g, "").indexOf("if ($updating) {"), "checked before the update's backup");
  for (const [name, script] of [["install.sh", sh], ["install.ps1", ps]] as const) {
    assert.doesNotMatch(script, /OKRYPTERAD/, `${name}: never an unencrypted backup`);
    assert.match(script, /SHA256SUMS\.plain/, `${name}: the plain sums are kept for after decrypting`);
    assert.match(script, /workflow-update\.rows/, `${name}: rows per table for the drill`);
    assert.match(script, /backup-key/, `${name}: the generated key's place is told`);
  }
  const nightly = read("scripts/ops/nightly-backup.sh");
  assert.match(nightly, /else fail "The backup is always encrypted/);
  assert.match(nightly, /sed -n 's\/\^BACKUP_AGE_RECIPIENT=\/\/p' \.\/\.env/);
  const drill = read("scripts/ops/aterstallningsovning.sh");
  for (const part of ["--key", "--internal", "rows-archive.tsv", "ROWS", "SHA256SUMS.plain", "/api/health/ready", "aterstallning-$(date +%Y-%m-%d).md", "**Resultat: godkänd.**"])
    assert.ok(drill.includes(part), part);
  // The operator's own names are built here so that this published test names none of them itself.
  for (const name of [["hintek", "db"].join("-"), ["backups", "lokalt"].join("-"), ["HINTEK", "drift"].join("-")])
    assert.ok(!drill.includes(name), "no names of the operator's own servers or folders");
  for (const file of ["INSTALLATION.md", "INSTALLATION.en.md"]) {
    const doc = overlay(file);
    assert.match(doc, /scripts\/ops\/aterstallningsovning\.sh/, file);
    assert.match(doc, /allowed_signers/, `${file}: how to check the signed tag`);
    assert.match(doc, /verify-tag v1\.2\.3/, file);
  }
});

// GnuPG as a second choice (2026-11-28): age stays the default and nothing more is asked; --encryption gpg (or
// WORKFLOW_BACKUP_ENCRYPTION=gpg) makes an RSA 4096 key without expiry in a GNUPGHOME of its own and encrypts with AES-256;
// the files end in .gpg, and the nightly backup and the restore drill follow BACKUP_ENCRYPTION.
const overlayFile = (file: string) => read(existsSync(`community/overlay/${file}`) ? `community/overlay/${file}` : file);
const overlayPath = (file: string) => (existsSync(`community/overlay/${file}`) ? `community/overlay/${file}` : file);
const bash = process.platform === "win32"
  ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files (x86)\\Git\\bin\\bash.exe"].find((file) => existsSync(file))
  : ["/bin/bash", "/usr/bin/bash"].find((file) => existsSync(file));
const slash = (file: string) => file.replaceAll("\\", "/");
const bashRun = (script: string, env: Record<string, string> = {}) =>
  spawnSync(bash!, ["-c", script], { encoding: "utf8", timeout: 180_000, env: { ...process.env, MSYS_NO_PATHCONV: "1", ...env } });
const hasGpg = !!bash && bashRun("command -v gpg >/dev/null && command -v gpgconf >/dev/null").status === 0;

test("GnuPG is a second choice for the backups: asked for only with the choice, AES-256 and RSA 4096, age unchanged", () => {
  const sh = overlayFile("install.sh");
  const ps = overlayFile("install.ps1");
  const nightly = read("scripts/ops/nightly-backup.sh");
  const drill = read("scripts/ops/aterstallningsovning.sh");
  // The choice: a switch or an environment variable, kept in .env; age when nothing is said.
  assert.match(sh, /--encryption\) ENCRYPTION_CHOICE="\$\{2:-\}"/);
  assert.match(sh, /ENCRYPTION_CHOICE="\$\{WORKFLOW_BACKUP_ENCRYPTION:-\}"/);
  assert.match(sh, /encryption="\$\{encryption:-age\}"/, "install.sh: age is the default");
  assert.match(sh, /if \[\[ "\$encryption" == gpg \]\]; then ensure_gpg_encryption; else ensure_age_encryption; fi/);
  assert.match(ps, /^param\(\[string\]\$Encryption = ""\)$/m);
  assert.match(ps, /\$env:WORKFLOW_BACKUP_ENCRYPTION/);
  assert.match(ps, /if \(\$choice -eq "gpg"\) \{ EnsureGpgEncryption \} else \{ EnsureAgeEncryption \}/);
  assert.match(nightly, /readonly BACKUP_ENCRYPTION="\$\{BACKUP_ENCRYPTION:-age\}"/, "nightly-backup.sh: age is the default");
  // gpg is looked for only on the gpg path, with an install hint for each system.
  const gpgPart = sh.slice(sh.indexOf("ensure_gpg_encryption() {"), sh.indexOf("ensure_age_encryption() {"));
  assert.equal(sh.split("command -v gpg ").length - 1, 1, "install.sh checks for gpg once");
  assert.ok(gpgPart.includes("command -v gpg "), "and only in ensure_gpg_encryption");
  assert.ok(ps.slice(ps.indexOf("function EnsureGpgEncryption {"), ps.indexOf("function EnsureAgeEncryption {")).includes("Get-Command gpg "), "install.ps1 checks for gpg.exe only there");
  assert.equal(ps.split("Get-Command gpg ").length - 1, 1);
  for (const hint of ["sudo apt install gnupg", "brew install gnupg"]) assert.ok(sh.includes(hint), hint);
  assert.ok(ps.includes("winget install GnuPG.Gpg4win"));
  // The key: RSA 4096 with an RSA 4096 subkey for encryption, no expiry, made with --batch; the private key beside the age key.
  for (const [name, script] of [["install.sh", sh], ["install.ps1", ps]] as const) {
    for (const line of ["Key-Type: RSA", "Key-Length: 4096", "Subkey-Length: 4096", "Subkey-Usage: encrypt", "Expire-Date: 0", "%no-protection"])
      assert.ok(script.includes(line), `${name}: ${line}`);
    assert.match(script, /--batch --gen-key/, `${name}: made without questions`);
    assert.ok(script.includes("workflow-backup.gpgkey") && script.includes("workflow-backup.pub.asc"), `${name}: the key files`);
    assert.match(script, /ingen utgångstid/, `${name}: the yellow lines say the key does not expire`);
  }
  // The key is made in a GNUPGHOME of its own that is removed again (install.sh: a short mktemp path, for the agent's socket).
  assert.match(sh, /home="\$\(mktemp -d\)\/gnupg"/);
  assert.match(sh, /--kill all >\/dev\/null 2>&1 \|\| true; rm -rf -- "\$\{home%\/gnupg\}"$/m);
  assert.match(ps, /\$gpgHome = Join-Path \$keyDir "gnupg-tmp"[\s\S]*finally \{ GpgStop \$gpgHome \}/);
  // The encryption: AES-256 to the public key file, no compression, in a GNUPGHOME of its own; never a passphrase.
  for (const [name, script] of [["install.sh", sh], ["install.ps1", ps], ["nightly-backup.sh", nightly]] as const) {
    assert.match(script, /--batch --yes --no-tty --trust-model always --cipher-algo AES256 --compress-algo none\s*\\?\s*--recipient-file/, `${name}: the gpg command`);
    assert.doesNotMatch(script, /--passphrase/, `${name}: no passphrase on the command line`);
  }
  assert.doesNotMatch(drill, /--passphrase/);
  // The file ending follows the program, in the sums and the MANIFEST too.
  assert.match(sh, /"\$target\/\$file\.\$encryption"/);
  assert.match(sh, /encrypted=%s\\n' [^\n]*"\$encryption"/);
  assert.match(ps, /"database\.dump\.\$encryption", "storage\.tar\.gz\.\$encryption"/);
  assert.match(nightly, /"\$\{TARGET\}\/\$\{file\}\.\$\{ENCRYPTED\}"/);
  assert.match(nightly, /sha256sum "database\.dump\.\$\{ENCRYPTED\}" "storage\.tar\.gz\.\$\{ENCRYPTED\}" > SHA256SUMS/);
  // age stays as it was: the same command and the same refusal without a recipient.
  assert.match(nightly, /age "\$\{AGE_ARGS\[@\]\}" -o "\$2" "\$1"/);
  assert.match(sh, /age -r "\$2" -o "\$4" "\$3"/);
  // The restore drill knows .gpg, and the private key goes into a temporary GNUPGHOME that is overwritten and removed.
  assert.match(drill, /encrypted\(\) \{ \[\[ "\$1" == \*\.age \|\| "\$1" == \*\.gpg \]\]; \}/);
  assert.ok(drill.includes("-name 'database.dump.gpg'") && drill.includes("storage.tar.gz.gpg"));
  assert.match(drill, /gpg_home_remove\(\) \{[\s\S]*--kill all[\s\S]*wipe "\$file"[\s\S]*rm -rf -- "\$GPG_HOME"/);
  // The documents and the example settings.
  assert.match(overlayFile(".env.example"), /^BACKUP_ENCRYPTION=age$/m);
  for (const [file, heading] of [["INSTALLATION.md", "### Kryptering av säkerhetskopiorna"], ["INSTALLATION.en.md", "### Encryption of the backups"]] as const) {
    const doc = overlayFile(file);
    assert.ok(doc.includes(heading), `${file}: ${heading}`);
    for (const part of ["X25519", "ChaCha20-Poly1305", "RFC 9580", "AES-256", "RSA", "4096", "BSI", "NIST", "GPLv3", "BSD", "--encryption gpg", "WORKFLOW_BACKUP_ENCRYPTION", "database.dump.gpg", "gpg --import workflow-backup.gpgkey"])
      assert.ok(doc.includes(part), `${file}: ${part}`);
    assert.match(doc, /\| age (eller|or) GnuPG \|/, `${file}: the requirements say age or GnuPG`);
  }
  const security = overlayFile("SECURITY.md");
  for (const part of ["X25519", "ChaCha20-Poly1305", "RFC 9580", "AES-256", "RSA 4096"]) assert.ok(security.includes(part), `SECURITY.md: ${part}`);
  assert.match(read(".dockerignore"), /^backup-key$/m, "the backups' private key never goes into the image");
});

test("the restore drill's dry run picks a .gpg backup and names gpg, and an .age backup still names age", { skip: !bash && "needs bash" }, () => {
  const base = mkdtempSync(path.join(tmpdir(), "wf-drill-"));
  try {
    for (const [kind, stamp] of [["gpg", "20261128T010000Z"], ["age", "20261127T010000Z"]] as const) {
      const root = path.join(base, kind);
      const folder = path.join(root, `update-${stamp}`);
      mkdirSync(folder, { recursive: true });
      for (const file of [`database.dump.${kind}`, `storage.tar.gz.${kind}`]) writeFileSync(path.join(folder, file), "x");
      writeFileSync(path.join(folder, "SHA256SUMS"), "");
      const run = spawnSync(bash!, [slash(path.resolve("scripts/ops/aterstallningsovning.sh")), "--backup-dir", slash(root), "--no-app"], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1", AGE_KEY: "" } });
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, new RegExp(`Databas: [^\\n]*database\\.dump\\.${kind} [^\\n]*krypterad`), `${kind}: the encrypted database backup is chosen`);
      assert.match(run.stdout, new RegExp(`Filer: +[^\\n]*storage\\.tar\\.gz\\.${kind} `), `${kind}: the file backup beside it`);
      assert.match(run.stdout, new RegExp(`^${kind}: `, "m"), `${kind}: the program it needs`);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// A real round trip, only where GnuPG is installed (no network, no Docker): the installer's key, the nightly backup's
// encryption and the restore drill's decryption, each taken from its own script.
test("GnuPG round trip: the installer's key, the nightly backup's encryption, the drill's decryption", { skip: !hasGpg && "gpg (and bash) not installed here" }, () => {
  const base = mkdtempSync(path.join(tmpdir(), "wf-gpg-"));
  try {
    const script = `
set -euo pipefail
T="$1"; command -v cygpath >/dev/null 2>&1 && T="$(cygpath -u "$T")"
fn() { sed -n "/^$2() {/,/^}/p" "$1"; }
eval "$(fn "$INSTALL_SH" gpg_make_key)"; eval "$(fn "$INSTALL_SH" gpg_key_problem)"
eval "$(fn scripts/ops/nightly-backup.sh gpg_encrypt_file)"
eval "$(fn scripts/ops/aterstallningsovning.sh gpg_decrypt)"
say() { printf '%s\\n' "$*"; }; gpgpath() { printf '%s' "$1"; }; GPG="$(command -v gpg)"; GPG_HOME=""
gpg_make_key "$T/home" "$T/workflow-backup.gpgkey" "$T/workflow-backup.pub.asc"
gpgconf --homedir "$T/home" --kill all >/dev/null 2>&1 || true; rm -rf "$T/home"
echo "public: [$(gpg_key_problem "$T/workflow-backup.pub.asc")]"
echo "private: [$(gpg_key_problem "$T/workflow-backup.gpgkey")]"
head -c 70000 /dev/urandom > "$T/database.dump"
gpg_encrypt_file "$T/workflow-backup.pub.asc" "$T/database.dump" "$T/database.dump.gpg"
gpg_decrypt "$T/workflow-backup.gpgkey" "$T/database.dump.gpg" "$T/back.dump"
cmp "$T/database.dump" "$T/back.dump" && echo same
gpg --homedir "$GPG_HOME" --batch --with-colons --list-keys 2>/dev/null | grep -E '^(pub|sub):'
gpg --homedir "$GPG_HOME" --batch --list-packets "$T/database.dump.gpg" 2>&1 | grep -E 'pubkey enc packet|encrypted data packet|mdc_method' || true
gpg --homedir "$GPG_HOME" --batch -v -o "$T/again.dump" --decrypt "$T/database.dump.gpg" 2>&1 | grep -E 'AES256' || true
gpgconf --homedir "$GPG_HOME" --kill all >/dev/null 2>&1 || true; rm -rf "$GPG_HOME"
`;
    const run = spawnSync(bash!, ["-c", script, "roundtrip", slash(base)], {
      encoding: "utf8", timeout: 180_000, env: { ...process.env, MSYS_NO_PATHCONV: "1", INSTALL_SH: overlayPath("install.sh") },
    });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /^public: \[\]$/m, "the public key is accepted");
    assert.match(run.stdout, /^private: \[filen innehåller en privat nyckel/m, "a private key is refused as the recipient");
    assert.match(run.stdout, /^same$/m, "decrypted to the same bytes");
    assert.match(run.stdout, /^pub:[^:]*:4096:1:[^\n]*:::[^:]*:::c/m, "an RSA 4096 primary key");
    assert.match(run.stdout, /^sub:[^:]*:4096:1:[^\n]*::::::e:/m, "an RSA 4096 subkey for encryption");
    assert.match(run.stdout, /^pub:[^:]*:4096:1:[^:]*:[^:]*::/m, "no expiry date");
    assert.match(run.stdout, /pubkey enc packet: version 3, algo 1/, "encrypted to RSA");
    assert.match(run.stdout, /AES256/, "the data is AES-256");
    assert.match(run.stdout, /mdc_method: 2/, "and integrity protected (SEIPD with SHA-1 MDC, readable by every OpenPGP program)");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
