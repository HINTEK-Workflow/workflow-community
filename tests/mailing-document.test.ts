import assert from "node:assert/strict";
import test from "node:test";
import { mailingDocumentSchema, mailingProblems, parseMailingBody, renderMailing, type MailingDocument } from "../lib/mail/mailing-document";
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
