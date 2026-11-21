import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SUPERADMIN_VIEW, superadminSeesAll, viewAsFromCookieHeader, VIEW_AS_COOKIE, VIEW_AS_MODES } from "../lib/workflow/view-as";

// Superadmin in Visa som (2026-11-05): the default for the role, decided from the real role and membership.
test("only a superadmin who is admin of the active company, without a preview and without a key", () => {
  assert.equal(superadminSeesAll({ role: "SUPERADMIN", memberRole: "OWNER", viewAs: null }), true);
  assert.equal(superadminSeesAll({ role: "SUPERADMIN", memberRole: "ADMIN", viewAs: null }), true);
  assert.equal(superadminSeesAll({ role: "SUPERADMIN", memberRole: "MEMBER", viewAs: null }), false, "a plain membership stays plain");
  assert.equal(superadminSeesAll({ role: "SUPERADMIN", memberRole: null, viewAs: null }), false, "no membership, no override");
  assert.equal(superadminSeesAll({ role: "USER", memberRole: "OWNER", viewAs: null }), false, "a company's owner never gets it");
  for (const viewAs of VIEW_AS_MODES) assert.equal(superadminSeesAll({ role: "SUPERADMIN", memberRole: "OWNER", viewAs }), false, viewAs);
  assert.equal(superadminSeesAll({ role: "SUPERADMIN", memberRole: "OWNER", viewAs: null, integration: true }), false, "an API or MCP key never gets it");
});

test("the cookie can only turn it off, and Superadmin is no value it can hold", () => {
  assert.equal(viewAsFromCookieHeader(`${VIEW_AS_COOKIE}=superadmin`), null);
  assert.equal(viewAsFromCookieHeader(`other=1; ${VIEW_AS_COOKIE}=member`), "member");
  assert.equal(viewAsFromCookieHeader(null), null);
  assert.ok(!(VIEW_AS_MODES as readonly string[]).includes("superadmin"));
  assert.match(SUPERADMIN_VIEW.description, /Andra företags data är spärrad/);
});

test("the server reads no e-mail address, gives no key the override and asks for no address of a company", () => {
  const server = readFileSync("lib/kfid/server.ts", "utf8");
  assert.match(server, /seesAll: user\.role === "SUPERADMIN" && !principal && superadminSeesAll/);
  assert.doesNotMatch(readFileSync("lib/workflow/view-as.ts", "utf8"), /@hintek/);
  // The override changes what is shown and the module check, never who is an admin or which company is read.
  assert.match(server, /admin: membership\.role === "OWNER" \|\| membership\.role === "ADMIN",/);
  assert.match(server, /const organizationId = membership\.organizationId;/);
});
