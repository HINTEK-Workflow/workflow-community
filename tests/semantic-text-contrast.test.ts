import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { contrastRatio } from "../lib/theme";

// UX punkt 8 (D2, granskning Codex 2026-10-21: "lägg automatiskt kontrastprov för semantiska textfärger"): the red text
// token reads at least 4.5:1 on the cards and the muted surfaces in both themes, the bell's badge too, and `dark:` follows
// the app's theme (data-theme), not the device's colour scheme.
const css = readFileSync("app/globals.css", "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `the block ${selector} is in app/globals.css`);
  return css.slice(start, css.indexOf("\n}", start));
}
function token(source: string, name: string): string {
  const found = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(source);
  assert.ok(found, `${name} is set`);
  return found[1];
}

test("the red text token is readable on the cards and muted surfaces of both themes", () => {
  for (const selector of [':root:not([data-theme="dark"])', 'html[data-theme="dark"]']) {
    const theme = block(selector);
    const danger = token(theme, "--danger-text");
    for (const surface of ["--card", "--muted"]) {
      const ratio = contrastRatio(danger, token(theme, surface));
      assert.ok(ratio >= 4.5, `${selector}: --danger-text on ${surface} is ${ratio.toFixed(2)}:1`);
    }
  }
});

test("dark: follows the app's own theme, not the device's colour scheme", () => {
  assert.match(css, /@custom-variant dark \(&:where\(\[data-theme="dark"\], \[data-theme="dark"\] \*\)\);/);
});

test("the bell's badge: white figures on dark red", () => {
  const shell = readFileSync("components/notification-bell.tsx", "utf8");
  assert.match(shell, /data-testid="notification-count"[^>]*bg-\[#b91c1c\][^>]*font-bold[^>]*text-white/);
  assert.ok(contrastRatio("#ffffff", "#b91c1c") >= 4.5);
});
