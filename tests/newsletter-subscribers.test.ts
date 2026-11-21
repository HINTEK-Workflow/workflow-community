// Följ nyhetsbrevet and Även som nyhetsbrev (2026-11-12): the pure rules – the address, the domain's mail records, the
// form's signed time stamp, the token, the recipients once per address, the post as a mail and the schedule's hash. The rules
// that need the database (no enumeration, single use, expiry, the cleanup, once per post) are in
// tests/newsletter-subscribers.integration.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkStamp, domainTakesMail, issueStamp, MIN_FILL_MS, MAX_STAMP_AGE_MS, newToken, normalizeEmail, tokenHash, TOKEN_PATTERN, buildConfirmationEmail, type MailResolver } from "../lib/mail/newsletter-subscribers";
import { dedupeRecipients, subscriberUnsubscribeUrl, unsubscribeUrl, validSubscriberUnsubscribe, validUnsubscribe } from "../lib/mail/mailings";
import { postNewsletterDocument, resolvePostMail, withoutHashtags } from "../lib/mail/post-newsletter-mail";
import { postContentHash } from "../lib/schedule/model";
import { PUBLIC_SITE_POST_PATHS } from "../lib/public-site";
import { RATE_RULES } from "../lib/security/rate-limit";

test("an address is trimmed and lower-cased; junk, IP literals and reserved names are refused", () => {
  assert.deepEqual(normalizeEmail("  Anna.Berg@Exempel.SE "), { ok: true, email: "anna.berg@exempel.se", domain: "exempel.se" });
  assert.equal((normalizeEmail("a+news@företag.se") as { domain: string }).domain, "xn--fretag-wxa.se");
  for (const bad of ["", "   ", "anna", "anna@", "@exempel.se", "anna@@exempel.se", "an na@exempel.se", "anna@exempel", "anna@[127.0.0.1]", "anna@127.0.0.1",
    "anna@localhost", "anna@server.local", "anna@example.test", "anna@x.invalid", ".anna@exempel.se", "anna.@exempel.se", "an..na@exempel.se",
    "anna@-exempel.se", "anna@exempel-.se", "anna@exempel.s", "anna@exempel.123", `${"a".repeat(65)}@exempel.se`, `a@${"b".repeat(250)}.se`, 42, null, "<a>@exempel.se"])
    assert.equal(normalizeEmail(bad).ok, false, `refused: ${String(bad)}`);
});

const resolver = (answers: { mx?: unknown; a?: unknown; aaaa?: unknown }): MailResolver => {
  const answer = (value: unknown) => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value as never));
  const missing = Object.assign(new Error("none"), { code: "ENODATA" });
  return { resolveMx: () => answer(answers.mx ?? missing), resolve4: () => answer(answers.a ?? missing), resolve6: () => answer(answers.aaaa ?? missing) };
};

test("the domain must take mail: MX, or an address record without MX; a null MX or nothing refuses; no answer is unknown", async () => {
  assert.equal(await domainTakesMail("exempel.se", resolver({ mx: [{ exchange: "mx.exempel.se", priority: 10 }] })), "yes");
  assert.equal(await domainTakesMail("exempel.se", resolver({ a: ["192.0.2.1"] })), "yes");
  assert.equal(await domainTakesMail("exempel.se", resolver({ mx: [{ exchange: ".", priority: 0 }] })), "no");
  assert.equal(await domainTakesMail("exempel.se", resolver({})), "no");
  assert.equal(await domainTakesMail("exempel.se", resolver({ mx: Object.assign(new Error("x"), { code: "ENOTFOUND" }) })), "no");
  assert.equal(await domainTakesMail("exempel.se", resolver({ mx: Object.assign(new Error("x"), { code: "ESERVFAIL" }) })), "unknown");
  const slow: MailResolver = { resolveMx: () => new Promise(() => undefined), resolve4: () => new Promise(() => undefined), resolve6: () => new Promise(() => undefined) };
  assert.equal(await domainTakesMail("exempel.se", slow, 20), "unknown");
});

test("the form's time stamp is signed, at least two seconds old and not too old", () => {
  const now = 1_800_000_000_000;
  const stamp = issueStamp(now);
  assert.equal(checkStamp(stamp, now + 500), "fast");
  assert.equal(checkStamp(stamp, now + MIN_FILL_MS), "ok");
  assert.equal(checkStamp(stamp, now + MAX_STAMP_AGE_MS + 1), "invalid");
  const [issued, signature] = stamp.split(".");
  assert.equal(checkStamp(`${Number(issued) - 10_000}.${signature}`, now), "invalid", "a changed time breaks the signature");
  for (const bad of [undefined, "", "abc", "123", `${now}.`, `${now}.${"x".repeat(43)}`, 7]) assert.equal(checkStamp(bad, now), "invalid");
});

test("the confirmation token is 32 random bytes; only its sha256 is stored; the mail carries the link and its 48 hours", () => {
  const token = newToken();
  assert.match(token, TOKEN_PATTERN);
  assert.notEqual(newToken(), token);
  assert.match(tokenHash(token), /^[a-f0-9]{64}$/);
  assert.notEqual(tokenHash(token), token);
  const mail = buildConfirmationEmail(`http://localhost:3001/newsletter/confirm?t=${token}`);
  assert.match(mail.text, /48 timmar/);
  assert.ok(mail.html.includes(token));
});

