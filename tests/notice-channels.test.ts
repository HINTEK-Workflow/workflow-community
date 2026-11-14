import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { availableNoticeKinds, NOTICE_KINDS, normalizeNoticeKinds, noticeKey, noticeKindsOf, noticePreferenceInput, noticesToSend, noticeStage, noticeStateText } from "../lib/workflow/notice-channels";
import { buildNoticeDigest, buildPushNotice, DIGEST_MAX_ITEMS, digestSubject, noticeText, type DigestItem } from "../lib/workflow/notice-digest";
import { taskNotifications, type NotificationSource, type TaskNotification } from "../lib/workflow/task-notifications";
import { mailingDocumentSchema, mailingProblems } from "../lib/mail/mailing-document";
import { effectivePushSubject, openPushKey, parseStoredPush, publicPushSettings, pushHasKeys, pushSettingsInput, sealPushKey } from "../lib/push/settings";

// Notiser per e-post och push (2026-10-07): per person, opt-in, never prefilled; one message with what is new; one
// mark per notice, channel and person; the bell's own notices, so a member's are their own.
const today = "2026-10-08";
const task = (id: string, dueDate = "", extra: Partial<NotificationSource> = {}): NotificationSource => ({ id, title: id, dueDate, kind: "WORK_ORDER", status: "PLANNED", ...extra });
const notices = taskNotifications([
  task("late", "2026-10-05"), task("soon", "2026-10-10"), task("both", "2026-10-06", { status: "NEEDS_ACTION" }),
  task("action", "", { status: "NEEDS_ACTION" }), task("urgent", "", { urgent: true }), task("far", "2026-11-30"),
], today);
const byId = (id: string) => notices.find((item) => item.id === `WORK_ORDER:${id}`)!;
const round: TaskNotification = { id: "ROUND:s1:2026-10-08", title: "Skyddsrond", kind: "ROUND", href: "/?view=rounds", dueDate: "2026-10-08", deadline: "DUE_SOON", needsAction: false };
const followUp: TaskNotification = { id: "FOLLOW_UP:w1", title: "Protokoll X", kind: "FOLLOW_UP", href: "/?view=workflow_task&taskId=p1&taskType=FORM", dueDate: "2026-10-07", deadline: null, needsAction: true };
const self: TaskNotification = { id: "self-inspection:review", title: "Årlig översyn", kind: "SELF_INSPECTION", href: "/?view=self_inspection", dueDate: "2026-10-12", deadline: "DUE_SOON", needsAction: false };
const draft: TaskNotification = { id: "NEWSLETTER_DRAFT:m1", title: "Veckobrev väntar på godkännande", kind: "NEWSLETTER_DRAFT", href: "/?view=mailings", dueDate: "2026-10-08", deadline: null, needsAction: true };
const allKinds = NOTICE_KINDS.map((kind) => kind.key);

test("nothing is chosen by default: no kind, no notice", () => {
  assert.deepEqual(noticesToSend([...notices, round, followUp, self, draft], [], new Set()), []);
  assert.equal(noticePreferenceInput.safeParse({ email: false, kinds: [] }).success, true);
  assert.equal(noticePreferenceInput.safeParse({ email: true }).success, false, "the choice is always explicit");
  assert.equal(noticePreferenceInput.safeParse({ email: true, kinds: ["SPAM"] }).success, false, "an unknown kind is refused");
});

test("every kind of notice in the bell belongs to a kind a person can choose", () => {
  assert.deepEqual(noticeKindsOf(byId("late")), ["DEADLINES"]);
  assert.deepEqual(noticeKindsOf(byId("soon")), ["DEADLINES"]);
  assert.deepEqual(noticeKindsOf(byId("action")), ["ACTION"]);
  assert.deepEqual(noticeKindsOf(byId("both")), ["DEADLINES", "ACTION"]);
  assert.deepEqual(noticeKindsOf(byId("urgent")), ["URGENT"]);
  assert.deepEqual(noticeKindsOf(round), ["ROUNDS"]);
  assert.deepEqual(noticeKindsOf(followUp), ["FOLLOW_UP"]);
  assert.deepEqual(noticeKindsOf(self), ["SELF_INSPECTION"]);
  assert.deepEqual(noticeKindsOf(draft), ["NEWSLETTER_DRAFT"]);
  assert.equal(byId("far"), undefined, "a due date beyond the bell's week is no notice at all");
});

