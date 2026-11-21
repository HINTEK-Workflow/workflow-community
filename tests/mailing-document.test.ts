import assert from "node:assert/strict";
import test from "node:test";
import { cleanMailingHtml, mailingDocumentSchema, mailingProblems, parseMailingBody, renderMailing, type MailingDocument } from "../lib/mail/mailing-document";
import { imageKind } from "../lib/mail/mailing-images";

// Utskick som block (2026-10-03): safe e-mail HTML from the blocks, plain text beside it, and old text mailings still work.
const footer = { name: "Workflow", footer: "Du får det här som administratör.", unsubscribe: null };

test("blocks render to e-mail HTML with text escaped, bold and links, and a plain-text twin", () => {
  const document: MailingDocument = { version: 1, blocks: [
    { id: "a", type: "heading", text: "Nytt <script>", size: "large" },
    { id: "b", type: "text", text: "Hej **alla**!\n\nLäs https://example.invalid/nyhet" },
    { id: "c", type: "button", label: "Öppna", url: "https://example.invalid/app" },
    { id: "d", type: "notice", text: "Driftstopp i natt", tone: "warning" },
    { id: "e", type: "divider" },
  ] };
  const { html, text } = renderMailing(document, footer);
  assert.match(html, /Nytt &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<strong>alla<\/strong>/);
  assert.match(html, /<a href="https:\/\/example\.invalid\/nyhet"/);
  assert.match(html, /href="https:\/\/example\.invalid\/app"/);
  assert.match(text, /NYTT <SCRIPT>/);
  assert.match(text, /Öppna: https:\/\/example\.invalid\/app/);
  assert.doesNotMatch(text, /\*\*/);
});

test("only web and mail addresses are allowed as links and images", () => {
  const bad = { version: 1, blocks: [{ id: "x", type: "button", label: "Klick", url: "javascript:alert(1)" }] };
  assert.equal(mailingDocumentSchema.safeParse(bad).success, false);
  assert.equal(mailingDocumentSchema.safeParse({ version: 1, blocks: [{ id: "i", type: "image", src: "data:image/png;base64,AAAA", alt: "", link: "" }] }).success, false);
  const { html } = renderMailing({ version: 1, blocks: [{ id: "i", type: "image", src: "https://example.invalid/a.png", alt: "Bild \"x\"", link: "" }] }, footer);
  assert.match(html, /alt="Bild &quot;x&quot;"/);
});

test("a newsletter footer carries the way to say no; problems are named before sending", () => {
  const { html, text } = renderMailing({ version: 1, blocks: [{ id: "t", type: "text", text: "Hej" }] }, { ...footer, unsubscribe: "https://example.invalid/avboj" });
  assert.match(html, /Avböj fler nyhetsbrev/);
  assert.match(text, /Avböj fler nyhetsbrev: https:\/\/example\.invalid\/avboj/);
  assert.deepEqual(mailingProblems({ version: 1, blocks: [{ id: "d", type: "divider" }] }), ["Lägg till en rubrik eller text."]);
  assert.ok(mailingProblems({ version: 1, blocks: [{ id: "t", type: "text", text: "Hej" }, { id: "b", type: "button", label: "", url: "https://" }] }).includes("En knapp saknar text eller adress."));
});

test("old plain-text mailings and damaged bodies render as one text block", () => {
  assert.deepEqual(parseMailingBody("Hej!\n\nGammalt utskick").blocks, [{ id: "legacy", type: "text", text: "Hej!\n\nGammalt utskick" }]);
  assert.equal(parseMailingBody("{inte json").blocks[0].type, "text");
});

test("uploaded images are recognised by their first bytes, never by name", () => {
  assert.equal(imageKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])), "png");
  assert.equal(imageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "jpg");
  assert.equal(imageKind(new TextEncoder().encode("<svg onload=alert(1)>")), null);
});

// Bättre editor (2026-10-04): italic, links with their own text, lists, own HTML cleaned, and the web-version link.
test("text understands italic, links with their own text and lists", () => {
  const { html, text } = renderMailing({ version: 1, blocks: [
    { id: "t", type: "text", text: "Det är **viktigt** och *nytt*. Läs [vår guide](https://example.invalid/guide).\n\n- Första\n- Andra\n\n1. Ett\n2. Två" },
  ] }, footer);
  assert.match(html, /<em>nytt<\/em>/);
  assert.match(html, /<a href="https:\/\/example\.invalid\/guide" style="[^"]*">vår guide<\/a>/);
  assert.doesNotMatch(html, /\[vår guide\]/);
  assert.equal((html.match(/<a href="https:\/\/example\.invalid\/guide"/g) ?? []).length, 1, "the address is not linked twice");
  assert.match(html, /<ul[^>]*><li[^>]*>Första<\/li><li[^>]*>Andra<\/li><\/ul>/);
  assert.match(html, /<ol[^>]*><li[^>]*>Ett<\/li><li[^>]*>Två<\/li><\/ol>/);
  assert.match(text, /vår guide \(https:\/\/example\.invalid\/guide\)/);
  assert.doesNotMatch(text, /\*nytt\*/);
  assert.equal(mailingDocumentSchema.safeParse({ version: 1, blocks: [{ id: "t", type: "text", text: "[x](javascript:alert(1))" }] }).success, true);
  assert.doesNotMatch(renderMailing({ version: 1, blocks: [{ id: "t", type: "text", text: "[x](javascript:alert(1))" }] }, footer).html, /href="javascript/);
});

test("an HTML block is cleaned of scripts, handlers and dangerous addresses but keeps its layout", () => {
  const dirty = `<table><tr><td style="color:red" onclick="steal()"><a href="javascript:alert(1)">A</a><a href="https://example.invalid/ok">B</a></td></tr></table><script>alert(1)</script><iframe src="https://evil.invalid"></iframe><img src="data:image/png;base64,AA" onerror=alert(1)><form action="https://evil.invalid"><input name="p"></form>`;
  const cleaned = cleanMailingHtml(dirty);
  assert.doesNotMatch(cleaned, /script|iframe|onclick|onerror|javascript:|data:|<form|<input/i);
  assert.match(cleaned, /<td style="color:red">/);
  assert.match(cleaned, /href="https:\/\/example\.invalid\/ok"/);
  const { html, text } = renderMailing({ version: 1, blocks: [{ id: "h", type: "html", html: "<h2>Nyhet</h2><p>Hej &amp; välkommen</p>" }] }, footer);
  assert.match(html, /<h2>Nyhet<\/h2>/);
  assert.match(text, /Nyhet\nHej & välkommen/);
  assert.deepEqual(mailingProblems({ version: 1, blocks: [{ id: "h", type: "html", html: "<p>Hej</p>" }] }), []);
  assert.deepEqual(mailingProblems({ version: 1, blocks: [{ id: "h", type: "html", html: "<script>x</script>" }] }), ["Lägg till en rubrik eller text."]);
});

test("a sent mail links to its web version at the top and in the plain text", () => {
  const { html, text } = renderMailing({ version: 1, blocks: [{ id: "t", type: "text", text: "Hej" }] }, { ...footer, webVersion: "https://example.invalid/m/abc?t=x" });
  assert.match(html, /<a href="https:\/\/example\.invalid\/m\/abc\?t=x"[^>]*>Visa i webbläsaren<\/a>/);
  assert.match(text, /^Visa i webbläsaren: https:\/\/example\.invalid\/m\/abc\?t=x/);
  assert.doesNotMatch(renderMailing({ version: 1, blocks: [{ id: "t", type: "text", text: "Hej" }] }, footer).html, /Visa i webbläsaren/);
});
