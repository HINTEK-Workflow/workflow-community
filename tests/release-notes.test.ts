import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compareVersions, highestVersion, RELEASE_NOTES, releaseNoteFor, releaseNotesSince, type ReleaseNote } from "../lib/release-notes";
import { dueWeeklySlot, nextWeeklySlot, parseWeeklySettings, releaseNewsletterDraft, weeklySlot } from "../lib/mail/release-newsletter";
import { mailingDocumentSchema, mailingProblems, renderMailing } from "../lib/mail/mailing-document";
import { swedishDate } from "../lib/swedish-time";

// Versionsnyheter och veckobrev (2026-10-06).
const packageVersion = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

test("every version in package.json has notes, newest first, none ahead of the package", () => {
  assert.ok(releaseNoteFor(packageVersion), `lib/release-notes.ts saknar versionsnyheter för ${packageVersion}`);
  for (const note of RELEASE_NOTES) {
    assert.ok(compareVersions(note.version, packageVersion) <= 0, `${note.version} är nyare än package.json`);
    assert.match(note.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(note.summary.trim() && note.items.length, `${note.version} behöver en mening och punkter`);
    // Plain words for users: no personal names, no internal file names or code words.
    for (const text of [note.summary, ...note.items]) assert.doesNotMatch(text, /\.tsx?\b|\bmigration|\bprisma\b|`/i); // names: the community export's guard
  }
  const order = RELEASE_NOTES.map((note) => note.version);
  assert.deepEqual(order, [...order].sort(compareVersions).reverse());
  assert.equal(new Set(order).size, order.length);
  // A newer version is never dated before an older one (2026-10-07: 0.4.20 said the 8th, 0.4.21 the 7th).
  RELEASE_NOTES.slice(1).forEach((older, index) => assert.ok(older.date <= RELEASE_NOTES[index].date, `${older.version} (${older.date}) är daterad efter ${RELEASE_NOTES[index].version} (${RELEASE_NOTES[index].date})`));
});

test("versions compare part by part", () => {
  assert.equal(compareVersions("0.4.9", "0.4.19"), -1);
  assert.equal(compareVersions("0.5.0", "0.4.19"), 1);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
  assert.equal(highestVersion(["0.4.9", null, "0.4.19", "0.4.2"]), "0.4.19");
  assert.equal(highestVersion([]), null);
});

const notes: ReleaseNote[] = [
  { version: "0.5.1", date: "2026-10-20", summary: "Framtid.", items: ["Inte släppt."] },
  { version: "0.5.0", date: "2026-10-13", summary: "Andra.", items: ["B1", "B2"] },
  { version: "0.4.20", date: "2026-10-08", summary: "Första.", items: ["A1"] },
  { version: "0.4.19", date: "2026-10-06", summary: "Gammal.", items: ["G"] },
];

test("a newsletter carries what is new since the last one, up to the running version", () => {
  assert.deepEqual(releaseNotesSince("0.4.19", "0.5.0", notes).map((note) => note.version), ["0.5.0", "0.4.20"]);
  assert.deepEqual(releaseNotesSince("0.5.0", "0.5.0", notes), []);
  // Without an earlier newsletter: only the running version, never the whole history.
  assert.deepEqual(releaseNotesSince(null, "0.5.0", notes).map((note) => note.version), ["0.5.0"]);
});

test("the drafted newsletter is a valid block mail with every version and point", () => {
  const draft = releaseNewsletterDraft(releaseNotesSince("0.4.19", "0.5.0", notes), { appUrl: "https://workflow.example.invalid", name: "Workflow" });
  assert.ok(draft);
  assert.equal(draft.subject, "Nytt i Workflow 0.5.0");
  assert.equal(draft.version, "0.5.0");
  assert.deepEqual(draft.versions, ["0.5.0", "0.4.20"]);
  mailingDocumentSchema.parse(draft.document);
  assert.deepEqual(mailingProblems(draft.document), []);
  const { html, text } = renderMailing(draft.document, { name: "Workflow", footer: "Fot", unsubscribe: "#" });
  for (const part of ["version 0.4.20–0.5.0", "Version 0.4.20", "B2", "A1", "Öppna Workflow"]) assert.ok(text.includes(part) || html.includes(part), part);
  assert.equal(releaseNewsletterDraft([], { appUrl: "https://x.invalid", name: "Workflow" }), null);
  // The real notes make a valid mail too.
  const real = releaseNewsletterDraft(RELEASE_NOTES, { appUrl: "https://x.invalid", name: "Workflow" });
  assert.ok(real);
  mailingDocumentSchema.parse(real.document);
});

test("the weekly slot is the chosen weekday and Swedish time, once a week, never a day late", () => {
  const settings = parseWeeklySettings({ enabled: true, weekday: 1, time: "08:30" }); // tisdag 08:30
  // Wednesday 2026-10-07 10:00 Swedish time: this week's slot is Tuesday 2026-10-06 08:30 Swedish time.
  const wednesday = swedishDate(2026, 10, 7, 10, 0);
  assert.equal(weeklySlot(settings, wednesday).toISOString(), swedishDate(2026, 10, 6, 8, 30).toISOString());
  assert.equal(nextWeeklySlot(settings, wednesday).toISOString(), swedishDate(2026, 10, 13, 8, 30).toISOString());
  // Due from the slot for a day, until handled.
  assert.equal(dueWeeklySlot(settings, swedishDate(2026, 10, 6, 8, 29)), null);
  const due = dueWeeklySlot(settings, swedishDate(2026, 10, 6, 8, 35));
  assert.equal(due?.toISOString(), swedishDate(2026, 10, 6, 8, 30).toISOString());
  assert.equal(dueWeeklySlot({ ...settings, lastSlot: due!.toISOString() }, swedishDate(2026, 10, 6, 9, 0)), null);
  assert.equal(dueWeeklySlot(settings, wednesday), null, "more than a day late: skipped");
  assert.equal(dueWeeklySlot({ ...settings, enabled: false }, swedishDate(2026, 10, 6, 8, 35)), null);
  // Winter time is still Swedish time (the clock goes back 2026-10-25).
  assert.equal(weeklySlot(settings, swedishDate(2026, 10, 28, 12, 0)).toISOString(), "2026-10-27T07:30:00.000Z");
  // Bad stored settings fall back to off.
  assert.equal(parseWeeklySettings({ weekday: 9 }).enabled, false);
  assert.equal(parseWeeklySettings(null).time, "08:00");
});

// Versionstexter (2026-11-12, docs/regler/versionstexter.md): the obvious parts are guarded, the rest is proofreading.
test("version texts follow the writing rules: short, plain, no domains and no technical words", () => {
  const domain = /\b[\p{L}\d-]+\.(?:se|com|org|net|io|eu|nu)\b/iu;
  const technical = /\b(?:API|MCP|databas\w*|migrering\w*|endpoint\w*|commit\w*|webhook\w*|backend|frontend|prisma|SQL|token\w*|JSON)\b/i;
  // Exact names the app itself shows (Kopplingar) may contain a technical word; everything else may not.
  const uiNames = /API och MCP|API-koppling\p{L}*|API-nyckel\p{L}*/gu;
  for (const note of RELEASE_NOTES) {
    const where = `${note.version}`;
    assert.ok(note.summary.trim().length >= 10 && note.summary.length <= 170, `${where}: sammanfattningen ska finnas och vara kort (${note.summary.length} tecken)`);
    assert.ok(note.items.length >= 1 && note.items.length <= 14, `${where}: ${note.items.length} punkter`);
    for (const text of [note.summary, ...note.items]) {
      assert.doesNotMatch(text, domain, `${where}: domännamn i "${text}"`);
      assert.doesNotMatch(text.replace(uiNames, ""), technical, `${where}: tekniskt ord i "${text}"`);
      assert.doesNotMatch(text, /\s{2,}|\s$|^\s/, `${where}: onödiga blanksteg i "${text}"`);
      assert.match(text, /[.?!…)]$|[\p{L}\d)]$/u);
    }
    for (const item of note.items) assert.ok(item.length <= 330, `${where}: punkten är för lång (${item.length} tecken): ${item.slice(0, 60)}…`);
    assert.equal(new Set(note.items).size, note.items.length, `${where}: samma punkt två gånger`);
    // The summary ends like a sentence.
    assert.match(note.summary, /[.!?]$/, `${where}: sammanfattningen slutar utan punkt`);
  }
  // The only place that may name Workflow is the product itself.
  for (const note of RELEASE_NOTES) for (const text of [note.summary, ...note.items]) assert.doesNotMatch(text, /hintek(?!\s+(?:Workflow|AI|PLC)\b)/i, `${note.version}: Workflow utan produktnamn i "${text}"`);
});
