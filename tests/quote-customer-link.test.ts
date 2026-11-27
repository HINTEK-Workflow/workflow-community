import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { acceptanceStatement, quoteAcceptanceMethod, QuoteAcceptanceError, registerQuoteAcceptanceMethod, simpleAcceptance } from "../lib/quotes/acceptance";
import {
  canAnswerQuoteLink, customerAnswerSchema, customerLinkSummaryState, decisionStatus, isQuoteLinkToken, PUBLIC_QUOTE_FORBIDDEN_KEYS, publicQuoteView, quoteContentFingerprint,
  quoteLinkState, quoteLinkStateText, sendQuoteLinkSchema, showsQuoteContents, type QuoteContent, type QuoteLinkStateInput,
} from "../lib/quotes/customer-link";
import { createQuoteLinkToken, hashQuoteLinkToken, quoteContentHash } from "../lib/quotes/customer-link-token";
import { parseQuoteNoticeKey, quoteAnswerNotifications, quoteNoticeKey, quoteNoticeRecipients } from "../lib/quotes/quote-notice";
import { noticeKey, noticeKindsOf, noticeStateText } from "../lib/workflow/notice-channels";

// Offert per e-post, steg E (2026-10-09). Made-up data.

const content = (patch: Partial<QuoteContent> = {}): QuoteContent => ({
  number: 12, version: 1, title: "Byte av elcentral", description: "Ny central i källaren.", validUntil: "2026-11-08", terms: "Betalning 30 dagar netto.",
  vatPercent: 25, customerType: "COMPANY", rotEnabled: false, rotPercent: null, rotCap: null, changeOfVersion: null,
  lines: [
    { kind: "MATERIAL", name: "Installationskabel", quantity: 10, unit: "m", unitPrice: 123.45, markupPercent: 37, rotLabour: false },
    { kind: "LABOUR", name: "Montör", quantity: 2, unit: "h", unitPrice: 650, markupPercent: null, rotLabour: true },
  ],
  ...patch,
});

test("a link token is 32 random bytes; only its sha256 is kept, and anything else is never hashed", () => {
  const token = createQuoteLinkToken();
  assert.equal(token.length, 43);
  assert.equal(Buffer.from(token, "base64url").length, 32);
  assert.ok(isQuoteLinkToken(token));
  assert.notEqual(createQuoteLinkToken(), token, "a new token each time");
  assert.equal(hashQuoteLinkToken(token), createHash("sha256").update(token).digest("hex"));
  assert.match(hashQuoteLinkToken(token)!, /^[0-9a-f]{64}$/);
  for (const bad of ["", "abc", `${token}x`, token.replace(/.$/, "!"), 12, null, undefined, "../../etc/passwd".padEnd(43, "a")]) assert.equal(hashQuoteLinkToken(bad), null, String(bad));
});

test("the content fingerprint changes with what the customer sees and binds the version", () => {
  const base = quoteContentHash(content());
  assert.equal(quoteContentHash(content()), base, "the same contents, the same hash");
  assert.notEqual(quoteContentHash(content({ version: 2 })), base, "another version");
  assert.notEqual(quoteContentHash(content({ title: "Annat" })), base);
  assert.notEqual(quoteContentHash(content({ validUntil: "2026-11-09" })), base);
  assert.notEqual(quoteContentHash(content({ vatPercent: 12 })), base);
  assert.notEqual(quoteContentHash(content({ lines: content().lines.map((line, index) => index === 0 ? { ...line, quantity: 11 } : line) })), base, "a changed quantity");
  assert.notEqual(quoteContentHash(content({ lines: content().lines.map((line, index) => index === 0 ? { ...line, markupPercent: 38 } : line) })), base, "a changed selling price");
  // Decimals as stored (strings or numbers) read the same.
  assert.equal(quoteContentHash(content({ lines: content().lines.map((line) => ({ ...line, quantity: String(line.quantity) })) })), base);
  assert.ok(quoteContentFingerprint(content()).startsWith('["quote-content-v1"'));
});

const stateInput = (patch: Partial<QuoteLinkStateInput> = {}): QuoteLinkStateInput => ({
  link: { quoteVersion: 1, contentHash: "h1", validUntil: "2026-11-08", revokedAt: null, usedAt: null },
  quote: { status: "SENT", version: 1, validUntil: "2026-11-08", superseded: false },
  response: null, contentHash: "h1", today: "2026-10-09",
  ...patch,
});

