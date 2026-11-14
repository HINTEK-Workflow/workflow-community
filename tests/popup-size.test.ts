import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { formPresentation, POPUP_MAX, popupWithinMax } from "../lib/workflow/dialog-mode";

// Popupstorlek (2026-10-13): "Ingen popup får vara bredare eller högre än Nytt projekt. Större innehåll ska öppnas
// på en separat sida." The box of Nytt projekt (Modal size="form") is the ceiling: 520 px wide, 85 % of the window high.
test("popup ceiling: the size of Nytt projekt", () => {
  assert.equal(POPUP_MAX.width, 520, "32.5rem, the box of Nytt projekt");
  assert.equal(POPUP_MAX.heightShare, 0.85);
  assert.equal(popupWithinMax({ width: 520, height: 680 }, 800), true, "Nytt projekt with Fler uppgifter open at 1280 x 800");
  assert.equal(popupWithinMax({ width: 520, height: 765 }, 900), true, "the same at 1440 x 900");
  assert.equal(popupWithinMax({ width: 576, height: 400 }, 800), false, "the old default box (max-w-xl) was wider");
  assert.equal(popupWithinMax({ width: 672, height: 414 }, 800), false, "Sök was 672 px");
  assert.equal(popupWithinMax({ width: 520, height: 720 }, 800), false, "90 % of the window is higher than Nytt projekt");
  assert.equal(formPresentation({ level: 3, width: 1280, size: "page" }), "page", "larger content is a page on display 3");
  assert.equal(formPresentation({ level: 2, width: 1280, size: "page" }), "page", "and on display 2");
  assert.equal(formPresentation({ level: 1, width: 390, size: "page" }), "screen", "level 1 keeps its screens");
});

const root = path.join(__dirname, "..");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : sources(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

/** The opening tag of every <Modal …> in the app's own code, with where it is. */
function modalTags(): { where: string; tag: string }[] {
  const found: { where: string; tag: string }[] = [];
  // ee/ is not there in the core-without-ee check (CI) nor in the community edition.
  for (const file of ["app", "components", "features", "ee"].filter((dir) => existsSync(path.join(root, dir))).flatMap((dir) => sources(path.join(root, dir)))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/<Modal\b/g)) {
      // The tag ends at the first ">" outside braces and strings (props hold arrows and JSX).
      let depth = 0;
      let quote = "";
      let end = match.index + 6;
      for (; end < text.length; end += 1) {
        const char = text[end];
        if (quote) { if (char === quote && text[end - 1] !== "\\") quote = ""; continue; }
        if (char === "\"" || char === "'" || char === "`") quote = char;
        else if (char === "{") depth += 1;
        else if (char === "}") depth -= 1;
        else if (char === ">" && depth === 0) break;
      }
      const line = text.slice(0, match.index).split("\n").length;
      found.push({ where: `${path.relative(root, file)}:${line}`, tag: text.slice(match.index, end + 1) });
    }
  }
  return found;
}

test("popup ceiling: no Modal is drawn as a large box", () => {
  const tags = modalTags();
  assert.ok(tags.length > 30, "the scan finds the app's dialogs");
  // A Modal with size="page" stayed a big box on displays 2 and 3; content that size is a DialogPage or FormPage.
  const pages = tags.filter(({ tag }) => /size="page"/.test(tag)).map(({ where }) => where);
  assert.deepEqual(pages, [], "use DialogPage (a page on displays 2–3, a screen at level 1) instead of Modal size=\"page\"");
  // A class can make a box narrower, never wider than Nytt projekt (the Modal caps the width anyway).
  const wide = tags.filter(({ tag }) => /\bmax-w-(?:xl|[2-7]xl|full|screen|none)\b/.test(tag)).map(({ where }) => where);
  assert.deepEqual(wide, [], "no Modal asks for a width over 32.5rem");
});

test("popup ceiling: the shared Modal caps every box on displays 2 and 3", () => {
  const ui = readFileSync(path.join(root, "features/kfid/ui.tsx"), "utf8");
  assert.match(ui, /w-\[min\(calc\(100%-2rem\),32\.5rem\)\] max-h-\[85dvh\] max-w-\[32\.5rem\]/, "the width and height of Nytt projekt for every box");
  assert.match(ui, /dialogViewportStyle\(area, place, false, !nativeLook\)/, "and the same height on a touch screen");
});