test("only the kinds the person chose are sent, and a notice is sent once", () => {
  const all = [...notices, round, followUp, self];
  const onlyRounds = noticesToSend(all, ["ROUNDS"], new Set());
  assert.deepEqual(onlyRounds.map((item) => item.id), ["ROUND:s1:2026-10-08"]);
  const deadlines = noticesToSend(all, ["DEADLINES"], new Set());
  assert.deepEqual(deadlines.map((item) => item.id).sort(), ["WORK_ORDER:both", "WORK_ORDER:late", "WORK_ORDER:soon"]);
  // Chosen kinds that include the task twice (deadline and action) still send it once.
  const both = noticesToSend([byId("both")], ["DEADLINES", "ACTION"], new Set());
  assert.equal(both.length, 1);
  // A notice that was sent is not sent again, whatever the kinds.
  const sent = new Set(onlyRounds.map(noticeKey));
  assert.deepEqual(noticesToSend(all, ["ROUNDS"], sent), []);
  assert.equal(noticesToSend(all, allKinds, sent).some((item) => item.id === round.id), false);
  // The same list twice in one run is still one notice.
  assert.equal(noticesToSend([round, round], ["ROUNDS"], new Set()).length, 1);
});

test("a notice that becomes more pressing, or gets a new date, is a new notice; the same one is not", () => {
  const soon = { ...byId("soon") };
  assert.equal(noticeStage(soon), "soon");
  const overdue = { ...soon, deadline: "OVERDUE" as const };
  assert.equal(noticeStage(overdue), "overdue");
  assert.notEqual(noticeKey(soon), noticeKey(overdue), "told it was due soon, told again when it is late");
  assert.notEqual(noticeKey(soon), noticeKey({ ...soon, dueDate: "2026-10-11" }), "a moved date is new");
  const renamed = { ...soon, title: "Ett annat namn" };
  assert.equal(noticeKey(soon), noticeKey(renamed), "the same notice under a new title is the same notice");
  assert.equal(noticeStage(byId("urgent")), "urgent");
  assert.equal(noticeStage(byId("action")), "action");
  // A rond has its own day in the key, so each occurrence is told once.
  assert.notEqual(noticeKey(round), noticeKey({ ...round, id: "ROUND:s1:2026-10-15", dueDate: "2026-10-15" }));
  // A veckobrev draft is told once per draft.
  assert.equal(noticeKey(draft), "NEWSLETTER_DRAFT:m1|action|2026-10-08");
});

test("the veckobrev notice is only a choice for the installation's superadmin", () => {
  assert.equal(availableNoticeKinds({ superadmin: false }).some((kind) => kind.key === "NEWSLETTER_DRAFT"), false);
  assert.equal(availableNoticeKinds({ superadmin: true }).some((kind) => kind.key === "NEWSLETTER_DRAFT"), true);
  const offered = availableNoticeKinds({ superadmin: false }).map((kind) => kind.key);
  // A stored kind that is no longer offered (or unknown) is dropped, in the list's order, once each.
  assert.deepEqual(normalizeNoticeKinds(["ROUNDS", "NEWSLETTER_DRAFT", "DEADLINES", "ROUNDS", "x", 5], offered), ["DEADLINES", "ROUNDS"]);
  assert.deepEqual(normalizeNoticeKinds(null, offered), []);
  assert.deepEqual(normalizeNoticeKinds(undefined), []);
});

