import assert from "node:assert/strict";
import test from "node:test";
import { applyNoticeChange, createNoticeSaveQueue, type NoticeChoice } from "../lib/workflow/notice-save-queue";

// Notisvalen sparas en i taget och varje sparning bygger på det senaste valet (mail2, QA 2026-10-24).
const none: NoticeChoice = { email: false, kinds: [], machineAlarmNight: false };

function controlledSend() {
  const sent: NoticeChoice[] = [];
  const answers: Array<{ ok: () => void; fail: (error: Error) => void }> = [];
  const send = (choice: NoticeChoice) => new Promise<void>((resolve, reject) => { sent.push(choice); answers.push({ ok: resolve, fail: reject }); });
  return { sent, answers, send };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("one change: a kind once, removed, e-mail and night set as given", () => {
  assert.deepEqual(applyNoticeChange(none, { kind: "kind", key: "ROUNDS", on: true }).kinds, ["ROUNDS"]);
  assert.deepEqual(applyNoticeChange({ ...none, kinds: ["ROUNDS"] }, { kind: "kind", key: "ROUNDS", on: true }).kinds, ["ROUNDS"], "never twice");
  assert.deepEqual(applyNoticeChange({ ...none, kinds: ["ROUNDS", "DEADLINES"] }, { kind: "kind", key: "ROUNDS", on: false }).kinds, ["DEADLINES"]);
  assert.deepEqual(applyNoticeChange({ ...none, kinds: ["ROUNDS"] }, { kind: "email", on: true }), { email: true, kinds: ["ROUNDS"], machineAlarmNight: false });
  assert.deepEqual(applyNoticeChange(none, { kind: "night", on: true }), { ...none, machineAlarmNight: true });
});

test("quick changes from the same stale base build on each other and are sent in order, one at a time", async () => {
  const { sent, answers, send } = controlledSend();
  const queue = createNoticeSaveQueue(send);
  // The page has not drawn again between the clicks: every change is given the same old base.
  const base = { ...none, email: true };
  const first = queue.change(base, { kind: "kind", key: "ROUNDS", on: true });
  const second = queue.change(base, { kind: "kind", key: "DEADLINES", on: true });
  const third = queue.change(base, { kind: "email", on: false });
  assert.deepEqual(third.choice, { email: false, kinds: ["ROUNDS", "DEADLINES"], machineAlarmNight: false }, "the e-mail switch keeps both kinds");
  await tick();
  assert.equal(sent.length, 1, "the next save waits for the answer to the one before");
  answers[0].ok(); await first.done; await tick();
  assert.equal(sent.length, 2);
  answers[1].ok(); await second.done; await tick();
  answers[2].ok(); await third.done;
  assert.deepEqual(sent, [
    { email: true, kinds: ["ROUNDS"], machineAlarmNight: false },
    { email: true, kinds: ["ROUNDS", "DEADLINES"], machineAlarmNight: false },
    { email: false, kinds: ["ROUNDS", "DEADLINES"], machineAlarmNight: false },
  ], "each save is the whole latest choice");
});

test("a failed save does not stop the next; an empty queue builds on the page's answer again", async () => {
  const { sent, answers, send } = controlledSend();
  const queue = createNoticeSaveQueue(send);
  const first = queue.change(none, { kind: "kind", key: "URGENT", on: true });
  const second = queue.change(none, { kind: "night", on: true });
  await tick();
  answers[0].fail(new Error("Nätverksfel"));
  await assert.rejects(first.done, /Nätverksfel/);
  await tick();
  assert.equal(sent.length, 2, "the save after a failed one is still sent");
  answers[1].ok(); await second.done;
  await queue.idle();
  // Nothing on its way: the base given (what the page shows, read again) is used, not the old queued choice.
  const fresh = queue.change({ ...none, kinds: ["ACTION"] }, { kind: "email", on: true });
  assert.deepEqual(fresh.choice, { email: true, kinds: ["ACTION"], machineAlarmNight: false });
  await tick();
  answers[2].ok(); await fresh.done;
});
