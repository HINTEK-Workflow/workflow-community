import assert from "node:assert/strict";
import { test } from "node:test";
import { AI_CALLS_PER_MINUTE, allowAiCall } from "../lib/ai/rate-limit";
import { clearResultCache, readCachedResult, resultCacheKey, storeCachedResult } from "../lib/ai/result-cache";
import { compactHistory, HISTORY_FULL, prepareWorkflowAssistantRequest, type AssistantHistoryItem } from "../lib/ai/workflow-assistant";

const base = {
  model: "gpt-5.6-luna",
  reasoningEffort: "none" as const,
  maxOutputTokens: 1_000,
  organizationId: "secret-tenant-id",
  actorId: "secret-user-id",
  sources: [],
};

test("prompt cache (fas 0): what changes least comes first and today's date last; the cache key is a hash per company", () => {
  const request = prepareWorkflowAssistantRequest({ ...base, history: [{ role: "USER", content: "Hur går det?" }], memory: { company: "Vi arbetar med elinstallationer.", user: "Korta svar." }, pageContext: { kind: "FORM", step: "Ifyllnad" } });
  const keys = Object.keys(JSON.parse(request.input));
  assert.deepEqual(keys, ["companyMemory", "userMemory", "authorizedWorkflowSources", "currentPage", "conversation", "today"]);
  assert.match(request.cacheKey, /^hwf-assistant-[0-9a-f]{24}$/);
  assert.equal(request.cacheKey.includes("secret-tenant-id"), false, "never an id");
  const sameCompany = prepareWorkflowAssistantRequest({ ...base, actorId: "another-user", history: [{ role: "USER", content: "Annat" }] });
  const otherCompany = prepareWorkflowAssistantRequest({ ...base, organizationId: "other-tenant", history: [{ role: "USER", content: "Annat" }] });
  assert.equal(sameCompany.cacheKey, request.cacheKey, "the company's people share the prefix");
  assert.notEqual(otherCompany.cacheKey, request.cacheKey);
});

test("history (fas 0): the latest messages go in whole, older ones as their first line, cut short", () => {
  const history: AssistantHistoryItem[] = Array.from({ length: 10 }, (_, index) => ({ role: index % 2 ? "ASSISTANT" as const : "USER" as const, content: `Rad ett i meddelande ${index}\nRad två med mycket mer text\n${"x".repeat(400)}` }));
  const compact = compactHistory(history);
  assert.equal(compact.length, 10, "no message is dropped");
  for (const item of compact.slice(0, 10 - HISTORY_FULL)) assert.match(item.content, /^Rad ett i meddelande \d$/);
  for (const [offset, item] of compact.slice(-HISTORY_FULL).entries()) assert.equal(item.content, history[10 - HISTORY_FULL + offset].content);
  const long = compactHistory([{ role: "USER", content: "y".repeat(900) }, ...history.slice(0, HISTORY_FULL)]);
  assert.equal(long[0].content.length, 160);
  assert.ok(long[0].content.endsWith("…"));
  assert.deepEqual(compactHistory(history.slice(0, 3)), history.slice(0, 3), "a short conversation is untouched");
});

test("rate limit (fas 0): a person gets a fixed number of AI answers per minute, each person their own", () => {
  const now = 1_000_000;
  for (let index = 0; index < AI_CALLS_PER_MINUTE; index += 1) assert.equal(allowAiCall("rate-user-a", now + index), true);
  assert.equal(allowAiCall("rate-user-a", now + 30_000), false);
  assert.equal(allowAiCall("rate-user-b", now + 30_000), true, "another person is not affected");
  assert.equal(allowAiCall("rate-user-a", now + 60_001), true, "a new minute, a new allowance");
});

test("result cache (fas 0): the same material gives the same text for a day, never across companies", () => {
  clearResultCache();
  const input = { organizationId: "org-a", agentId: "workflow-assistant", model: "gpt-5.6-luna", material: "Protokoll\nIsolation: 3 av 3 godkända." };
  const key = resultCacheKey(input);
  assert.equal(key, resultCacheKey({ ...input, material: "Protokoll  \n Isolation: 3 av 3 godkända.  " }), "white space does not matter");
  assert.notEqual(key, resultCacheKey({ ...input, organizationId: "org-b" }));
  assert.notEqual(key, resultCacheKey({ ...input, material: "Protokoll\nIsolation: 2 av 3 godkända." }));
  assert.notEqual(key, resultCacheKey({ ...input, model: "gpt-5.6-terra" }));
  assert.equal(key.includes("org-a"), false);
  assert.equal(readCachedResult(key), null);
  storeCachedResult(key, "Alla tre isolationsmätningar är godkända.", "gpt-5.6-luna", 1_000);
  assert.equal(readCachedResult(key, 2_000)?.answer, "Alla tre isolationsmätningar är godkända.");
  assert.equal(readCachedResult(resultCacheKey({ ...input, organizationId: "org-b" }), 2_000), null);
  assert.equal(readCachedResult(key, 1_000 + 24 * 60 * 60 * 1000), null, "gone after a day");
});
