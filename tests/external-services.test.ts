// Externa tjänster (2026-10-25): the site map shows every program and service outside Workflow that the code talks
// to. The list is lib/integrations/external-services.ts (and the commercial part's in ee/); these tests keep it current – a
// new outside host in tests/local-sources.test.ts or a new central key without an entry fails here.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { EXTERNAL_PROVIDERS } from "../lib/integrations/key-catalog";
import { DIRECTION_LABELS, EXTERNAL_SERVICES, KEY_OWNERS, SERVICE_GROUPS, type ExternalService } from "../lib/integrations/external-services";
import { CENTRAL_FIELD_IDS, isCentralField, isCloudOnlyField } from "../lib/secrets/central-fields";
import type { SitemapData } from "../lib/sitemap/types";

const root = path.join(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const requireHere = createRequire(__filename);
// ee/ is absent in the core-only check and in the community edition.
const hasEe = existsSync(path.join(root, "ee", "server.ts"));
const eeServices: readonly ExternalService[] = hasEe && existsSync(path.join(root, "ee", "integrations", "external-services.ts"))
  ? (requireHere("../ee/integrations/external-services") as { EE_EXTERNAL_SERVICES: readonly ExternalService[] }).EE_EXTERNAL_SERVICES : [];
const all = [...EXTERNAL_SERVICES, ...eeServices];
const covers = (service: ExternalService, host: string) => (service.hosts ?? []).includes(host) || (service.hostEndings ?? []).some((end) => host.endsWith(end));

/** The hosts of a `const NAME = …` list in tests/local-sources.test.ts, each with the modules named on its line. */
function hostsIn(name: string) {
  const source = read("tests/local-sources.test.ts");
  const start = source.indexOf(`const ${name}`);
  assert.ok(start >= 0, `${name} is in tests/local-sources.test.ts`);
  const end = source.slice(start).search(/\n\]\)?;/);
  assert.ok(end > 0, `${name} ends`);
  const block = source.slice(start, start + end);
  const found: { host: string; modules: string[] }[] = [];
  for (const line of block.split(/\r?\n/)) {
    const modules = [...line.matchAll(/"((?:lib|ee|app|components|features)\/[^"]*)"/g)].map((m) => m[1]);
    for (const m of line.matchAll(/"([a-z0-9-]+(?:\.[a-z0-9-]+)+)"/g)) found.push({ host: m[1], modules });
  }
  return found;
}

test("every outside host the app may call has an entry on the map", () => {
  const serverOnly = hostsIn("SERVER_ONLY");
  assert.ok(serverOnly.length >= 10, "the hosts were read from tests/local-sources.test.ts");
  const missing = serverOnly
    // A host only ee/ talks to is in the commercial part's list, which the community edition does not have.
    .filter(({ modules }) => hasEe || !(modules.length && modules.every((file) => file.startsWith("ee/"))))
    .filter(({ host }) => !all.some((service) => covers(service, host)))
    .map(({ host }) => host);
  assert.deepEqual(missing, [], "add the service to lib/integrations/external-services.ts (or ee/integrations/external-services.ts)");
  // The allowed hosts are either a service or a plain link (shown as text, opened by the person).
  const LINKS = new Set(["app.hintekwork.com", "workflow.hintek.se", "github.com", "raw.githubusercontent.com", "www.facebook.com", "www.linkedin.com", "www.instagram.com", "fontawesome.com", "www.gnu.org", "chatgpt.com", "www.google.com", "maps.apple.com", "creativecommons.org", "www.paxml.se", "www.anmalarbetsskada.se", "www.elsakerhetsverket.se", "www.av.se",
    // The Meta card's guide links to Meta's developer site (2026-11-12); opened by the person in a new tab, never fetched.
    "developers.facebook.com",
    // WordPress's name for its REST link, read in a company site's answer (Min webbsida); never fetched.
    "api.w.org"]);
  const allowed = hostsIn("ALLOWED").map(({ host }) => host).filter((host) => !LINKS.has(host));
  assert.deepEqual(allowed.filter((host) => !all.some((service) => covers(service, host))), [], "a new allowed host is a service on the map or a link in LINKS");
});

test("every central key belongs to a service on the map", () => {
  const used = all.flatMap((service) => service.key.central ?? []);
  for (const field of used) assert.ok(isCentralField(field), `${field} is a central key`);
  // A key only the commercial part uses belongs to its list (ee/integrations/external-services.ts), absent in the community edition.
  assert.deepEqual(CENTRAL_FIELD_IDS.filter((field) => (hasEe || !isCloudOnlyField(field)) && !used.includes(field)), [], "add the key to its service in lib/integrations/external-services.ts");
  assert.equal(new Set(used).size, used.length, "a central key belongs to one service");
});