test("the notice says in words what is the matter", () => {
  assert.equal(noticeStateText(byId("late"), today), "Förfallen (2026-10-05)");
  assert.equal(noticeStateText(byId("soon"), today), "Klart senast 2026-10-10");
  assert.equal(noticeStateText({ ...byId("soon"), dueDate: today }, today), "Förfaller idag");
  assert.equal(noticeStateText(byId("urgent"), today), "Akut arbetsorder");
  assert.equal(noticeStateText(byId("action"), today), "Behöver åtgärdas");
  assert.equal(noticeStateText(round, today), "Ska göras idag");
  assert.equal(noticeStateText({ ...round, deadline: "OVERDUE" }, today), "Missad rond (2026-10-08)");
  assert.equal(noticeStateText(followUp, today), "Följ upp avvikelsen");
  assert.equal(noticeStateText(draft, today), "Väntar på godkännande");
});

const item = (notice: TaskNotification, organizationName = "Elbolaget AB"): DigestItem => ({ organizationName, item: notice });
const appUrl = "https://workflow.example.test";

test("the e-mail is one valid mail with every new notice, linked, and says how to change the choice", () => {
  const digest = buildNoticeDigest({ items: [item(byId("late")), item(round), item(followUp)], today, name: "Workflow", appUrl, recipientName: "Anna Andersson" });
  assert.equal(digest.subject, "3 nya påminnelser i Workflow");
  mailingDocumentSchema.parse(digest.document);
  assert.deepEqual(mailingProblems(digest.document), []);
  for (const part of ["Hej Anna!", "late", "Förfallen (2026-10-05)", "Skyddsrond", "Ska göras idag", "Protokoll X", "Öppna Notiser", "Mina inställningar", "https://workflow.example.test/?view=notifications"])
    assert.ok(digest.text.includes(part) || digest.html.includes(part), part);
  assert.ok(digest.html.includes("https://workflow.example.test/?view=workflow_task&amp;taskId=late&amp;taskType=WORK_ORDER") || digest.html.includes("taskId=late"), "each notice links to its own page");
  assert.equal(digest.html.includes("Avböj fler nyhetsbrev"), false, "no newsletter footer");
  assert.equal(digestSubject(1, "Workflow"), "1 ny påminnelse i Workflow");
});

test("a person in several companies sees which company each notice is from; one company needs no heading", () => {
  const one = buildNoticeDigest({ items: [item(byId("late")), item(round)], today, name: "Workflow", appUrl });
  assert.equal(one.document.blocks.filter((block) => block.type === "heading" && block.size === "medium").length, 0);
  const two = buildNoticeDigest({ items: [item(byId("late"), "Elbolaget AB"), item(round, "Kabelfirman AB")], today, name: "Workflow", appUrl });
  assert.deepEqual(two.document.blocks.filter((block) => block.type === "heading" && block.size === "medium").map((block) => "text" in block ? block.text : ""), ["Elbolaget AB", "Kabelfirman AB"]);
});

