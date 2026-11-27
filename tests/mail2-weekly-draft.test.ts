import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { describeNextDraft, draftNotice, dueWeeklySlot, parseWeeklySettings, weeklyDraftDecision } from "../lib/mail/release-newsletter";
import { swedishDate } from "../lib/swedish-time";

// Veckobrev som utkast (2026-10-07): the weekly newsletter is never sent by itself. The weekly job makes a draft,
// the superadmin is told in the bell and approves it. These tests keep that rule: no automatic send, one draft per notes.
const ready = { due: true, hasNew: true, draftWaiting: false, recipients: 3, hasSuperadmin: true };

test("the weekly slot can only ever decide on a draft or to skip – there is no send outcome", () => {
  assert.deepEqual(weeklyDraftDecision(ready), { action: "draft" });
  const outcomes = new Set<string>();
  for (const due of [true, false]) for (const hasNew of [true, false]) for (const draftWaiting of [true, false]) for (const recipients of [0, 5]) for (const hasSuperadmin of [true, false])
    outcomes.add(weeklyDraftDecision({ due, hasNew, draftWaiting, recipients, hasSuperadmin }).action);
  assert.deepEqual([...outcomes].sort(), ["draft", "skip"]);
});

test("a draft is made only when due, something is new, none waits, someone would receive it and a superadmin can own it", () => {
  assert.deepEqual(weeklyDraftDecision({ ...ready, due: false }), { action: "skip", reason: "not-due" });
  assert.deepEqual(weeklyDraftDecision({ ...ready, hasNew: false }), { action: "skip", reason: "nothing-new" });
  assert.deepEqual(weeklyDraftDecision({ ...ready, draftWaiting: true }), { action: "skip", reason: "draft-waiting" });
  assert.deepEqual(weeklyDraftDecision({ ...ready, recipients: 0 }), { action: "skip", reason: "no-recipients" });
  assert.deepEqual(weeklyDraftDecision({ ...ready, hasSuperadmin: false }), { action: "skip", reason: "no-superadmin" });
});

test("the same notes never get a second draft: a waiting draft blocks another, and nothing new means no draft", () => {
  // First week: a draft is made. Second week, still unapproved: the notes of a newer version wait, no second draft.
  assert.equal(weeklyDraftDecision(ready).action, "draft");
  assert.deepEqual(weeklyDraftDecision({ ...ready, draftWaiting: true }), { action: "skip", reason: "draft-waiting" });
  // Once handled (approved or skipped) the baseline covers its version: nothing new, so nothing is drafted again.
  assert.deepEqual(weeklyDraftDecision({ ...ready, hasNew: false }), { action: "skip", reason: "nothing-new" });
});

test("the weekly slot is handled once: after it was drafted (or skipped) the same slot is not due again", () => {
  const settings = parseWeeklySettings({ enabled: true, weekday: 1, time: "08:30" });
  const slot = dueWeeklySlot(settings, swedishDate(2026, 10, 6, 8, 35));
  assert.ok(slot);
  assert.equal(dueWeeklySlot({ ...settings, lastSlot: slot.toISOString() }, swedishDate(2026, 10, 6, 8, 40)), null);
  assert.equal(dueWeeklySlot({ ...settings, enabled: false }, swedishDate(2026, 10, 6, 8, 35)), null, "switched off: no draft");
});

test("the version a sent newsletter told about is kept in the settings", () => {
  assert.equal(parseWeeklySettings({ enabled: true, coveredVersion: "0.4.20" }).coveredVersion, "0.4.20");
  assert.equal(parseWeeklySettings({}).coveredVersion, undefined);
});

test("the bell's notice names the draft, links to Utskick and asks for action", () => {
  const notice = draftNotice({ id: "m1", subject: "Nytt i Workflow 0.4.20", createdAt: new Date("2026-10-08T05:00:00Z") });
  assert.equal(notice.id, "NEWSLETTER_DRAFT:m1");
  assert.equal(notice.kind, "NEWSLETTER_DRAFT");
  assert.equal(notice.title, "Veckobrev väntar på godkännande");
  assert.equal(notice.href, "/?view=mailings");
  assert.equal(notice.needsAction, true);
  assert.equal(notice.dueDate, "2026-10-08");
  assert.match(notice.detail ?? "", /inget skickas förrän du gör det/);
});

test("the weekly settings text says a draft is made and nothing is sent by itself", () => {
  assert.match(describeNextDraft("torsdag 15 oktober 09:30", ["0.4.20"]), /Nästa utkast: torsdag 15 oktober 09:30 – med version 0\.4\.20.*inget skickas av sig självt/);
  assert.match(describeNextDraft("torsdag 15 oktober 09:30", null), /inget nytt ännu, då görs inget utkast/);
});

// The weekly path is a draft path in the code too: it has no way to queue, schedule or send a mailing.
test("the weekly job's code never queues, schedules or sends", () => {
  const server = readFileSync("lib/mail/release-newsletter-server.ts", "utf8");
  const pure = readFileSync("lib/mail/release-newsletter.ts", "utf8");
  const script = readFileSync("scripts/mail/run-mailings.ts", "utf8");
  for (const [name, source] of [["release-newsletter-server", server], ["release-newsletter", pure]] as const) {
    assert.doesNotMatch(source, /queueMailing|scheduleMailing|sendSystemEmail|processMailings|queueDueMailings/, `${name} must not send or queue`);
    assert.doesNotMatch(source, /status:\s*"(QUEUED|SCHEDULED|SENT)"/, `${name} must not set a sending status`);
  }
  assert.match(server, /status: "DRAFT"/, "the weekly run writes a draft");
  assert.match(script, /runWeeklyDraft/);
  assert.doesNotMatch(script, /runWeeklyNewsletter|queueMailing/);
});

test("only approving a draft turns it into a queued or scheduled mailing, and it records who approved", () => {
  const drafts = readFileSync("lib/mail/mailing-drafts.ts", "utf8");
  const queued = [...drafts.matchAll(/"QUEUED"|"SCHEDULED"/g)];
  assert.ok(queued.length >= 1);
  // The status change to QUEUED/SCHEDULED sits in approveDraft, claimed from DRAFT, together with the approver.
  const approve = drafts.slice(drafts.indexOf("export async function approveDraft"), drafts.indexOf("export async function dismissDraft"));
  assert.match(approve, /where: \{ id: draft\.id, status: "DRAFT" \}/);
  assert.match(approve, /approvedById: input\.actorId/);
  assert.match(approve, /\$transaction/);
  for (const [name, body] of [["createDraft", drafts.slice(drafts.indexOf("export async function createDraft"), drafts.indexOf("export async function saveDraft"))], ["saveDraft", drafts.slice(drafts.indexOf("export async function saveDraft"), drafts.indexOf("export async function approveDraft"))]] as const)
    assert.doesNotMatch(body, /"QUEUED"|"SCHEDULED"|mailingRecipient/, `${name} must not queue`);
});

// The cron schedule is part of the private operations files (not in the community edition).
test("no cron line or job sends the weekly newsletter on its own", { skip: !existsSync("ops/cron/hintek-workflow") }, () => {
  const cron = readFileSync("ops/cron/hintek-workflow", "utf8");
  assert.doesNotMatch(cron, /veckobrevet på sin veckodag/i, "the cron comment must not promise a weekly send");
  assert.match(cron, /utkast/i, "the cron comment says the weekly newsletter is a draft");
});
