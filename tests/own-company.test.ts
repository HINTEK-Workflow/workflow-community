import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { customerChoiceName, isOwnCompany, OWN_COMPANY_LABEL, ownCompanyFirst, ownCompanyPlacesHref, withoutOwnCompany } from "../lib/workflow/own-company";
import { customerPlaceHref } from "../lib/workflow/navigation";

// Eget företag (2026-10-24: "Bygg likadant – kundföretag har ju också egna objekt"): the company's own places are a
// customer record of its own, kept apart from the customers.
const text = (path: string) => readFileSync(path, "utf8");

test("the company's own record is Eget företag, first in a choice, and never one of the customers in a list", () => {
  const customers = [{ id: "c1", name: "Kund A" }, { id: "own", name: "Elfirman AB", ownCompany: true }, { id: "c2", name: "Kund B", ownCompany: false }];
  assert.deepEqual(ownCompanyFirst(customers).map((item) => item.id), ["own", "c1", "c2"]);
  assert.deepEqual(withoutOwnCompany(customers).map((item) => item.id), ["c1", "c2"]);
  assert.equal(customerChoiceName(customers[1]), OWN_COMPANY_LABEL);
  assert.equal(customerChoiceName(customers[0]), "Kund A");
  assert.equal(isOwnCompany(null), false);
  // The same page as a customer's places, and the place's pen opens it at the place.
  assert.equal(ownCompanyPlacesHref("own 1"), "/?view=customers&customerId=own%201");
  assert.equal(customerPlaceHref("own", "p1"), "/?view=customers&customerId=own&place=p1");
});

test("the server keeps the record apart: register, search, customer edit and the places' right", () => {
  assert.match(text("lib/kfid/records.ts"), /"ownCompany" = false/, "never in the customer register");
  assert.match(text("app/api/records/route.ts"), /ownCompany: false/, "never removed as a customer from the register");
  assert.match(text("lib/search/sql.ts"), /cu\."ownCompany" = false/, "never found as a customer");
  const workspace = text("app/api/workspace/route.ts");
  assert.match(workspace, /action === "own_company"\) \{\s*requireAdmin\(ctx\);/, "made by the company's admin");
  assert.match(workspace, /ownCompany: true \} \}\)\) throw new ApiError\(409, OWN_COMPANY_REFUSAL\)/, "not edited as a customer");
  assert.match(workspace, /if \(customer\.ownCompany\) throw new ApiError\(409, OWN_COMPANY_REFUSAL\)/, "not removed as a customer");
  assert.match(workspace, /customers: ownCompanyFirst\(customers\)/, "a choice of its own, first");
  const card = text("app/api/customer-card/route.ts");
  assert.equal((card.match(/requireOwnPlaceEdit\(ctx,/g) ?? []).length, 2, "saving and removing a place of the company's own needs the right to edit the company");
  assert.match(text("features/workflow/customer-field.tsx"), /isOwnCompany\(customer\) \? OWN_COMPANY_LABEL/, "the work order's customer choice says Eget företag");
  // The same components as a customer's places: the customer page itself, not a copy.
  const page = text("features/kfid/customer-card.tsx");
  assert.match(page, /const own = isOwnCompany\(customer\)/);
  assert.match(page, /<PlaceBrowser /);
  assert.match(text("features/kfid/own-company-places.tsx"), /router\.push\(withReturn\(ownCompanyPlacesHref\(id\), /, "Företaget leads to the same page, with the way back");
});
