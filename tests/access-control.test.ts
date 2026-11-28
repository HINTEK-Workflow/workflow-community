import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { csvCell } from "@/lib/csv/cell";
import {
  accessReviewCsv, accessReviewDue, accessReviewDueAt, isSupportAccessHours, isSupportPart, machinePartAllowed, openSupportGrant, permissionSummary,
  SUPPORT_ACCESS_DEFAULT_HOURS, SUPPORT_ACCESS_HOURS, supportAccessExpiry, supportGrantState, twoFactorSetupNeeded,
} from "@/lib/security/access-rules";
import { workflowPermissionPresets } from "@/lib/workflow/permissions";

// Behörighetsstyrning (K2, 2026-11-28): the pure rules, and the source guards that keep the support path read only.

const at = (iso: string) => new Date(iso);

test("support access: 1 hour, 24 hours (default) or 7 days, and nothing else", () => {
  assert.deepEqual([...SUPPORT_ACCESS_HOURS], [1, 24, 168]);
  assert.equal(SUPPORT_ACCESS_DEFAULT_HOURS, 24);
  assert.ok(isSupportAccessHours(24) && !isSupportAccessHours(48) && !isSupportAccessHours("24"));
  assert.equal(supportAccessExpiry(24, at("2026-11-28T10:00:00Z")).toISOString(), "2026-11-29T10:00:00.000Z");
  assert.equal(supportAccessExpiry(168, at("2026-11-28T10:00:00Z")).toISOString(), "2026-12-05T10:00:00.000Z");
  assert.equal(supportAccessExpiry(1, at("2026-11-28T10:00:00Z")).toISOString(), "2026-11-28T11:00:00.000Z");
});

test("a grant is open only before it expires and while it is not revoked", () => {
  const now = at("2026-11-28T12:00:00Z");
  assert.equal(supportGrantState({ expiresAt: at("2026-11-28T13:00:00Z"), revokedAt: null }, now), "active");
  assert.equal(supportGrantState({ expiresAt: at("2026-11-28T12:00:00Z"), revokedAt: null }, now), "expired", "the expiry moment itself is closed");
  assert.equal(supportGrantState({ expiresAt: at("2026-11-28T11:00:00Z"), revokedAt: null }, now), "expired");
  assert.equal(supportGrantState({ expiresAt: at("2026-11-29T12:00:00Z"), revokedAt: at("2026-11-28T11:30:00Z") }, now), "revoked");
  assert.equal(supportGrantState({ expiresAt: at("2026-11-28T11:00:00Z"), revokedAt: at("2026-11-28T10:30:00Z") }, now), "revoked", "revoked wins over expired");
  assert.equal(openSupportGrant([], now), null);
  assert.equal(openSupportGrant([{ expiresAt: at("2026-11-28T11:00:00Z"), revokedAt: null }, { expiresAt: at("2026-11-29T12:00:00Z"), revokedAt: now }], now), null);
  const open = { expiresAt: at("2026-11-28T18:00:00Z"), revokedAt: null };
  assert.equal(openSupportGrant([{ expiresAt: at("2026-11-28T11:00:00Z"), revokedAt: null }, open], now), open);
});

test("support reads only the fixed parts", () => {
  for (const part of ["overview", "members", "places", "machines", "work_orders", "forms"]) assert.ok(isSupportPart(part), part);
  for (const part of ["documents", "files", "prices", "keys", "", "__proto__"]) assert.ok(!isSupportPart(part), part);
});

test("the access review is due a quarter after the last sign-off, and only with the reminder on", () => {
  const since = at("2026-01-15T09:00:00Z");
  assert.equal(accessReviewDueAt(null, since).toISOString(), "2026-04-15T09:00:00.000Z", "never reviewed: a quarter after the start");
  assert.equal(accessReviewDueAt(at("2026-11-28T09:00:00Z"), since).toISOString(), "2027-02-28T09:00:00.000Z");
  const endOfMonth = accessReviewDueAt(at("2026-11-30T09:00:00Z"), since);
  assert.equal(endOfMonth.toISOString(), "2027-02-28T09:00:00.000Z", "30 November + 3 months is still February");
  assert.equal(accessReviewDue({ reminderOn: false, lastReviewedAt: null, since }, at("2027-01-01T00:00:00Z")), false, "off: never a reminder");
  assert.equal(accessReviewDue({ reminderOn: true, lastReviewedAt: at("2026-11-01T00:00:00Z"), since }, at("2026-12-01T00:00:00Z")), false);
  assert.equal(accessReviewDue({ reminderOn: true, lastReviewedAt: at("2026-08-01T00:00:00Z"), since }, at("2026-11-28T00:00:00Z")), true);
});