test("link states: open, expired, replaced by a version or changed contents, revoked, decided, answered, invalid", () => {
  assert.equal(quoteLinkState(stateInput()), "open");
  assert.ok(canAnswerQuoteLink("open"));
  assert.equal(quoteLinkState(stateInput({ today: "2026-11-08" })), "open", "valid through the date");
  assert.equal(quoteLinkState(stateInput({ today: "2026-11-09" })), "expired", "expires with the quote's validity");
  assert.equal(quoteLinkState(stateInput({ quote: { status: "EXPIRED", version: 1, validUntil: "2026-11-08", superseded: false } })), "expired");
  assert.equal(quoteLinkState(stateInput({ quote: { status: "SENT", version: 1, validUntil: "2026-11-08", superseded: true } })), "replaced", "a newer version");
  assert.equal(quoteLinkState(stateInput({ quote: { status: "SENT", version: 2, validUntil: "2026-11-08", superseded: false } })), "replaced", "another version than the link's");
  assert.equal(quoteLinkState(stateInput({ contentHash: "h2" })), "replaced", "changed contents");
  assert.equal(quoteLinkState(stateInput({ link: { quoteVersion: 1, contentHash: "h1", validUntil: "2026-11-08", revokedAt: new Date(), usedAt: null } })), "revoked", "a newer link");
  assert.equal(quoteLinkState(stateInput({ quote: { status: "ACCEPTED", version: 1, validUntil: "2026-11-08", superseded: false } })), "decided", "the company marked it");
  assert.equal(quoteLinkState(stateInput({ quote: { status: "ACCEPTED", version: 1, validUntil: "2026-11-08", superseded: false }, response: { decision: "ACCEPTED", viaThisLink: false } })), "decided", "answered through another link");
  assert.equal(quoteLinkState(stateInput({ quote: { status: "ACCEPTED", version: 1, validUntil: "2026-11-08", superseded: true }, response: { decision: "ACCEPTED", viaThisLink: true }, link: { quoteVersion: 1, contentHash: "h1", validUntil: "2026-11-08", usedAt: new Date() } })), "accepted", "the answer through this link stays, even after an ÄTA");
  assert.equal(quoteLinkState(stateInput({ quote: { status: "DECLINED", version: 1, validUntil: "2026-11-08", superseded: false }, response: { decision: "DECLINED", viaThisLink: true }, today: "2027-01-01" })), "declined");
  assert.equal(quoteLinkState(stateInput({ link: null })), "invalid");
  assert.equal(quoteLinkState(stateInput({ quote: { status: "DRAFT", version: 1, validUntil: "2026-11-08", superseded: false } })), "invalid");
  for (const state of ["accepted", "declined", "decided", "replaced", "revoked", "expired", "invalid"] as const) {
    assert.equal(canAnswerQuoteLink(state), false, state);
    assert.ok(quoteLinkStateText(state, { company: "Alfa El", validUntil: "2026-11-08" }).length > 10, state);
  }
  assert.deepEqual(["open", "accepted", "declined", "decided", "replaced", "revoked", "expired", "invalid"].filter((state) => showsQuoteContents(state as never)), ["open", "accepted", "declined"]);
});

test("the customer's decision moves Skickad to Accepterad or Avböjd", () => {
  assert.equal(decisionStatus("ACCEPTED"), "ACCEPTED");
  assert.equal(decisionStatus("DECLINED"), "DECLINED");
  assert.equal(customerLinkSummaryState({ usedAt: null, revokedAt: null, validUntil: "2026-11-08", quoteVersion: 1 }, { version: 1, superseded: false }, "2026-10-09"), "active");
  assert.equal(customerLinkSummaryState({ usedAt: new Date(), revokedAt: null, validUntil: "2026-11-08", quoteVersion: 1 }, { version: 1, superseded: false }, "2026-10-09"), "used");
  assert.equal(customerLinkSummaryState({ usedAt: null, revokedAt: new Date(), validUntil: "2026-11-08", quoteVersion: 1 }, { version: 1, superseded: false }, "2026-10-09"), "revoked");
  assert.equal(customerLinkSummaryState({ usedAt: null, revokedAt: null, validUntil: "2026-10-08", quoteVersion: 1 }, { version: 1, superseded: false }, "2026-10-09"), "expired");
  assert.equal(customerLinkSummaryState({ usedAt: null, revokedAt: null, validUntil: "2026-11-08", quoteVersion: 1 }, { version: 1, superseded: true }, "2026-10-09"), "replaced");
});

