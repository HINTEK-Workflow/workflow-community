import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEMO_CHAT_AUTO, DEMO_CHAT_MARK, DEMO_CHAT_QUESTIONS, demoChatAnswer, demoChatTopic, type DemoChatInput } from "../features/demo/demo-ai";
import { DEMO_PAGE_HREF, demoEntryHref } from "../lib/demo";
import { cookieNoticeBottom } from "../lib/cookies";

// Demo fixes 2026-11-22: Workflow AI's example answers in the demo, links to the demo's pages, the cookie card above the tab bar.

const now = new Date("2026-11-22T09:00:00Z");
const base: DemoChatInput = {
  question: "", mode: "manual", now, userId: "demo-elis",
  tasks: [
    { id: "t1", kind: "WORK_ORDER", title: "Byte av armaturer", status: "IN_PROGRESS", dueDate: "2026-11-20", assignedToUserId: "demo-elis", customerName: "Fas & Form" },
    { id: "t2", kind: "WORK_ORDER", title: "Laddboxar etapp 2", status: "PLANNED", dueDate: "2026-11-22", assignedToUserId: "demo-elis", customerName: "Nollpunkten" },
    { id: "t3", kind: "WORK_ORDER", title: "Klar order", status: "COMPLETED", dueDate: "2026-11-01", assignedToUserId: "demo-elis", customerName: "" },
    { id: "t4", kind: "FORM", title: "Kontroll ställverk", status: "PLANNED", dueDate: "2026-11-30", assignedToUserId: "demo-elon", customerName: "" },
  ],
  activities: [
    { title: "Byggmöte Nollpunkten", startsAt: "2026-11-22T09:00:00Z", endsAt: "2026-11-22T10:00:00Z", status: "PLANNED", userIds: ["demo-elis"], deleted: false },
    { title: "I morgon", startsAt: "2026-11-23T07:00:00Z", endsAt: "2026-11-23T15:00:00Z", status: "PLANNED", userIds: ["demo-elis"], deleted: false },
    { title: "Inte min", startsAt: "2026-11-22T07:00:00Z", endsAt: "2026-11-22T08:00:00Z", status: "PLANNED", userIds: ["demo-elon"], deleted: false },
  ],
};

test("the demo's example questions each have their own answer, and other words find them too", () => {
  assert.deepEqual(DEMO_CHAT_QUESTIONS.map(demoChatTopic), ["work_orders", "today", "overdue", "invoice_basis"]);
  assert.equal(demoChatTopic("vad har jag idag"), "today");
  assert.equal(demoChatTopic("Visa mina öppna arbetsordrar"), "work_orders");
  assert.equal(demoChatTopic("Hur fakturerar jag?"), "invoice_basis");
  assert.equal(demoChatTopic("Vad blir vädret?"), "unknown");
});

test("every answer is marked as an example, built from the given data, with links to it", () => {
  const orders = demoChatAnswer({ ...base, question: "Vilka arbetsordrar är öppna?" });
  assert.match(orders.content, /Det finns 2 öppna arbetsordrar/);
  assert.match(orders.content, /Byte av armaturer · Pågår · Fas & Form/);
  assert.doesNotMatch(orders.content, /Klar order|Kontroll ställverk/, "only open work orders");
  assert.ok(orders.content.endsWith(DEMO_CHAT_MARK));
  assert.deepEqual(orders.citations.map((item) => item.href), ["/?view=workflow_task&taskId=t1&taskType=WORK_ORDER", "/?view=workflow_task&taskId=t2&taskType=WORK_ORDER", "/?view=work_orders"]);

  const today = demoChatAnswer({ ...base, question: "Vad har jag i dag?" });
  assert.match(today.content, /Byggmöte Nollpunkten/);
  assert.doesNotMatch(today.content, /I morgon|Inte min/, "only today's and only the person's own");
  assert.match(today.content, /Laddboxar etapp 2/, "work due today");

  const late = demoChatAnswer({ ...base, question: "Vad är förfallet?" });
  assert.match(late.content, /En uppgift har passerat Klart senast/);
  assert.match(late.content, /Byte av armaturer/);

  const invoice = demoChatAnswer({ ...base, question: "Hur gör jag ett fakturaunderlag?" });
  assert.match(invoice.content, /Nytt fakturaunderlag/);
  assert.deepEqual(invoice.citations.map((item) => item.href), ["/?view=invoice_bases"]);

  const unknown = demoChatAnswer({ ...base, question: "Vad blir vädret?" });
  for (const question of DEMO_CHAT_QUESTIONS) assert.ok(unknown.content.includes(question));
  for (const answer of [today, late, invoice, unknown]) assert.ok(answer.content.endsWith(DEMO_CHAT_MARK));
});

