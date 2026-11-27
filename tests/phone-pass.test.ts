import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { ANCHORS } from "../lib/self-inspection/model";
import { partFlags, programOutline, shiftOpenParts } from "../lib/self-inspection/outline";
import { TEMPLATE_SECTIONS } from "../lib/self-inspection/template";

// Mobile pass (2026-10-17): (a) one side margin of 12 px on a phone for the work lists' filter panels, Kundregister and
// Mina offerter, (b) the title of level 1's top bar is one line ending with … and (c) Egenkontroll's programme page is short and
// its controls are 44 px on a phone. The pictures are measured in tests/phone-pass.browser.cjs; these are the rules in the source.
const root = path.join(__dirname, "..");
const css = readFileSync(path.join(root, "app", "globals.css"), "utf8");
const ruleBody = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} is in globals.css`);
  return css.slice(start, css.indexOf("}", start));
};

test("the top bar's title is one line that ends with … (never two lines)", () => {
  for (const selector of [".native-top-bar-title", ".workspace-modal[data-native-view] > .workspace-modal-header .native-top-bar-title"]) {
    const rule = ruleBody(selector);
    assert.match(rule, /white-space:\s*nowrap/, `${selector} stays on one line`);
    assert.match(rule, /text-overflow:\s*ellipsis/, `${selector} ends a long title with …`);
    assert.doesNotMatch(rule, /line-clamp/, `${selector} no longer allows two lines`);
    assert.doesNotMatch(rule, /-webkit-box/, `${selector} is no clamped box`);
  }
  // The title still never grows past what leaves room for the buttons on both sides.
  // (2026-10-19: wider, about 16 characters at 360 px instead of 11.)
  assert.match(ruleBody(".native-top-bar-title"), /max-width:\s*min\(62vw, calc\(100vw - 12\.5rem\)\)/);
  // The whole title stays for screen readers.
  assert.match(readFileSync(path.join(root, "components", "native", "top-bar.tsx"), "utf8"), /native-top-bar-title"[^>]*aria-label=\{title\}/);
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : sources(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

test("a list or a filter row keeps the phone's 12 px margin: only Panel-like sections bleed (app-bleed)", () => {
  const found: string[] = [];
  for (const dir of ["app", "components", "features", "ee"].filter((name) => existsSync(path.join(root, name)))) {
    for (const file of sources(path.join(root, dir))) {
      // Comments may name the class (they explain why a list does not use it); only a class in the code counts.
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
      for (const match of text.matchAll(/app-bleed/g)) found.push(`${path.relative(root, file)}:${text.slice(0, match.index).split("\n").length}`);
    }
  }
  // Uppdraget is the one section that runs edge to edge outside a Panel; the work list's filter row and rows are not.
  assert.deepEqual(found.map((where) => where.split(":")[0]), [path.join("features", "workflow", "task-brief.tsx")], `app-bleed is only for Uppdraget: ${found.join(", ")}`);
  const list = readFileSync(path.join(root, "features", "workflow", "work-list.tsx"), "utf8");
  // Toppvisningen (2026-10-31): the work list draws its filter row with ListFilterBar, which is the shared ListToolbar.
  assert.match(list, /<ListFilterBar/, "the work list's filter row is the shared ListFilterBar, not a bleed box");
  assert.match(readFileSync(path.join(root, "components", "list-filter-bar.tsx"), "utf8"), /<ListToolbar /, "ListFilterBar draws the shared ListToolbar");
  assert.doesNotMatch(css, /\.app-bleed\[role="table"\]/, "no separate rule for a bleeding table is left");
});

test("the touch: variant has the touch-target rule's condition (a touch screen or under 1024 px)", () => {
  const variant = /@custom-variant touch \{\s*@media ([^{]+)\{/.exec(css);
  assert.ok(variant, "globals.css defines touch:");
  const rule = /@media ([^{]+)\{\s*:is\(button, \[role="button"\]/.exec(css);
  assert.ok(rule, "the touch-target rule is in globals.css");
  assert.equal(variant[1].trim(), rule[1].trim(), "touch: and the global touch-target rule share their condition");
});

test("Egenkontroll's programme: parts fold on a phone and every jump opens its part", () => {
  const view = readFileSync(path.join(root, "features", "self-inspection", "document-view.tsx"), "utf8");
  assert.match(view, /useFoldsDocument\(\)/, "the document asks whether it folds (a phone or a tablet)");
  assert.match(view, /<details id=\{id\}/, "a folded part is a <details> that keeps its id");
  assert.match(view, /<DocumentPart[^>]*id="si-requirements"/, "the requirement overview is a part like the others");
  const shared = readFileSync(path.join(root, "features", "self-inspection", "shared.tsx"), "utf8");
  assert.match(shared, /closest\("details"\)[\s\S]*\.open = true/, "goTo opens the folded part (and the ones around it) it sends the person to");
  // The three check rows of the overview are real buttons of 44 px on touch, not 20 px text.
  const overview = view.slice(view.indexOf("Kompletteringsbehov"), view.indexOf("function ReadConfirmation"));
  assert.match(overview, /touch:min-h-11/);
  assert.match(overview, /touch:enabled:bg-secondary/);
});

// ---------- Egenkontrollens redigerare på telefon och surfplatta (2026-10-18) ----------

test("the editor folds like the read document: one shared part, the open parts are the editor's, the row carries the marks", () => {
  const view = readFileSync(path.join(root, "features", "self-inspection", "document-view.tsx"), "utf8");
  const editor = view.slice(view.indexOf("function DocumentEditor"), view.indexOf("function FactsEditor"));
  assert.match(editor, /useFoldsDocument\(\)/, "the editor folds when the document does");
  assert.match(editor, /<DocumentPart[^>]*folded=\{folded\}/, "its parts are the shared DocumentPart, not a copy");
  assert.doesNotMatch(editor, /<section\b/, "no section of its own is drawn");
  assert.match(editor, /useState<ReadonlySet<string>>\(\(\) => new Set\(\)\)/, "every part starts folded");
  assert.match(editor, /shiftOpenParts\(current, \{ kind: "move"/);
  assert.match(editor, /shiftOpenParts\(current, \{ kind: "insert"/);
  assert.match(editor, /shiftOpenParts\(current, \{ kind: "remove"/);
  assert.match(editor, /partFlags\(outline, remapSectionAnchors\(program\.checks/, "the field check shows in the rows");
  assert.match(editor, /<PartMarks flags=/, "the row has marks");
  // Computers keep the open sections: the folded variant is only for a phone and a tablet.
  const hook = readFileSync(path.join(root, "features", "workflow", "use-detail-level.ts"), "utf8");
  assert.match(hook, /deviceClass\(.*\) !== "desktop"/, "a phone and a tablet fold, a computer does not");
});

test("the unsaved guard lets an in-page #link through: Egenkontrollens innehållslista works with changes not yet saved", () => {
  const guard = readFileSync(path.join(root, "lib", "workflow", "use-unsaved-guard.ts"), "utf8");
  assert.match(guard, /anchor\.hash && anchor\.origin === location\.origin && anchor\.pathname === location\.pathname && anchor\.search === location\.search\) return;/);
});

test("partFlags: a check belongs to the part it names, the facts to the section that holds them", () => {
  const outline = programOutline(TEMPLATE_SECTIONS);
  const business = outline.find((entry) => entry.blocks.includes("facts"))!;
  const flags = partFlags(outline, [
    { kind: "MISSING", anchor: ANCHORS.facts }, { kind: "MISSING", anchor: ANCHORS.roles }, { kind: "MISSING", anchor: ANCHORS.roles },
    { kind: "TEMPLATE", anchor: ANCHORS.section(2) }, { kind: "REMINDER", anchor: ANCHORS.section(2) }, { kind: "REMINDER" }, { kind: "MISSING", anchor: "si-unknown" },
  ]);
  assert.deepEqual(flags.get(business.anchor), { missing: 1, template: 0, reminder: 0 }, "the facts are flagged on the section that holds them");
  assert.deepEqual(flags.get(ANCHORS.roles), { missing: 2, template: 0, reminder: 0 });
  assert.deepEqual(flags.get(ANCHORS.section(2)), { missing: 0, template: 1, reminder: 1 });
  assert.equal(flags.size, 3, "a check without a place or with an unknown one is left out");
  // Without a section that holds the facts, they stand on their own at the top.
  const own = programOutline([{ key: "", title: "Vårt eget" }]);
  assert.deepEqual(partFlags(own, [{ kind: "MISSING", anchor: ANCHORS.facts }]).get(ANCHORS.facts), { missing: 1, template: 0, reminder: 0 });
});

test("shiftOpenParts: the open parts follow their sections when one is added, moved or removed", () => {
  const open = new Set([ANCHORS.section(1), ANCHORS.section(3), ANCHORS.roles]);
  const sorted = (set: Set<string>) => [...set].sort();
  assert.deepEqual(sorted(shiftOpenParts(open, { kind: "move", from: 1, to: 2 })), sorted(new Set([ANCHORS.section(2), ANCHORS.section(3), ANCHORS.roles])), "a moved section takes its place along");
  assert.deepEqual(sorted(shiftOpenParts(open, { kind: "move", from: 3, to: 1 })), sorted(new Set([ANCHORS.section(3), ANCHORS.section(1), ANCHORS.roles])), "two open sections swap places");
  assert.deepEqual(sorted(shiftOpenParts(open, { kind: "insert", at: 2 })), sorted(new Set([ANCHORS.section(1), ANCHORS.section(2), ANCHORS.section(4), ANCHORS.roles])), "a new section is open and the ones after it move down");
  assert.deepEqual(sorted(shiftOpenParts(open, { kind: "remove", at: 1 })), sorted(new Set([ANCHORS.section(2), ANCHORS.roles])), "a removed section's row goes and the ones after it move up");
  assert.deepEqual(sorted(shiftOpenParts(open, { kind: "remove", at: 2 })), sorted(new Set([ANCHORS.section(1), ANCHORS.section(2), ANCHORS.roles])));
  assert.equal(open.size, 3, "the old set is left as it was");
});
