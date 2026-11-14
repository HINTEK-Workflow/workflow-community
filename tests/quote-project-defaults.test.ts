import assert from "node:assert/strict";
import test from "node:test";
import { quoteFieldsFromProject } from "../lib/quotes/project-defaults";

const empty = { customerId: null, facilityId: null, title: "", description: "" };

test("a chosen project fills customer, place, heading and scope on an empty quote", () => {
  assert.deepEqual(quoteFieldsFromProject(empty, { name: "Laddboxar plan –1", description: "Sex laddplatser i garaget.", customerId: "c1", facilityId: "f1" }),
    { customerId: "c1", facilityId: "f1", title: "Laddboxar plan –1", description: "Sex laddplatser i garaget." });
});

test("what the person has written is never overwritten", () => {
  const written = { customerId: "c1", facilityId: "f2", title: "Byte av elcentral", description: "Egen text." };
  assert.deepEqual(quoteFieldsFromProject(written, { name: "Projekt", description: "Projektets text", customerId: "c1", facilityId: null }),
    { customerId: "c1", facilityId: "f2", title: "Byte av elcentral", description: "Egen text." });
});

test("another customer through the project clears a place that belonged to the old customer", () => {
  const before = { customerId: "c1", facilityId: "f1", title: "", description: "" };
  assert.equal(quoteFieldsFromProject(before, { name: "P", customerId: "c2", facilityId: null }).facilityId, null);
});

test("a project without a customer keeps the quote's customer", () => {
  const before = { customerId: "c1", facilityId: "f1", title: "", description: "" };
  const next = quoteFieldsFromProject(before, { name: "Internt", customerId: null });
  assert.equal(next.customerId, "c1");
  assert.equal(next.facilityId, "f1");
});
