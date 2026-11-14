import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LegalDocumentContent, legalVersionLine } from "../components/legal-document";
import { LegalLinks } from "../components/legal-links";

// The public policy pages as the public website shows its policies (2026-11-11): the shared type scale, no card, the version in a box.

const text = `# Tjänstevillkor för Workflow

Version 2026-11-06.1 – gäller från 6 november 2026

## 1. Parter

Villkoren gäller **mellan** parterna.

### Ett underavsnitt

- En punkt
- En andra punkt
`;

test("the version line is read from the text and shown in the box, not twice", () => {
  assert.equal(legalVersionLine(text), "Version 2026-11-06.1 – gäller från 6 november 2026");
  assert.equal(legalVersionLine("# Titel\n\n## 1. Början\n\nText."), null);
  const page = renderToStaticMarkup(h(LegalDocumentContent, { content: text, page: true }));
  assert.ok(!page.includes("gäller från"), "the page shows it in the box under the title instead");
  assert.ok(renderToStaticMarkup(h(LegalDocumentContent, { content: text })).includes("gäller från"), "the guide and the administration keep it in the text");
});

test("the page's text uses the shared type scale: body 16 px / 1.65, H2 24 px, H3 19 px (Typografi – Workflow styr)", () => {
  const page = renderToStaticMarkup(h(LegalDocumentContent, { content: text, page: true }));
  assert.match(page, /class="space-y-4 text-base leading-\[1\.65\]/);
  assert.match(page, /<h2 class="[^"]*text-2xl font-bold[^"]*">1\. Parter<\/h2>/);
  assert.match(page, /<h3 class="[^"]*text-\[1\.1875rem\] font-bold[^"]*">Ett underavsnitt<\/h3>/);
  assert.match(page, /<strong class="font-semibold">mellan<\/strong>/);
  assert.equal(page.match(/<li>/g)?.length, 2);
  assert.ok(!page.includes("<h1"), "the title is the page's own H1");
});

test("the links to the other documents open in the same window and mark the one shown", () => {
  const links = renderToStaticMarkup(h(LegalLinks, { current: "privacy", label: "Andra dokument" }));
  assert.match(links, /aria-label="Andra dokument"/);
  assert.match(links, /<a aria-current="page" href="\/legal\/privacy">/);
  assert.ok(!links.includes("target="), "same window");
});

test("the page has no card around the text, a 760 px reading column, an H1 of 32 px, and the shared top and footer only when there is one", () => {
  const source = readFileSync("app/(public)/legal/[document]/page.tsx", "utf8");
  assert.ok(!source.includes("rounded-2xl border bg-card"), "no card");
  assert.ok(source.includes("max-w-[760px]"));
  assert.ok(source.includes('<h1 className="text-[2rem] font-bold leading-[1.2] tracking-[-0.01em]">'));
  assert.ok(source.includes("serverExtensions.publicChrome?.()"), "Workflow's top and footer come from ee/; the community edition has none");
  assert.ok(!source.includes("target="), "every link on the page opens in the same window");
});

test("the terms links inside the sign-up form open in a new tab and say so", () => {
  const form = readFileSync("features/auth/components/register-form.tsx", "utf8");
  assert.ok(form.includes('target="_blank"') && form.includes("(öppnas i ny flik)"));
});

test("no underlines on the public pages, and a soft highlight on the top menu, scoped so the app keeps its look (2026-11-11)", () => {
  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.public-page :is\(a, button, summary\),\nbody:has\(\.public-page\)[^{]+\{ text-decoration-line: none !important; \}/);
  assert.match(css, /\.public-link,[^{]+\{ color: #0b5cb0; font-weight: 600;/);
  // The light bar soft #e7f1fc, the blue bar a lighter plate (the public website theme 1.0.9, 2026-11-12); 2 px between the items.
  assert.match(css, /\.landing-sub-link:hover, \.landing-sub-link\[aria-current\] \{ background: #e7f1fc; \}/);
  assert.match(css, /\.landing-company-link:hover, \.landing-company-link\[aria-current\] \{ background: rgb\(255 255 255 \/ \.12\); color: #ffffff; \}/);
  if (existsSync("ee/landing/ui/landing-header.tsx")) assert.ok(readFileSync("ee/landing/ui/landing-header.tsx", "utf8").includes("gap-[2px]"));
  for (const file of ["features/auth/components/auth-shell.tsx", "app/(public)/legal/[document]/page.tsx"]) assert.ok(readFileSync(file, "utf8").includes("public-page"), file);
  for (const file of ["app/(public)/legal/[document]/page.tsx", "features/auth/components/login-form.tsx"]) assert.doesNotMatch(readFileSync(file, "utf8"), /\bunderline\b/, file);
  assert.ok(!readFileSync("components/app-shell.tsx", "utf8").includes("public-page"), "the signed-in app is not a public page");
});

test("DPA is short in every list of links, with its full name as the link's accessible name and tooltip (2026-11-11)", () => {
  const links = renderToStaticMarkup(h(LegalLinks, {}));
  assert.match(links, /href="\/legal\/dpa"[^>]*>DPA<\/a>/);
  // Workflow's list (ee/present.ts) gives the full name; the community edition's own list has none to give.
  if (existsSync("ee/present.ts")) assert.match(links, /<a aria-label="Personuppgiftsbiträdesavtal \(DPA\)" title="Personuppgiftsbiträdesavtal \(DPA\)" href="\/legal\/dpa">DPA<\/a>/);
});
