import { test } from "node:test";
import assert from "node:assert/strict";
import { formatKronor, parseQuoteScreen, QUOTE_SCREEN_TITLE, QUOTE_SCREENS, quoteGroupOf, quoteLineGroups, quoteLineSubtitle, quoteListGroups } from "../lib/quotes/native";

test("the quote's screens at level 1 are read from the address and have a title each", () => {
  assert.equal(parseQuoteScreen("rader"), "rader");
  assert.equal(parseQuoteScreen("skicka"), "skicka");
  assert.equal(parseQuoteScreen("material"), null, "a job's screen is no quote screen");
  assert.equal(parseQuoteScreen(null), null);
  for (const screen of QUOTE_SCREENS) assert.ok(QUOTE_SCREEN_TITLE[screen], `title for ${screen}`);
});

test("Mina offerter groups by what the quote waits for, in a fixed order, keeping the list's order", () => {
  assert.equal(quoteGroupOf("SENT"), "waiting");
  assert.equal(quoteGroupOf("DRAFT"), "draft");
  assert.equal(quoteGroupOf("ACCEPTED"), "accepted");
  assert.equal(quoteGroupOf("DECLINED"), "closed");
  assert.equal(quoteGroupOf("EXPIRED"), "closed");
  const groups = quoteListGroups([
    { id: "a", status: "DRAFT" as const }, { id: "b", status: "EXPIRED" as const }, { id: "c", status: "SENT" as const },
    { id: "d", status: "DECLINED" as const }, { id: "e", status: "SENT" as const },
  ]);
  assert.deepEqual(groups.map((group) => [group.label, group.items.map((item) => item.id)]), [
    ["Väntar på kundens svar", ["c", "e"]], ["Utkast", ["a"]], ["Avböjda och utgångna", ["b", "d"]],
  ]);
  assert.deepEqual(quoteListGroups([]), [], "no empty groups");
});

test("a quote's lines are grouped per kind: Material, Arbete, Övrigt", () => {
  const groups = quoteLineGroups([{ id: 1, kind: "OTHER" as const }, { id: 2, kind: "MATERIAL" as const }, { id: 3, kind: "MATERIAL" as const }]);
  assert.deepEqual(groups.map((group) => [group.label, group.lines.map((line) => line.id)]), [["Material", [2, 3]], ["Övrigt", [1]]]);
});

test("a line's subtitle is the quantity and unit, never a price", () => {
  assert.equal(quoteLineSubtitle({ quantity: "4", unit: "st" }), "4 st");
  assert.equal(quoteLineSubtitle({ quantity: "2,5", unit: "h" }), "2,5 h");
  assert.equal(quoteLineSubtitle({ quantity: " ", unit: "st" }), "Antal saknas");
  assert.equal(quoteLineSubtitle({ quantity: "ca 3", unit: "" }), "ca 3", "what was typed when it is no number");
});

test("formatKronor gives whole kronor with the Swedish thousands space", () => {
  assert.equal(formatKronor(29618.75), "29 619");
  assert.equal(formatKronor(450), "450");
  assert.equal(formatKronor(-1234567.4), "-1 234 567");
  assert.equal(formatKronor(Number.NaN), "–");
});
