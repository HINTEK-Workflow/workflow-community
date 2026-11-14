import assert from "node:assert/strict";
import test from "node:test";
import { shownUsers, userFilterCounts, userInvitationHref, userListItems, userPersonHref, userRoleLabel } from "../lib/workflow/users-list";

// Användare som Kunder (2026-10-31): members and invitations are one list with chips, search and sort.
const person = (id: string, name: string | null, role = "MEMBER", isActive = true, accountActive = true) => ({ role, isActive, user: { id, name, email: `${id}@example.test`, isActive: accountActive } });
const items = userListItems(
  [person("anna", "Anna Öst"), person("bo", "Bo Ek", "OWNER"), person("cia", null, "MEMBER", false), person("dan", "Dan Berg", "MEMBER", true, false)],
  [{ id: "inv1", name: "Eva Ny", email: "eva@example.test", role: "MEMBER", status: "PENDING" }, { id: "inv2", name: "", email: "fia@example.test", role: "ADMIN", status: "PREPARED" }],
);

test("the row opens the person's or the invitation's own page", () => {
  assert.equal(items[0].href, userPersonHref("anna"));
  assert.equal(items[4].href, userInvitationHref("inv1"));
  assert.equal(userPersonHref("a b"), "/?view=administration&person=a%20b");
});

test("the chips count members and invitations; inactive accounts are among Pausade", () => {
  assert.deepEqual(userFilterCounts(items), { all: 6, active: 2, paused: 2, invited: 2 });
  assert.deepEqual(shownUsers(items, "paused", "", "name").map((item) => item.id), ["cia", "dan"]);
  assert.deepEqual(shownUsers(items, "invited", "", "name").map((item) => item.status), ["sent", "prepared"]);
});

test("a person without a name is shown by the e-mail address, an invitation too", () => {
  assert.equal(items.find((item) => item.id === "cia")?.name, "cia@example.test");
  assert.equal(items.find((item) => item.id === "inv2")?.name, "fia@example.test");
});

test("the search reads name, e-mail and role, every word", () => {
  assert.deepEqual(shownUsers(items, "all", "ek", "name").map((item) => item.id), ["bo"]);
  assert.deepEqual(shownUsers(items, "all", "EVA@", "name").map((item) => item.id), ["inv1"]);
  assert.deepEqual(shownUsers(items, "all", "företagsadmin bo", "name").map((item) => item.id), ["bo"]);
  assert.equal(shownUsers(items, "all", "ingen sådan", "name").length, 0);
});

test("the sort: Swedish names, e-mail, and role with the name second", () => {
  assert.deepEqual(shownUsers(items, "active", "", "name").map((item) => item.name), ["Anna Öst", "Bo Ek"]);
  assert.deepEqual(shownUsers(items, "all", "", "email").slice(0, 2).map((item) => item.id), ["anna", "bo"]);
  assert.deepEqual(shownUsers(items, "all", "", "role").slice(0, 2).map((item) => item.id), ["bo", "inv2"]);
  assert.equal(userRoleLabel("OWNER"), "Företagsadmin");
});