test("permissions in words and the review as CSV", () => {
  const presets = workflowPermissionPresets.map((preset) => ({ label: preset.label, profile: { grants: preset.profile.grants as readonly string[] } }));
  assert.equal(permissionSummary("OWNER", [], presets, 10), "Ägare: allt i företaget");
  assert.equal(permissionSummary("MEMBER", presets[1].profile.grants, presets, 10), presets[1].label);
  assert.equal(permissionSummary("MEMBER", ["projects:read"], presets, 10), "Egna behörigheter (1 av 10)");
  const csv = accessReviewCsv([{ type: "API-nyckel", name: "=HYPERLINK(1)", who: "Åsa", rights: "Läsa projekt", status: "Aktiv", validUntil: "2027-01-01", lastUsed: "" }], csvCell);
  assert.ok(csv.startsWith("﻿\"Typ\";\"Namn\""));
  assert.match(csv, /"'=HYPERLINK\(1\)"/, "a formula is neutralised");
  assert.ok(csv.endsWith("\r\n"));
});

test("a machine key limited to some machines writes nothing for another or for none", () => {
  assert.ok(machinePartAllowed([], "a"), "no limit as before");
  assert.ok(machinePartAllowed(null, null));
  assert.ok(machinePartAllowed(["a", "b"], "b"));
  assert.ok(!machinePartAllowed(["a"], "c"));
  assert.ok(!machinePartAllowed(["a"], null), "an event without a machine is refused when the key is limited");
});

test("required two-step: set up before the app unless the sign-in already is two steps", () => {
  assert.equal(twoFactorSetupNeeded({ required: false, hasTotp: false, strongMethod: false }), false, "off by default: nothing changes");
  assert.equal(twoFactorSetupNeeded({ required: true, hasTotp: false, strongMethod: false }), true);
  assert.equal(twoFactorSetupNeeded({ required: true, hasTotp: true, strongMethod: false }), false);
  assert.equal(twoFactorSetupNeeded({ required: true, hasTotp: false, strongMethod: true }), false, "passkey or Microsoft with its own MFA");
  assert.equal(twoFactorSetupNeeded({ required: true, hasTotp: false, strongMethod: false, qaSuperadmin: true }), false);
});

test("the support path is read only, session only and bound to the company's own grant", () => {
  const support = readFileSync("app/api/superadmin/support-access/route.ts", "utf8");
  assert.doesNotMatch(support, /export async function (POST|PUT|PATCH|DELETE)/, "support has no way to change anything");
  assert.match(support, /ctx\.user\.role !== "SUPERADMIN"/);
  assert.match(support, /ctx\.integration/, "never through an API or MCP key");
  assert.ok(support.indexOf("activeSupportGrant(organizationId)") < support.indexOf("readSupportPart("), "the grant is checked before anything is read");
  assert.ok(support.indexOf("readSupportPart(") < support.indexOf("logSupportRead("), "and the read is logged before it is returned");
  const reads = readFileSync("lib/security/support-reads.ts", "utf8");
  assert.doesNotMatch(reads, /\.(create|update|upsert|delete)(Many)?\(/, "the support reads never write");
  assert.doesNotMatch(reads, /\$queryRaw|\$executeRaw/);
  const company = readFileSync("app/api/security/support-access/route.ts", "utf8");
  assert.match(company, /checkOrigin\(request\)/);
  assert.match(company, /requireAdmin\(ctx\)/);
  assert.match(company, /requireFreshAuth\(ctx\.user\.id, ctx\.auth\)/, "a grant needs a fresh confirmation");
  assert.match(company, /ctx\.user\.role === "SUPERADMIN"/, "a superadmin cannot grant to the installation itself");
  // context() still demands an active membership: the grant is the only way from support to a company's business data.
  assert.match(readFileSync("lib/kfid/server.ts", "utf8"), /if \(!membership\?\.isActive\) throw new ApiError\(403, NO_ACTIVE_COMPANY_TEXT\)/);
});

test("the review and the machine limit are guarded like the other admin routes", () => {
  const review = readFileSync("app/api/security/access-review/route.ts", "utf8");
  assert.match(review, /checkOrigin\(request\)/);
  assert.match(review, /requireAdmin\(ctx\)/);
  assert.match(review, /ctx\.integration/);
  const machine = readFileSync("lib/api-handlers/machine-sources.ts", "utf8");
  assert.match(machine, /set_allowed_parts[\s\S]*organizationId: ctx\.organizationId/, "only the company's own machine parts");
  assert.match(readFileSync("lib/machine/store.ts", "utf8"), /machinePartAllowed\(source\?\.allowedMachinePartIds, machinePartId\)/);
  // The intake only takes in: the two routes have POST and nothing that reads or sends back to the machine.
  for (const file of ["app/api/ingest/v1/events/route.ts", "app/api/ingest/v1/raw/route.ts"]) assert.doesNotMatch(readFileSync(file, "utf8"), /export (async )?function (GET|PUT|PATCH|DELETE)|export const (GET|PUT|PATCH|DELETE)/, file);
});