test("Auto in the demo does nothing and says so first", () => {
  const auto = demoChatAnswer({ ...base, question: "Vilka arbetsordrar är öppna?", mode: "auto" });
  assert.ok(auto.content.startsWith(DEMO_CHAT_AUTO));
  assert.match(auto.content, /Här görs ingenting/);
});

test("the demo's chat answers in the browser: status with the example questions, the answer in the chat's own form", async () => {
  const { handleDemoRequest, setDemoUser } = await import("../features/demo/demo-backend");
  setDemoUser("demo-elna");
  const status = await (await handleDemoRequest("GET", new URL("/api/ai/status", "http://localhost"), null)).json() as { chatAvailable: boolean; demo: boolean; suggestions: string[] };
  assert.equal(status.chatAvailable, true);
  assert.equal(status.demo, true);
  assert.deepEqual(status.suggestions, [...DEMO_CHAT_QUESTIONS]);
  const response = await handleDemoRequest("POST", new URL("/api/ai/chat?stream=1", "http://localhost"), JSON.stringify({ content: "Vilka arbetsordrar är öppna?", mode: "auto" }));
  assert.equal(response.status, 200);
  const result = await response.json() as { conversation: { id: string }; userMessage: { role: string; content: string }; message: { role: string; content: string; citations: unknown[] } };
  assert.equal(result.userMessage.role, "USER");
  assert.equal(result.message.role, "ASSISTANT");
  assert.ok(result.message.content.startsWith(DEMO_CHAT_AUTO));
  assert.ok(result.message.content.endsWith(DEMO_CHAT_MARK));
  assert.ok(result.conversation.id.startsWith("demo-"));
  const empty = await handleDemoRequest("POST", new URL("/api/ai/chat", "http://localhost"), JSON.stringify({ content: "  " }));
  assert.equal(empty.status, 400);
});

test("the demo's chat never calls an AI provider", () => {
  const source = readFileSync("features/demo/demo-ai.ts", "utf8");
  assert.doesNotMatch(source, /fetch\(|openai|azure|anthropic/i);
});

test("a link to one of the demo's pages opens that page inside the demo", () => {
  const href = (query: string) => demoEntryHref(new URLSearchParams(query));
  assert.equal(href(""), DEMO_PAGE_HREF);
  assert.equal(href("via=button"), DEMO_PAGE_HREF);
  assert.equal(href("view=demo&via=login"), DEMO_PAGE_HREF);
  assert.equal(href("view=work_orders"), "/?view=work_orders");
  assert.equal(href("view=project&projectId=demo-project-laddplatser&via=button"), "/?view=project&projectId=demo-project-laddplatser");
  // Never anything but a plain page name, and never an address elsewhere.
  assert.equal(href("view=https://example.test"), DEMO_PAGE_HREF);
  assert.equal(href("view=..%2Flogin"), DEMO_PAGE_HREF);
  assert.ok(href("view=tasks&x=//evil.test").startsWith("/?view=tasks"));
  assert.equal(href(`view=tasks&q=${"a".repeat(300)}`), "/?view=tasks");
  assert.match(readFileSync("app/demo/route.ts", "utf8"), /demoEntryHref\(url\.searchParams\)/);
  assert.match(readFileSync("app/page.tsx", "utf8"), /if \(!user && params\.view === "demo"\) redirect\("\/demo"\)/);
});

test("the cookie card stands above the app's bottom bar, or keeps its own place without one", () => {
  assert.equal(cookieNoticeBottom(0), null);
  assert.equal(cookieNoticeBottom(Number.NaN), null);
  assert.equal(cookieNoticeBottom(74.5), "87px");
  assert.equal(cookieNoticeBottom(108), "120px");
});
