import assert from "node:assert/strict";
import test from "node:test";
import { compareCustomerTitles, customerContact, customerLine, customerNames, customerTitle, customerTitleSql } from "../lib/kfid/customer-name";
import { CUSTOMER_FILTERS, customerMatchesFilter, customerSortQuery, listLocalCustomers } from "../lib/kfid/customer-list";
import { quoteCustomerDetails } from "../lib/quotes/customer-details";
import { customerCandidate } from "../lib/search/candidates";
import { customerContactName, customerDisplayName } from "../lib/workflow/project-customer";
import { customerPrefill } from "../lib/workflow/form-prefill";

const company = { name: "Eva Ek", company: "Brf Ljuset", customerType: "COMPANY" };
const person = { name: "Per Holm", company: "", customerType: "PRIVATE" };

// 2026-11-01, beslut 18: the company first and the contact person under it; a Privatperson keeps their own name.
test("a company's name is the heading and the contact person stands under it", () => {
  assert.deepEqual(customerNames(company), { title: "Brf Ljuset", contact: "Eva Ek" });
  assert.equal(customerLine(company), "Brf Ljuset · Eva Ek");
});

test("a private person keeps their name, also with a stored company text", () => {
  assert.deepEqual(customerNames(person), { title: "Per Holm", contact: "" });
  assert.deepEqual(customerNames({ ...person, company: "Gammal text" }), { title: "Per Holm", contact: "" });
  assert.equal(customerLine(person), "Per Holm");
});

test("the edges: no company, the same name twice, spaces, a type not read, nothing at all", () => {
  assert.deepEqual(customerNames({ name: "Bara Namn", company: "", customerType: "COMPANY" }), { title: "Bara Namn", contact: "" });
  assert.deepEqual(customerNames({ name: "Ljus AB", company: "LJUS ab" }), { title: "LJUS ab", contact: "" }, "the contact never repeats the heading");
  assert.deepEqual(customerNames({ name: " Eva ", company: " Ljus AB " }), { title: "Ljus AB", contact: "Eva" });
  assert.equal(customerTitle({ name: "Eva", company: "Ljus AB" }), "Ljus AB", "a row read without the type counts as a company");
  assert.equal(customerTitle(null), "");
  assert.equal(customerContact(undefined), "");
  assert.equal(customerLine(null), "");
});

test("the register's order follows the heading, in Swedish", () => {
  const rows = [{ name: "Örjan", company: "" , customerType: "PRIVATE" }, { name: "Ö", company: "Alfa AB" }, { name: "Bo", company: "", customerType: "PRIVATE" }];
  assert.deepEqual([...rows].sort(compareCustomerTitles).map(customerTitle), ["Alfa AB", "Bo", "Örjan"]);
  assert.match(customerTitleSql("cu"), /cu\."customerType"::text = 'PRIVATE' OR btrim\(cu\.company\) = '' THEN cu\.name ELSE cu\.company/);
  assert.match(customerTitleSql(), /^CASE WHEN "customerType"::text/);
});

test("the documents and the search use the same rule", () => {
  assert.equal(customerDisplayName(company), "Brf Ljuset");
  assert.equal(customerDisplayName({ ...person, company: "Gammal text" }), "Per Holm");
  assert.equal(customerContactName(company), "Eva Ek");
  assert.equal(customerContactName({ ...person, company: "Gammal text" }), "");
  assert.deepEqual(quoteCustomerDetails({ ...company, address: "Gatan 1" }), { name: "Brf Ljuset", contactName: "Eva Ek", address: "Gatan 1" });
  assert.deepEqual(quoteCustomerDetails({ ...person, company: "Gammal text" }), { name: "Per Holm", contactName: "", address: "" });
  assert.deepEqual(customerPrefill(company), { customer: "Brf Ljuset", contact: "Eva Ek", email: "" });
  assert.deepEqual(customerPrefill(person), { customer: "Per Holm", contact: "Per Holm", email: "" }, "a private person is their own contact on a protocol");
  const hit = customerCandidate({ id: "c1", ...company, city: "Elstad" });
  assert.equal(hit.title, "Brf Ljuset");
  assert.match(hit.subtitle ?? "", /^Eva Ek/);
});

test("the customer list's chips count what the list shows, and the sort says the register's own query", () => {
  const rows = [
    { id: "1", name: "Eva", company: "Zeta AB", customerType: "COMPANY", address: "B", email: "", updatedAt: "2026-10-01T00:00:00Z" },
    { id: "2", name: "Per", company: "", customerType: "PRIVATE", address: "A", email: "p@x", updatedAt: "2026-10-03T00:00:00Z" },
    { id: "3", name: "Anna", company: "Alfa AB", address: "", email: "a@x", updatedAt: "2026-10-02T00:00:00Z" },
  ];
  const all = listLocalCustomers(rows, { filter: "all", sort: "title" });
  assert.deepEqual(all.items.map((item) => item.id), ["3", "2", "1"]);
  assert.deepEqual(all.counts, { all: 3, COMPANY: 2, PRIVATE: 1 });
  const companies = listLocalCustomers(rows, { filter: "COMPANY", sort: "title" });
  assert.deepEqual(companies.items.map((item) => item.id), ["3", "1"], "no type stored is a company");
  assert.deepEqual(companies.counts, all.counts, "a chip does not change the other chips' counts");
  assert.deepEqual(listLocalCustomers(rows, { filter: "all", sort: "updated" }).items.map((item) => item.id), ["2", "3", "1"]);
  assert.deepEqual(listLocalCustomers(rows, { filter: "all", sort: "address" }).items.map((item) => item.id), ["2", "1", "3"], "an empty value last");
  assert.deepEqual(customerSortQuery("title"), { sort: "name", direction: "asc" });
  assert.deepEqual(customerSortQuery("updated"), { sort: "updated", direction: "desc" });
  assert.deepEqual(customerSortQuery("email"), { sort: "email", direction: "asc" });
  assert.deepEqual(CUSTOMER_FILTERS.filter((filter) => customerMatchesFilter({ customerType: "PRIVATE" }, filter)), ["all", "PRIVATE"]);
});