/** Every key anywhere in a value. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, into));
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { into.add(key); keysOf(item, into); }
  return into;
}

test("the customer's quote is an allow-list: no purchase price, markup, cost, margin, notes or internal fields", () => {
  // The source carries everything internal a careless caller could pass; none of it may come out.
  const source = {
    quote: { ...content({ customerType: "PRIVATE", rotEnabled: true, rotPercent: 30, rotCap: 50000 }), sentAt: new Date("2026-10-09T08:00:00Z"),
      id: "q1", organizationId: "org-secret", revision: 7, createdById: "user-secret", notes: "intern anteckning: låg marginal", purchase: 1234.5, margin: 999, workOrderId: "wo1", projectId: "p1",
      lines: content().lines.map((line) => ({ ...line, catalogue: { supplierName: "Grossist AB", unitPrice: "123,45" }, cost: 1234.5 })) },
    customerName: "Kund Alfa", placeName: "Elcentral", company: { name: "Alfa El", email: "info@example.invalid", internal: "x" }, senderName: "Elin",
    tokenHash: "abc", ipAddress: "10.0.0.1",
  } as unknown as Parameters<typeof publicQuoteView>[0];
  const view = publicQuoteView(source);
  const keys = keysOf(view);
  for (const forbidden of PUBLIC_QUOTE_FORBIDDEN_KEYS) assert.ok(!keys.has(forbidden), `the key ${forbidden} must never reach the customer`);
  // The customer's own contact person and address (2026-10-10) are allowed; its notes, e-mail and phone never are.
  const allowedTop = ["label", "title", "description", "validUntil", "terms", "sentDate", "customerType", "customerName", "placeName", "customerContact", "customerAddress", "company", "lines", "totals", "change", "reverseVat", "buyerVatNumber"];
  assert.deepEqual(Object.keys(view).sort(), [...allowedTop].sort(), "exactly the allowed fields");
  assert.deepEqual(Object.keys(view.company).sort(), ["email", "name", "senderName"]);
  assert.deepEqual(Object.keys(view.lines[0]).sort(), ["amount", "kind", "kindLabel", "name", "price", "quantity", "rotLabour", "unit"]);
  const json = JSON.stringify(view);
  for (const secret of ["123.45", "123,45", "Grossist", "org-secret", "user-secret", "intern anteckning", "1234.5", "10.0.0.1", "\"37\""]) assert.ok(!json.includes(secret), `"${secret}" leaked`);
  // Selling prices only: 123,45 × 1,37 = 169,13 per metre; 10 m = 1 691,27 (rounded per line, as the PDF).
  assert.equal(view.lines[0].price, 169.13);
  assert.equal(view.lines[0].amount, 1691.27);
  assert.equal(view.totals.net, 1691.27 + 1300);
  assert.equal(view.totals.rotPercent, 30);
  assert.ok(view.totals.rot > 0 && view.totals.toPay < view.totals.gross, "ROT is shown for a private customer");
  assert.equal(view.sentDate, "2026-10-09");
  assert.equal(view.lines[1].rotLabour, true);
});

test("an ÄTA shows its changes at selling prices", () => {
  const view = publicQuoteView({
    quote: { ...content({ version: 2, changeOfVersion: 1, lines: [{ kind: "MATERIAL", name: "Installationskabel", quantity: 15, unit: "m", unitPrice: 100, markupPercent: 10 }] }), sentAt: null },
    baseLines: [{ kind: "MATERIAL", name: "Installationskabel", quantity: 10, unit: "m", unitPrice: 100, markupPercent: 10 }],
    customerName: "", placeName: "", company: { name: "Alfa El", email: "" }, senderName: "",
  });
  assert.equal(view.change?.ofVersion, 1);
  assert.deepEqual(view.change?.lines.map((line) => [line.change, line.quantityBefore, line.quantityAfter, line.amountDelta]), [["changed", 10, 15, 550]]);
  assert.ok(!keysOf(view).has("unitPrice"));
});

test("the simple method: a name and the ticked statement; a later method plugs in by id", async () => {
  const subject = { label: "O-0012", title: "Byte av elcentral", company: "Alfa El" };
  assert.equal(quoteAcceptanceMethod("simple"), simpleAcceptance);
  assert.equal(quoteAcceptanceMethod("bankid"), null, "BankID is not built");
  assert.equal(quoteAcceptanceMethod("unknown"), null);
  await assert.rejects(simpleAcceptance.verify({ name: "Anna Andersson", agree: false }, subject), QuoteAcceptanceError, "the box must be ticked");
  await assert.rejects(simpleAcceptance.verify({ name: " ", agree: true }, subject), QuoteAcceptanceError, "a name is needed");
  const proof = await simpleAcceptance.verify({ name: "  Anna\n Andersson ", agree: true }, subject);
  assert.equal(proof.signerName, "Anna Andersson");
  assert.equal(proof.evidence.statement, acceptanceStatement(subject));
  assert.match(proof.evidence.statement, /O-0012.*Alfa El/);
  assert.throws(() => registerQuoteAcceptanceMethod({ id: "fax" as never, label: "Fax", kind: "external", verify: async () => ({ signerName: "", evidence: {} }) }), /Okänd/);
});

test("input: the answer and the sending are validated", () => {
  const token = createQuoteLinkToken();
  assert.equal(customerAnswerSchema.parse({ token, decision: "accept", name: "Anna", agree: true }).decision, "accept");
  assert.equal(customerAnswerSchema.parse({ token, decision: "decline" }).decision, "decline");
  assert.throws(() => customerAnswerSchema.parse({ token: "kort", decision: "accept" }));
  assert.throws(() => customerAnswerSchema.parse({ token, decision: "maybe" }));
  assert.throws(() => customerAnswerSchema.parse({ token, decision: "decline", reason: "x".repeat(1001) }));
  assert.equal(sendQuoteLinkSchema.parse({ email: "kund@example.invalid" }).message, "");
  assert.throws(() => sendQuoteLinkSchema.parse({ email: "inte en adress" }), /e-postadress/);
});

test("notices: sender, author and admins once; the bell's item and its e-mail key", () => {
  const active = new Set(["sender", "author", "admin1", "admin2"]);
  assert.deepEqual(quoteNoticeRecipients({ sentById: "sender", createdById: "author", adminIds: ["admin1", "sender", "admin2", "gone"], activeMemberIds: active }), ["sender", "author", "admin1", "admin2"]);
  assert.deepEqual(quoteNoticeRecipients({ sentById: "left", createdById: null, adminIds: [], activeMemberIds: active }), [], "someone who left gets nothing");
  const key = quoteNoticeKey("q1", "ACCEPTED");
  assert.deepEqual(parseQuoteNoticeKey(key), { quoteId: "q1", decision: "ACCEPTED" });
  assert.equal(parseQuoteNoticeKey("QUOTE:q1|MAYBE"), null);
  const at = new Date("2026-10-09T10:00:00Z");
  const items = quoteAnswerNotifications([
    { key, createdAt: at, quote: { id: "q1", number: 12, version: 1, title: "Byte av elcentral", response: { decision: "ACCEPTED", signerName: "Anna\nAndersson", createdAt: at } } },
    { key: quoteNoticeKey("q2", "DECLINED"), createdAt: at, quote: null },
    { key: quoteNoticeKey("q3", "DECLINED"), createdAt: at, quote: { id: "q3", number: 13, version: 1, title: "X", response: { decision: "ACCEPTED", signerName: "", createdAt: at } } },
  ]);
  assert.equal(items.length, 1, "a notice whose quote or answer does not match is not shown");
  assert.equal(items[0].kind, "QUOTE");
  assert.equal(items[0].href, "/?view=quote&quoteId=q1");
  assert.match(items[0].detail ?? "", /Anna Andersson.*accepterat offert O-0012/);
  assert.deepEqual(noticeKindsOf(items[0]), ["QUOTES"]);
  assert.equal(noticeKey(items[0]), items[0].id, "sent once");
  assert.equal(noticeStateText(items[0], "2026-10-09"), "Accepterad av kunden");
});
