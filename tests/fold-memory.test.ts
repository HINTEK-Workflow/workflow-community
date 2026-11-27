import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { foldIsShut, foldStoreKey, parseFolds, readFolds, writeFold, type FoldStorage } from "../lib/workflow/fold-memory";

// Minnet för ihopfällda kort (2026-11-02): per person and device, in the browser only. The browser test: tests/fold-memory.browser.cjs.
const memoryStorage = () => {
  const items = new Map<string, string>();
  const storage: FoldStorage = { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value); } };
  return { storage, items };
};

test("fold memory: two people on one device never share a fold", () => {
  const { storage, items } = memoryStorage();
  writeFold(storage, "person-a", "project-decisions", false);
  assert.deepEqual(readFolds(storage, "person-a"), { "project-decisions": false });
  assert.deepEqual(readFolds(storage, "person-b"), {}, "another person reads nothing of it");
  writeFold(storage, "person-b", "project-decisions", true);
  assert.deepEqual(readFolds(storage, "person-a"), { "project-decisions": false }, "and does not change it");
  assert.notEqual(foldStoreKey("person-a"), foldStoreKey("person-b"));
  assert.equal(items.size, 2);
});

test("fold memory: without a known person nothing is read or written", () => {
  const { storage, items } = memoryStorage();
  assert.equal(foldStoreKey(null), null);
  assert.equal(foldStoreKey(""), null);
  writeFold(storage, null, "project-decisions", false);
  writeFold(storage, "", "project-decisions", false);
  assert.equal(items.size, 0);
  assert.deepEqual(readFolds(storage, undefined), {});
});

test("fold memory: a damaged or refused storage only means nothing is remembered", () => {
  for (const raw of ["", "inte json", "[1,2]", "null", "3"]) assert.deepEqual(parseFolds(raw), {}, raw);
  assert.deepEqual(parseFolds(JSON.stringify({ good: true, also: false, bad: "ja", worse: 1 })), { good: true, also: false }, "only real answers");
  const refusing: FoldStorage = { getItem: () => { throw new Error("nekad"); }, setItem: () => { throw new Error("nekad"); } };
  assert.deepEqual(readFolds(refusing, "person-a"), {});
  assert.deepEqual(writeFold(refusing, "person-a", "form-history", true), { "form-history": true }, "the fold still works on the page");
  assert.deepEqual(readFolds(null, "person-a"), {});
});

test("fold memory: what happened on the page wins, so an address that opens a fold wins over the memory", () => {
  assert.equal(foldIsShut({ now: false, remembered: true, start: true }), false, "opened by an address: open, whatever was remembered");
  assert.equal(foldIsShut({ now: true, remembered: false, start: false }), true, "the person's click now");
  assert.equal(foldIsShut({ now: null, remembered: false, start: true }), false, "the remembered choice before the card's start");
  assert.equal(foldIsShut({ now: null, remembered: true, start: false }), true);
  assert.equal(foldIsShut({ now: null, remembered: null, start: true }), true, "nothing remembered: the card's own start");
  assert.equal(foldIsShut({ now: null, remembered: null, start: false }), false);
});

const source = (file: string) => readFileSync(file, "utf8");

test("fold memory: only in the browser, named by the shell, and not a choice when a script opens the card", () => {
  const hook = source("features/workflow/use-fold-memory.ts");
  assert.match(hook, /window\.localStorage/);
  assert.doesNotMatch(hook, /\bfetch\(|\bapi\(|document\.cookie/, "nothing goes to the server");
  assert.doesNotMatch(source("lib/workflow/fold-memory.ts"), /\bfetch\(|document\.cookie/);
  assert.match(source("components/app-shell.tsx"), /<FoldOwnerProvider ownerId=\{user\?\.id\}>/);
  const ui = source("features/kfid/ui.tsx");
  assert.match(ui, /const byPerson = event\?\.isTrusted !== false;/, "guideTo's click is no choice");
  assert.match(ui, /useState<boolean \| null>\(openWhen \? false : null\)/, "an address opens it before the memory is asked");
  assert.doesNotMatch(source("prisma/schema.prisma"), /foldMemory|rememberedFolds/);
});

test("the fold rule: the decided lists fold with a count; what you need to work safely is always open", { skip: !existsSync("docs/design-standard.md") && "docs/ is not part of the Community edition" }, () => {
  const editor = source("features/workflow/workflow-task-editor.tsx");
  assert.match(editor, /title="Tidigare protokoll"[^>]*collapsible defaultCollapsed count=\{items\.length\} foldKey="form-history"/);
  for (const title of ["Signering och avslut", "Gemensamma åtgärder och godkännande", "Identifierade risker"]) assert.match(editor, new RegExp(`keepOpen title="${title}"`), title);
  assert.equal(source("features/workflow/risk-step-panel.tsx").match(/keepOpen title="Riskbedömning"/g)?.length, 2);
  const projects = source("features/kfid/workflow-projects.tsx");
  assert.match(projects, /title="Beslutslogg"[\s\S]{0,300}collapsible=\{!native\} defaultCollapsed count=\{total\} foldKey="project-decisions"[\s\S]{0,80}actions=\{canAdd/, "Nytt beslut stays in the header");
  assert.match(projects, /title="Material i projektet" collapsible defaultCollapsed count=\{summary\.total\} foldKey="project-materials"/);
  assert.match(source("features/quotes/quote-editor.tsx"), /title="Versioner"[^>]*collapsible defaultCollapsed count=\{quote\.versions\.length\} foldKey="quote-versions"/);
  assert.match(source("features/self-inspection/self-inspection-page.tsx"), /title="Gjorda översyner" collapsible defaultCollapsed count=\{view\.reviews\.length\} foldKey="self-inspection-reviews"/);
  const statistics = source("features/workflow/task-statistics.tsx");
  assert.match(statistics, /cards \? \(mine \? "overview-statistics-mine" : "overview-statistics"\) : undefined/);
  assert.match(statistics, /\{fold\.open \? body : null\}/, "the separate cards are read and drawn when it is opened");
  assert.doesNotMatch(source("features/quotes/customer-quotes.tsx"), /defaultCollapsed|openWhen|collapsible/, "no leftover fold in CustomerQuotes");
  assert.match(source("docs/design-standard.md"), /Långa listor, historik och det man läser sällan är ihopfällt, och rubriken visar antalet\./);
});
