import assert from "node:assert/strict";
import test from "node:test";
import { customerContactName, customerDisplayName, movedJobPlace, projectCustomerChange, projectCustomerFields } from "../lib/workflow/project-customer";
import { projectFieldRows } from "../lib/workflow/project-frame";

// Kundbyte på projekt (2026-10-10, kartläggningen 5.3) and Beställare som följer kunden (5.4).
const job = (id: string, customerId: string | null, status = "PLANNED") => ({ id, title: `Jobb ${id}`, status, customerId });
const change = (jobs: ReturnType<typeof job>[], quotes: { status: string; customerId: string | null }[] = []) =>
  projectCustomerChange({ fromCustomerId: "a", toCustomerId: "b", fromName: "Brf A", toName: "Brf B", jobs, quotes });

test("nothing to decide when nothing has another customer, or when the project loses its customer", () => {
  assert.equal(change([]), null);
  assert.equal(change([job("1", "b"), job("2", null)]), null, "jobs of the new customer or without one are not counted");
  assert.equal(projectCustomerChange({ fromCustomerId: "a", toCustomerId: null, fromName: "Brf A", toName: "", jobs: [job("1", "a")] }), null);
  assert.equal(projectCustomerChange({ fromCustomerId: "a", toCustomerId: "a", fromName: "Brf A", toName: "Brf A", jobs: [job("1", "c")] }), null);
});

test("open jobs with the old customer need the explicit choice; quotes are named, never moved", () => {
  const result = change([job("1", "a"), job("2", "a", "CANCELLED"), job("3", "b")], [{ status: "SENT", customerId: "a" }]);
  assert.ok(result);
  assert.equal(result.blocked, false);
  assert.equal(result.open, 2);
  assert.equal(result.quotes, 1);
  assert.match(result.message, /^2 jobb i projektet har kunden Brf A\. Flytta jobben till Brf B, eller behåll kunden\./);
  assert.match(result.message, /1 offert i projektet har kunden Brf A\. Offerter flyttas inte/);
  const quotesOnly = change([], [{ status: "DRAFT", customerId: "a" }, { status: "ACCEPTED", customerId: "a" }]);
  assert.equal(quotesOnly?.open, 0);
  assert.match(quotesOnly?.message ?? "", /^2 offerter i projektet har kunden Brf A\..*Byt kund ändå, eller behåll kunden\.$/);
});

test("completed work never changes customer, so it blocks the change with a reason", () => {
  const result = change([job("1", "a"), job("2", "a", "COMPLETED")]);
  assert.equal(result?.blocked, true);
  assert.equal(result?.completed, 1);
  assert.match(result?.message ?? "", /^Kunden kan inte bytas\. 1 färdigställt jobb i projektet har kunden Brf A/);
  assert.equal(projectCustomerChange({ fromCustomerId: null, toCustomerId: "b", fromName: "", toName: "Brf B", jobs: [job("1", "a")] })?.fromName, "en annan kund");
});

test("a moved job keeps a place of the new customer, else takes the project's place, never the old customer's", () => {
  assert.equal(movedJobPlace({ facilityId: "pb", facilityCustomerId: "b" }, "b", "proj"), "pb");
  assert.equal(movedJobPlace({ facilityId: "pa", facilityCustomerId: "a" }, "b", "proj"), "proj");
  assert.equal(movedJobPlace({ facilityId: "pa", facilityCustomerId: "a" }, "b", null), null);
  assert.equal(movedJobPlace({ facilityId: null, facilityCustomerId: null }, "b", null), null);
});

test("Beställare is the customer's name; Kontaktperson follows the customer unless the person wrote another", () => {
  const brfB = { name: "Anna Andersson", company: "Brf B" };
  const brfA = { name: "Kalle Karlsson", company: "Brf A" };
  assert.equal(customerDisplayName(brfB), "Brf B");
  assert.equal(customerDisplayName({ name: "Eva Privat", company: "" }), "Eva Privat");
  assert.equal(customerContactName(brfB), "Anna Andersson");
  assert.equal(customerContactName({ name: "Eva Privat", company: "" }), "", "a private customer's own name is no contact person");
  assert.deepEqual(projectCustomerFields({ customer: brfB, client: "Gammal text", contactPerson: "" }), { client: "Brf B", contactPerson: "Anna Andersson" });
  assert.deepEqual(projectCustomerFields({ customer: brfB, previousCustomer: brfA, client: "Brf A", contactPerson: "Kalle Karlsson" }), { client: "Brf B", contactPerson: "Anna Andersson" });
  assert.deepEqual(projectCustomerFields({ customer: brfB, previousCustomer: brfA, client: "Brf A", contactPerson: "Platschef Lisa" }), { client: "Brf B", contactPerson: "Platschef Lisa" });
  assert.deepEqual(projectCustomerFields({ customer: null, client: "Fritext AB", contactPerson: "Olle" }), { client: "Fritext AB", contactPerson: "Olle" });
});

test("reports print one value per thing: the customer's current name as Beställare and the place instead of its copied text", () => {
  const rows = projectFieldRows({ client: "Brf A (gammal)", contactPerson: "Anna", workSite: "Gammal adress", customer: { name: "Anna", company: "Brf B" }, facility: { name: "Hus 1", address: "Gatan 1", postalCode: "123 45", city: "Staden" } });
  const labels = rows.map(([label]) => label);
  assert.equal(rows.find(([label]) => label === "Beställare")?.[1], "Brf B");
  assert.ok(labels.includes("Plats"));
  assert.ok(!labels.includes("Arbetsplats / anläggning"), "the place's copied text is not printed beside the place");
  // Without customer and place the free texts are printed as before.
  const free = projectFieldRows({ client: "Fritext AB", workSite: "Bygget vid ån" });
  assert.deepEqual(free.map(([label, value]) => `${label}: ${value}`), ["Beställare: Fritext AB", "Arbetsplats / anläggning: Bygget vid ån"]);
});