test("the subscriber's way to say no is signed apart from a user's", () => {
  const subscriber = new URL(subscriberUnsubscribeUrl("sub1"));
  assert.equal(subscriber.searchParams.get("s"), "sub1");
  assert.ok(validSubscriberUnsubscribe("sub1", subscriber.searchParams.get("t")!));
  assert.equal(validSubscriberUnsubscribe("sub2", subscriber.searchParams.get("t")!), false);
  const user = new URL(unsubscribeUrl("sub1"));
  assert.equal(validSubscriberUnsubscribe("sub1", user.searchParams.get("t")!), false, "a user's token is no subscriber's");
  assert.equal(validUnsubscribe("sub1", subscriber.searchParams.get("t")!), false, "and the other way round");
});

test("a newsletter's recipients: each address once, the user before the subscriber", () => {
  const rows = dedupeRecipients([
    { id: "u1", subscriberId: null, email: "Anna@Exempel.se" },
    { id: null, subscriberId: "s1", email: "anna@exempel.se" },
    { id: null, subscriberId: "s2", email: "bo@exempel.se" },
    { id: null, subscriberId: "s3", email: " BO@exempel.se" },
  ]);
  assert.deepEqual(rows.map((row) => row.id ?? row.subscriberId), ["u1", "s2"]);
});

test("the public form is limited per IP and in total, and only it is opened on the public site", () => {
  assert.equal(RATE_RULES.newsletterIp.limit, 5);
  assert.equal(RATE_RULES.newsletterIp.windowSeconds, 3600);
  assert.ok(RATE_RULES.newsletterMailHour.limit <= 100 && RATE_RULES.newsletterMailDay.limit <= 500);
  assert.ok((PUBLIC_SITE_POST_PATHS as readonly string[]).includes("/api/newsletter/subscribe"));
  assert.ok(!(PUBLIC_SITE_POST_PATHS as readonly string[]).includes("/api/newsletter/confirm"), "confirming happens on the app's address");
});

test("a post as a newsletter: the subject, picture (linked), text without hashtags and a button, in the newsletter's own blocks", () => {
  const post = { id: "p", heading: "Nyhet", body: "Bildtext", caption: "Inläggets text #workflow\n\n#el #hintek", link: "https://exempel.se/a" };
  const mail = resolvePostMail(post, "Nytt");
  assert.equal(mail.text, "Inläggets text");
  assert.deepEqual(mail.follows, { subject: true, text: true, link: true, image: true });
  const document = postNewsletterDocument(mail, "https://app.example/api/mailing-images/x.jpg");
  assert.deepEqual(document.blocks.map((block) => block.type), ["heading", "image", "text", "button"]);
  assert.equal((document.blocks[1] as { link: string }).link, "https://exempel.se/a");
  assert.equal((document.blocks[2] as { text: string }).text, "Inläggets text");
  assert.ok(!JSON.stringify(document).includes("#"), "hashtags never go into the mail");
  // Own fields: they win until cleared; the picture can be left out.
  const own = resolvePostMail({ ...post, newsletterMail: { subject: "Eget ämne", text: "Egen text", image: false } }, "Nytt");
  assert.equal(own.subject, "Eget ämne");
  assert.equal(own.text, "Egen text");
  assert.deepEqual(own.follows, { subject: false, text: false, link: true, image: false });
  assert.deepEqual(postNewsletterDocument(own, "https://app.example/x.jpg").blocks.map((block) => block.type), ["heading", "text", "button"]);
  assert.equal(resolvePostMail({ ...post, newsletterMail: { nonsense: 1 } }, "Nytt").subject, "Nyhet", "unreadable own fields follow the post");
  assert.equal(resolvePostMail({ ...post, heading: "" , caption: "" }, "Nytt från X").subject, "Nytt från X");
  assert.equal(withoutHashtags("Hej #a världen #b"), "Hej världen");
});

test("the schedule's approved content: an unticked newsletter keeps old hashes, ticking it asks for a new approval", () => {
  const post = { heading: "H", body: "B", caption: "C", link: null, template: "color", toFacebook: true, toInstagram: false, backgroundSource: null, background: null };
  const before = postContentHash(post);
  assert.equal(postContentHash({ ...post, toNewsletter: false }), before);
  const ticked = postContentHash({ ...post, toNewsletter: true });
  assert.notEqual(ticked, before);
  assert.equal(postContentHash({ ...post, newsletterMail: { subject: "Eget" } }), before, "own mail fields count only when ticked");
  assert.notEqual(postContentHash({ ...post, toNewsletter: true, newsletterMail: { subject: "Eget ämne" } }), ticked, "the mail as shown is approved");
  assert.equal(postContentHash({ ...post, toNewsletter: true, newsletterMail: { subject: "H" } }), postContentHash({ ...post, toNewsletter: true, heading: "H" }), "the hash covers what is sent, not how");
});