test("a long list is cut at twenty with the rest counted, and titles cannot break the mail's formatting", () => {
  const many = Array.from({ length: 27 }, (_, index) => item({ ...byId("late"), id: `WORK_ORDER:t${index}`, title: `Uppgift ${index}` }));
  const digest = buildNoticeDigest({ items: many, today, name: "Workflow", appUrl });
  assert.equal(digest.subject, "27 nya påminnelser i Workflow");
  assert.equal((digest.text.match(/Uppgift \d+/g) ?? []).length, DIGEST_MAX_ITEMS);
  assert.match(digest.text, /… och 7 till\./);
  const nasty = buildNoticeDigest({ items: [item({ ...byId("late"), title: "**Fet** [länk](https://evil.example) <b>x</b>\nny rad" })], today, name: "Workflow", appUrl });
  assert.equal(nasty.html.includes("<b>x</b>"), false, "html in a title is escaped");
  assert.equal(/href="https?:\/\/evil\.example/.test(nasty.html), false, "a title cannot add a link");
  assert.equal(noticeText("a\n\nb  (c) [d] *e*"), "a b c d e");
  assert.equal(noticeText("Se https://exempel.test/x och mailto:a@b.test"), "Se exempel.test/x och a@b.test");
});

test("the push is one short message: the notice itself for one, a count for several, and a path inside the app", () => {
  const one = buildPushNotice([item(byId("late"))], today, "Workflow");
  assert.deepEqual(one, { title: "Workflow", body: "late – Förfallen (2026-10-05)", url: "/?view=workflow_task&taskId=late&taskType=WORK_ORDER", tag: "notice:WORK_ORDER:late" });
  const several = buildPushNotice([item(byId("late")), item(round), item(followUp)], today, "Workflow");
  assert.equal(several.body, "3 nya påminnelser: late, Skyddsrond med flera");
  assert.equal(several.url, "/?view=notifications");
  assert.ok(JSON.stringify(several).length < 500);
  for (const notice of [one, several]) assert.ok(notice.url.startsWith("/"), "never an outside address");
});

// The service worker that shows the push (public/sw.js) is plain script; run it against a stand-in for its scope.
function serviceWorker() {
  const handlers: Record<string, (event: unknown) => unknown> = {};
  const calls = { shown: [] as { title: string; options: Record<string, unknown> }[], opened: [] as string[], navigated: [] as string[], focused: 0, closed: 0 };
  const scope = {
    location: { origin: "https://workflow.example.test" },
    addEventListener: (type: string, handler: (event: unknown) => unknown) => { handlers[type] = handler; },
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => { calls.shown.push({ title, options }); } },
    clients: { openWindow: async (url: string) => { calls.opened.push(url); }, matchAll: async () => [] as unknown[], claim: async () => undefined },
    skipWaiting: () => undefined,
  };
  new Function("self", "caches", "fetch", "URL", readFileSync("public/sw.js", "utf8"))(scope, {}, () => undefined, URL);
  return { handlers, calls, scope };
}

test("the service worker shows the push and opens only a page of this app", async () => {
  const { handlers, calls, scope } = serviceWorker();
  assert.equal(typeof handlers.push, "function");
  assert.equal(typeof handlers.notificationclick, "function");
  let waited: Promise<unknown> | undefined;
  await (async () => {
    handlers.push({ data: { json: () => ({ title: "Workflow", body: "En ny påminnelse", url: "/?view=notifications", tag: "notices" }), text: () => "" }, waitUntil: (promise: Promise<unknown>) => { waited = promise; } });
    await waited;
  })();
  assert.equal(calls.shown[0].title, "Workflow");
  assert.equal(calls.shown[0].options.body, "En ny påminnelse");
  assert.equal((calls.shown[0].options.data as { url: string }).url, "/?view=notifications");
  assert.equal(calls.shown[0].options.tag, "notices");
  // A message that is not JSON still shows something (a push must always show a notice).
  handlers.push({ data: { json: () => { throw new Error("no json"); }, text: () => "Bara text" }, waitUntil: (promise: Promise<unknown>) => { waited = promise; } });
  await waited;
  assert.equal(calls.shown[1].options.body, "Bara text");
  handlers.push({ data: null, waitUntil: (promise: Promise<unknown>) => { waited = promise; } });
  await waited;
  assert.equal(calls.shown[2].title, "Workflow");
  // A tap with no open window opens the notice's page; a foreign address leads to the start page instead.
  for (const [url, expected] of [["/?view=tasks", "https://workflow.example.test/?view=tasks"], ["https://evil.example/phish", "https://workflow.example.test/"], ["javascript:alert(1)", "https://workflow.example.test/"]] as const) {
    handlers.notificationclick({ notification: { close: () => { calls.closed++; }, data: { url } }, waitUntil: (promise: Promise<unknown>) => { waited = promise; } });
    await waited;
    assert.equal(calls.opened.at(-1), expected, url);
  }
  assert.equal(calls.closed, 3);
  // With an open window of the app, that window is focused and taken to the page.
  scope.clients.matchAll = async () => [{ url: "https://workflow.example.test/?view=stats", focus: async () => ({ navigate: async (url: string) => { calls.navigated.push(url); } }) }];
  handlers.notificationclick({ notification: { close: () => undefined, data: { url: "/?view=rounds" } }, waitUntil: (promise: Promise<unknown>) => { waited = promise; } });
  await waited;
  assert.deepEqual(calls.navigated, ["https://workflow.example.test/?view=rounds"]);
  assert.equal(calls.opened.length, 3, "no second window when one is open");
});