test("every host on the list is one the code names, and every module exists", () => {
  const walk = (dir: string): string[] => readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(root, rel)).isDirectory()) return name === "node_modules" || name === "tests" ? [] : walk(rel);
    return /\.(ts|tsx|cjs|mjs)$/.test(name) && !/external-services\.ts$/.test(name) ? [rel] : [];
  });
  const corpus = [...["lib", "app", "ee"].filter((dir) => existsSync(path.join(root, dir))).flatMap(walk).map(read), read("tests/local-sources.test.ts")].join("\n");
  for (const service of all) {
    for (const host of service.hosts ?? []) assert.ok(corpus.includes(host), `${service.id}: ${host} is named in the code`);
    for (const file of service.modules) {
      if (file.startsWith("ee/") && !hasEe) continue;
      assert.ok(existsSync(path.join(root, file)), `${service.id}: ${file} exists`);
    }
    for (const address of service.incoming ?? []) assert.match(address, /^\/api\//, `${service.id}: ${address} is one of Workflow's own addresses`);
    if (!service.hosts?.length) assert.ok(service.hostEndings?.length || service.via || service.direction === "in", `${service.id}: says how it is reached`);
  }
});

test("each entry says what it is for, which way it talks, whose key it uses and where it is administered", () => {
  const ids = all.map((service) => service.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  const providers = new Set<string>(EXTERNAL_PROVIDERS.map((provider) => provider.key));
  for (const service of all) {
    assert.ok(service.name && service.purpose, service.id);
    assert.ok(service.purpose.length <= 110 && !service.purpose.includes("\n"), `${service.id}: one short line`);
    assert.ok(Object.hasOwn(SERVICE_GROUPS, service.group), `${service.id}: known group`);
    assert.ok(Object.hasOwn(DIRECTION_LABELS, service.direction), `${service.id}: known direction`);
    assert.ok(Object.hasOwn(KEY_OWNERS, service.key.owner), `${service.id}: known key owner`);
    assert.ok(service.admin.length > 0, `${service.id}: administered somewhere`);
    for (const place of [...service.admin, ...(service.usedBy ?? [])]) assert.match(place.at, /^(\/\?view=[a-z_]+|\/[a-z/]+$|panel:ai$)/, `${service.id}: ${place.at}`);
    if (service.key.owner === "company") assert.ok(service.key.company && providers.has(service.key.company), `${service.id}: the company key's provider`);
    if (service.key.owner !== "central") assert.equal(service.key.central, undefined, `${service.id}: central keys only for a central key`);
  }
});

test("the site map draws every service, linked to the pages that administer it, and never a key value", () => {
  const generator = requireHere("../scripts/sitemap/generate.cjs") as { buildSitemap: (options?: { repo?: string; observed?: unknown }) => SitemapData };
  const data = generator.buildSitemap({ repo: root, observed: false });
  const drawn = data.nodes.filter((node) => node.kind === "service");
  const expected = all.filter((service) => !service.onlyWith || existsSync(path.join(root, service.onlyWith)));
  assert.deepEqual(drawn.map((node) => node.id.split("/").pop()).sort(), expected.map((service) => service.id).sort());
  for (const node of drawn) {
    assert.ok(node.service, node.id);
    assert.ok(data.edges.some((edge) => edge.to === node.id && edge.cat === "service-admin"), `${node.id}: a line from where it is administered`);
    assert.deepEqual(Object.keys(node.service).filter((key) => !["purpose", "direction", "directionLabel", "owner", "ownerLabel", "key", "fields", "company", "admin", "usedBy", "incoming", "hosts", "via", "modules"].includes(key)), [], `${node.id}: names only`);
  }
  assert.ok(data.serviceOwners?.length, "the legend for whose key it is");
  assert.equal(data.stats.services, drawn.length);
  // The entry is a root of its own, and the robot's marks never apply to it (it is no page).
  const entry = data.nodes.find((node) => node.id === "e:extern");
  assert.ok(entry && entry.level === 0 && entry.parent === null);
  // The AI providers are linked to the chat and the agents that use them.
  assert.ok(data.edges.some((edge) => edge.from === "x:ai" && edge.to === "t:ai/openai" && edge.cat === "service-use"));
  // Superadmin-only data, as the rest of the map (app/api/superadmin/sitemap).
  assert.match(read("app/api/superadmin/sitemap/route.ts"), /sitemapAccess\(/);
});

test("both maps show the services: the app's part and the stand-alone page", () => {
  const page = read("features/workflow/site-map.tsx");
  assert.match(page, /data\.serviceOwners/);
  assert.match(page, /ServiceRows/);
  const template = read("scripts/sitemap/template.html");
  assert.match(template, /id="services-legend"/);
  assert.match(template, /data-kind="service"/);
});
