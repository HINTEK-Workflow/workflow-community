import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";

// Företagets nycklar som fil (2026-11-26): the company admin's own keys as a password-protected file, and back again.
// Synthetic values only – nothing here is a real key. The environment is set before the app's modules are imported.
process.env.AUTH_SECRET = "the-session-secret-for-the-key-file-test-0000";
process.env.INTEGRATION_KEYS_SECRET = "the-sealing-secret-for-the-key-file-test-1111";

import * as crypto from "../lib/secrets/password-file-crypto";
import * as file from "../lib/secrets/company-key-file";

const subtle = webcrypto.subtle;
const utf8 = new TextEncoder();
const b64 = (text: string) => Uint8Array.from(Buffer.from(text, "base64"));

/**
 * How the receiving password manager opens the file, written from its public algorithm with WebCrypto only – not with
 * Workflow's code: PBKDF2-SHA256 over the password with the salt TEXT as UTF-8 bytes, HKDF-Expand "enc" and "mac", then each
 * EncString "2.iv|data|mac" with HMAC-SHA256 over iv||data checked before AES-256-CBC. Throws on a wrong password or a change.
 */
async function recipientOpen(sealed: { salt: string; kdfType: number; kdfIterations: number; encKeyValidation_DO_NOT_EDIT: string; data: string }, password: string) {
  assert.equal(sealed.kdfType, 0, "PBKDF2");
  const base = await subtle.importKey("raw", utf8.encode(password), "PBKDF2", false, ["deriveBits"]);
  const master = await subtle.deriveBits({ name: "PBKDF2", salt: utf8.encode(sealed.salt), iterations: sealed.kdfIterations, hash: "SHA-256" }, base, 256);
  const prk = await subtle.importKey("raw", master, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expand = async (info: string) => new Uint8Array(await subtle.sign("HMAC", prk, new Uint8Array([...utf8.encode(info), 1])));
  const enc = await subtle.importKey("raw", await expand("enc"), "AES-CBC", false, ["decrypt"]);
  const mac = await subtle.importKey("raw", await expand("mac"), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const decrypt = async (encString: string) => {
    const [type, rest] = [encString.slice(0, 2), encString.slice(2)];
    assert.equal(type, "2.", "EncString type 2");
    const [iv, data, tag] = rest.split("|").map(b64);
    if (!(await subtle.verify("HMAC", mac, tag, new Uint8Array([...iv, ...data])))) throw new Error("MAC");
    return new TextDecoder().decode(await subtle.decrypt({ name: "AES-CBC", iv }, enc, data));
  };
  await decrypt(sealed.encKeyValidation_DO_NOT_EDIT);
  return JSON.parse(await decrypt(sealed.data)) as unknown;
}

const ENTRIES: import("../lib/secrets/company-key-file").CompanyKeyEntry[] = [
  { kind: "external", id: "workflow-company:external:k1", label: "Fortnox – Bokföring", provider: "fortnox", name: "Bokföring", value: "syntetisk-fortnox-0001", expiresOn: "2027-03-31" },
  { kind: "website", id: "workflow-company:website", label: file.LABELS.website, siteUrl: "https://example.test/", baseUrl: "https://example.test/wp-json/", username: "redaktor", password: "syntetisk-wp-0001-abcdefghij" },
  { kind: "meta", id: "workflow-company:meta", label: file.LABELS.meta, appId: "1234567890", appSecret: "syntetisk-meta-0001" },
  { kind: "linkedin", id: "workflow-company:linkedin", label: file.LABELS.linkedin, clientId: "linkedinklient", clientSecret: "syntetisk-linkedin-0001", scopeSet: "organization" },
  { kind: "youtube", id: "workflow-company:youtube", label: file.LABELS.youtube, clientId: "123-abc.apps.googleusercontent.com", clientSecret: "syntetisk-youtube-0001" },
];
const BINDING = { organizationId: "org-a", organizationNumber: "556000-0000", company: "Elfirman AB" };
const VALUES = ENTRIES.flatMap(file.secretsOf);

test("the password-protected file: the recipient's own algorithm opens it, with exactly the company's keys", async () => {
  const { file: content, entries, keys } = file.companyKeyFile(ENTRIES, BINDING);
  assert.deepEqual([entries, keys], [5, 5]);
  const passphrase = crypto.newExportPassphrase();
  assert.match(passphrase, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/, "six groups of Crockford base32");
  const sealed = await crypto.sealPasswordFile(content, passphrase);
  const text = crypto.passwordFileText(sealed);
  assert.deepEqual(Object.keys(sealed), ["encrypted", "passwordProtected", "salt", "kdfType", "kdfIterations", "encKeyValidation_DO_NOT_EDIT", "data"], "the format's fields, in its order");
  assert.equal(sealed.encrypted, true);
  assert.equal(sealed.passwordProtected, true);
  assert.equal(sealed.kdfIterations, 600_000);
  assert.equal(b64(sealed.salt).length, 16, "16 random bytes as base64");
  assert.equal(VALUES.some((value) => text.includes(value)) || text.includes(passphrase), false, "no value and no passphrase in the file");
  const opened = await recipientOpen(sealed, passphrase) as import("../lib/secrets/company-key-file").CompanyKeyFile;
  assert.equal(opened.encrypted, false, "the content is the unencrypted export the importer reads");
  assert.deepEqual(opened.folders, [{ id: "workflow-company", name: "Workflow – företagets kopplingar" }]);
  assert.deepEqual(opened.items.map((item) => item.id), ENTRIES.map((entry) => entry.id), "fixed ids");
  for (const item of opened.items) { assert.equal(item.type, 1, "a login"); assert.equal(item.folderId, "workflow-company"); }
  assert.equal(opened.items[0].login.password, "syntetisk-fortnox-0001");
  assert.equal(opened.items[2].login.username, "1234567890");
  assert.deepEqual(opened.workflow, { format: "workflow-keys", version: 1, ...BINDING });
  await assert.rejects(recipientOpen(sealed, "FEL0-FEL0-FEL0-FEL0-FEL0-FEL0"), "a wrong password opens nothing for the recipient either");
});

test("reading the file back: the same keys; small letters and no dashes work; wrong, changed and foreign files are refused", async () => {
  const passphrase = crypto.newExportPassphrase();
  const text = crypto.passwordFileText(await crypto.sealPasswordFile(file.companyKeyFile(ENTRIES, BINDING).file, passphrase));
  const plain = await crypto.openPasswordFile(text, passphrase.toLowerCase().replace(/-/g, ""));
  const parsed = file.parseKeyFile(plain)!;
  assert.ok(parsed, "the strict schema reads Workflow's own file");
  const back = file.companyEntriesFromItems(parsed.items);
  assert.deepEqual(back.skipped, []);
  assert.deepEqual(back.entries, ENTRIES, "every key back exactly");

  const wrong = await crypto.openPasswordFile(text, "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF").catch((error: unknown) => error);
  assert.ok(wrong instanceof crypto.PasswordFileError && wrong.reason === "password", "a wrong passphrase");
  assert.equal(String((wrong as Error).message).includes("AAAA"), false, "the refusal never repeats what was typed");

  // A changed byte of the data (the MAC no longer matches): refused, nothing decrypted.
  const sealed = JSON.parse(text);
  const [head, data, mac] = sealed.data.slice(2).split("|");
  const flipped = Buffer.from(data, "base64"); flipped[0] ^= 1;
  const tampered = JSON.stringify({ ...sealed, data: `2.${head}|${flipped.toString("base64")}|${mac}` });
  const changed = await crypto.openPasswordFile(tampered, passphrase).catch((error: unknown) => error);
  assert.ok(changed instanceof crypto.PasswordFileError && changed.reason === "password", "a changed file opens nothing");
  // A lower iteration count gives another key: refused; too low a count is no such file at all.
  const fewer = await crypto.openPasswordFile(JSON.stringify({ ...sealed, kdfIterations: 500_000 }), passphrase).catch((error: unknown) => error);
  assert.ok(fewer instanceof crypto.PasswordFileError && fewer.reason === "password");
  const weak = await crypto.openPasswordFile(JSON.stringify({ ...sealed, kdfIterations: 5000 }), passphrase).catch((error: unknown) => error);
  assert.ok(weak instanceof crypto.PasswordFileError && weak.reason === "format");
  for (const junk of ["", "{}", "inte json", JSON.stringify({ ...sealed, extra: 1 }), "x".repeat(crypto.PASSWORD_FILE_MAX_BYTES + 1)]) {
    const refused = await crypto.openPasswordFile(junk, passphrase).catch((error: unknown) => error);
    assert.ok(refused instanceof crypto.PasswordFileError && refused.reason === "format", "not such a file");
  }
  // Decrypted content that is not a key file is refused by the schema (never read in half).
  assert.equal(file.parseKeyFile(JSON.stringify({ encrypted: false, items: "x" })), null);
  assert.equal(file.parseKeyFile(JSON.stringify({ encrypted: false, items: Array.from({ length: 301 }, () => ({})) })), null, "a ceiling of items");
  assert.equal(file.parseKeyFile(JSON.stringify({ encrypted: false, items: [{ id: "workflow-company:meta", login: { password: "x".repeat(4001) } }] })), null, "a ceiling per value");
});

test("only Workflow's own items are read in; the rest is listed as skipped with the reason", () => {
  const items = [
    ...file.companyKeyItems(ENTRIES.slice(0, 1), "f"),
    { id: "workflow-company:external:zz", name: "Okänd", login: { password: "syntetisk-x" }, fields: [{ name: "Workflow-tjänst", value: "nagot-annat" }] },
    { id: "workflow-company:meta", name: "Meta utan id", login: { password: "syntetisk-y", username: "" } },
    { id: "workflow:openai", name: "En central nyckel", login: { password: "syntetisk-z" } },
    { id: "nagon-annans", name: "Privat lösenord", login: { password: "syntetisk-w" } },
  ];
  const { entries, skipped } = file.companyEntriesFromItems(items);
  assert.deepEqual(entries.map((entry) => entry.id), ["workflow-company:external:k1"]);
  assert.deepEqual(skipped.map((item) => item.reason), ["Okänd tjänst.", "Appens id saknas i filen."]);
  assert.equal(JSON.stringify(skipped).includes("syntetisk"), false, "a skipped item never carries its value");
});

test("the preview compares by place, never by value in the answer; another company is told apart by its organisation number", () => {
  const states = file.previewStates(ENTRIES, [{ ...ENTRIES[0], id: "workflow-company:external:other-row" }, { ...(ENTRIES[2] as Extract<file.CompanyKeyEntry, { kind: "meta" }>), appSecret: "syntetisk-meta-0002" }]);
  assert.deepEqual(states.map((state) => state.state), ["same", "new", "changed", "new", "new"]);
  assert.equal(JSON.stringify(states).includes("syntetisk"), false);
  const binding = { format: "workflow-keys", version: 1, ...BINDING } as const;
  assert.equal(file.companyMatch(binding, { id: "org-new-installation", organizationNumber: "5560000000" }), "same", "the same company in a new installation");
  assert.equal(file.companyMatch(binding, { id: "org-a", organizationNumber: "559999-9999" }), "other", "another organisation number");
  assert.equal(file.companyMatch({ ...binding, organizationNumber: "" }, { id: "org-b", organizationNumber: "" }), "other", "no number: the id decides");
  assert.equal(file.companyMatch(undefined, { id: "org-a", organizationNumber: "" }), "unknown");
});

test("who: the company's own admin only – never an employee, an API or MCP key, or a superadmin in a customer's company", async () => {
  const { companyKeyFileRefusal } = await import("../lib/api-handlers/company-key-file");
  const customer = { name: "Elfirman AB", slug: "company-abc123", domain: null };
  const base = { user: { id: "u", role: "USER", email: "admin@example.test" }, organization: customer, integration: null, admin: true } as never as Parameters<typeof companyKeyFileRefusal>[0];
  assert.equal(companyKeyFileRefusal(base), null, "OWNER or ADMIN of the company");
  assert.match(companyKeyFileRefusal({ ...base, admin: false })!, /administratör/, "an employee");
  assert.match(companyKeyFileRefusal({ ...base, integration: { keyId: "k" } } as never)!, /API- eller MCP-nyckel/, "an API or MCP key");
  assert.match(companyKeyFileRefusal({ ...base, user: { ...base.user, role: "SUPERADMIN" } })!, /aldrig ett kundföretags/, "a superadmin in a customer's company");
});

test("two companies: the export reads only the active company's rows, and another company's value never opens", async () => {
  const { sealCompanyKey } = await import("../lib/integrations/company-keys");
  const { companyKeySource } = await import("../lib/secrets/company-key-source");
  // A stand-in database with two companies, which records every query's company.
  const asked: string[] = [];
  const rows = { dataKeys: [] as { id: string; organizationId: string; wrappedKey: string; retiredAt: null }[], keys: [] as Record<string, unknown>[] };
  const match = (row: Record<string, unknown>, where: Record<string, unknown>) => Object.entries(where).every(([name, wanted]) =>
    wanted && typeof wanted === "object" && "not" in (wanted as object) ? row[name] !== null && row[name] !== undefined : row[name] === wanted);
  const note = (where: Record<string, unknown>) => { asked.push(String(where.organizationId ?? where.id)); return where; };
  const db = {
    organization: { findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({ id: note(where).id, name: where.id === "org-a" ? "Elfirman AB" : "Annan AB" }) },
    workspaceSettings: { findUnique: async ({ where }: { where: Record<string, unknown> }) => (note(where), null) },
    organizationDataKey: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => rows.dataKeys.find((row) => match(row, note(where))) ?? null,
      create: async ({ data }: { data: { organizationId: string; wrappedKey: string } }) => { const row = { id: `dk-${rows.dataKeys.length}`, retiredAt: null, ...data }; rows.dataKeys.push(row); return row; },
    },
    integrationKey: { findMany: async ({ where }: { where: Record<string, unknown> }) => rows.keys.filter((row) => match(row, note(where))) },
    websiteConnection: { findUnique: async ({ where }: { where: Record<string, unknown> }) => (note(where), null) },
    metaConnection: { findUnique: async ({ where }: { where: Record<string, unknown> }) => (note(where), null) },
    linkedInConnection: { findUnique: async ({ where }: { where: Record<string, unknown> }) => (note(where), null) },
    youTubeConnection: { findUnique: async ({ where }: { where: Record<string, unknown> }) => (note(where), null) },
  } as never;
  const key = async (id: string, organizationId: string, value: string, sealedFor = organizationId) =>
    rows.keys.push({ id, organizationId, kind: "EXTERNAL", name: "Bokföring", provider: "fortnox", revokedAt: null, expiresAt: null, encryptedValue: await sealCompanyKey(sealedFor, id, value, db) });
  await key("a1", "org-a", "syntetisk-a-0001");
  await key("b1", "org-b", "syntetisk-b-0001");
  // Company B's value copied onto a row of company A: it does not open in A (bound to B's data key and to B).
  rows.keys.push({ ...rows.keys[1], id: "a2", organizationId: "org-a" });
  asked.length = 0;
  const source = await companyKeySource("org-a", db);
  assert.deepEqual(source.entries.map((entry) => entry.id), ["workflow-company:external:a1"]);
  assert.equal(JSON.stringify(source).includes("syntetisk-b"), false, "never the other company's value");
  assert.equal(source.unreadable, 1, "the copied value is counted as unreadable, never opened");
  assert.deepEqual([...new Set(asked)], ["org-a"], "every query names company A only");
});