test("the push settings keep the private key sealed and out of what the page sees", () => {
  const sealed = sealPushKey("privat-nyckel", "en-lång-hemlighet-med-minst-trettiotvå-tecken");
  assert.equal(sealed.includes("privat-nyckel"), false);
  assert.equal(openPushKey(sealed, "en-lång-hemlighet-med-minst-trettiotvå-tecken"), "privat-nyckel");
  assert.equal(openPushKey(sealed, "en-annan-hemlighet-med-minst-trettiotvå-tecken"), "");
  const stored = parseStoredPush({ enabled: true, publicKey: "PUBLIK", privateKeyCipher: sealed, subject: "mailto:drift@example.test" });
  assert.equal(pushHasKeys(stored), true);
  const view = publicPushSettings(stored, { fromAddress: "noreply@example.test", blockedReason: null });
  assert.equal(JSON.stringify(view).includes(sealed), false);
  assert.equal(JSON.stringify(view).includes("privat-nyckel"), false);
  assert.deepEqual([view.enabled, view.hasKeys, view.ready, view.publicKey], [true, true, true, "PUBLIK"]);
  // Off, without keys, or on a loopback QA instance: not ready.
  assert.equal(publicPushSettings({ ...stored, enabled: false }, { fromAddress: "a@example.test", blockedReason: null }).ready, false);
  assert.equal(publicPushSettings({ enabled: true }, { fromAddress: "a@example.test", blockedReason: null }).ready, false);
  assert.equal(publicPushSettings(stored, { fromAddress: "a@example.test", blockedReason: "E-post skickas aldrig från en lokal testinstans." }).ready, false);
  assert.equal(publicPushSettings({}, { fromAddress: "a@example.test", blockedReason: null }).publicKey, "");
});

test("the contact address is the one chosen, otherwise the sender's, and must be mailto: or https:", () => {
  assert.equal(effectivePushSubject({ subject: "https://example.test/kontakt" }, "noreply@example.test"), "https://example.test/kontakt");
  assert.equal(effectivePushSubject({}, "noreply@example.test"), "mailto:noreply@example.test");
  assert.equal(effectivePushSubject({ subject: "inte-giltig" }, "noreply@example.test"), "mailto:noreply@example.test");
  assert.equal(effectivePushSubject({}, "noreply@example.com"), "", "the placeholder sender is no contact");
  assert.equal(pushSettingsInput.safeParse({ enabled: true, subject: "" }).success, true);
  assert.equal(pushSettingsInput.safeParse({ enabled: true, subject: "mailto:drift@example.test" }).success, true);
  assert.equal(pushSettingsInput.safeParse({ enabled: true, subject: "drift@example.test" }).success, false);
});

test("the notice choices are saved one at a time, in the order they were made (mail2, QA 2026-10-24)", () => {
  // Two quick ticks sent side by side could reach the server the other way round, and the older choice was kept.
  const page = readFileSync("features/kfid/notice-settings.tsx", "utf8");
  // The queue itself is tested in notice-save-queue.test.ts; the card saves through it only, with the whole choice.
  assert.match(page, /useState\(\(\) => createNoticeSaveQueue\(async \(choice\) => \{ await api\("\/api\/notice-settings", \{ method: "PUT", body: JSON\.stringify\(choice\) \}\)/);
  assert.match(page, /saving\.change\(/);
  assert.doesNotMatch(page, /const save = async/);
  assert.doesNotMatch(page, /save\(\{ email: (on|preference\.email), kinds:/, "no toggle builds its save from the render's own preference");
});
