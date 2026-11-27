import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Knappars höjd och utseende lika överallt (ärende #8, 2026-11-26; docs/ui-system.md, Knappstorlekar): a Button's size is its
// `size`, never a height, text size or roundness of its own in className, and a choice between views is the shared Segmented.

const ROOTS = ["app", "components", "features", "ee"];
// The design lab is locked and left out of the export; its sketches are not the product.
const SKIP = [join("features", "design-lab")];

function files(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (SKIP.some((skip) => path.startsWith(skip)) || name === "node_modules") continue;
    if (statSync(path).isDirectory()) files(path, found);
    else if (path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

// The core without ee/ (the core-without-ee gate, Community) has no ee folder: a root that is not there gives no files.
const sources = ROOTS.filter((root) => existsSync(root)).flatMap((root) => files(root)).map((path) => ({ path, text: readFileSync(path, "utf8") }));

test("no Button makes its own height, text size or pill shape in className", () => {
  const own = /<Button\b[^>]*?className="([^"]*)"/g;
  const forbidden = /(?:^|\s)(h-(?:7|8|9|10|12|14)|text-base|rounded-full)(?:\s|$)/;
  const found: string[] = [];
  for (const { path, text } of sources) {
    for (const match of text.matchAll(own)) {
      const hit = forbidden.exec(match[1]);
      if (hit) found.push(`${path}: ${hit[1]}`);
    }
  }
  // The article row's 36 px family (the antal field, − antal + and the star are as high; tests/article-card-list.browser.cjs).
  // The top bar's profile button is 40 px like its icon buttons (docs/design-standard.md, Topplistens ikonknappar).
  const allowed = [`${join("features", "catalogue", "article-collections.tsx")}: h-9`, `${join("components", "app-shell.tsx")}: h-10`];
  assert.deepEqual(found.filter((line) => !allowed.includes(line)), [], "pick a size (default, sm, xs, lg, xl) instead");
});

test("a choice between views is the shared Segmented, not a component of its own", () => {
  const own = sources.filter(({ path, text }) => /function Segmented\b/.test(text) && path !== join("components", "list-filter-bar.tsx"));
  assert.deepEqual(own.map(({ path }) => path), []);
});

test("Button has the field's big size and the period stepper keeps its arrows as high as I dag", () => {
  const button = readFileSync(join("components", "ui", "button.tsx"), "utf8");
  assert.match(button, /xl: "h-12 gap-2 px-4 text-base"/);
  const stepper = readFileSync(join("components", "ui", "period-stepper.tsx"), "utf8");
  assert.equal(stepper.match(/size="icon-lg"/g)?.length, 2, "both arrows are --control-h high");
});
