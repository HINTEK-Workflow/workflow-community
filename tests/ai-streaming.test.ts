import assert from "node:assert/strict";
import test from "node:test";
import { AliasMap } from "../lib/ai/alias";
import { aliasStreamRestorer, answerFieldStreamer } from "../lib/ai/stream-text";
import { assistantSources, executeWorkflowAssistant, type AssistantProviderAdapter } from "../lib/ai/workflow-assistant";

// Strömning (2026-10-24, svar 6): the pieces of the provider's JSON answer become the answer's text as it is written, with
// the real names back – never a placeholder, never half of one. Synthetic text only; no provider is called.

const collect = () => { const parts: string[] = []; return { parts, text: () => parts.join(""), add: (part: string) => { parts.push(part); } }; };

test("the answer's text is read out of JSON that arrives in pieces, escapes included, whatever comes after it", () => {
  const json = JSON.stringify({ answer: "Rad 1\nRad \"två\" – 50 % \\ klart ✓", citations: ["source-1"] });
  for (const size of [1, 2, 3, 7, 1_000]) {
    const out = collect();
    const field = answerFieldStreamer(out.add);
    for (let index = 0; index < json.length; index += size) field.push(json.slice(index, index + size));
    assert.equal(out.text(), "Rad 1\nRad \"två\" – 50 % \\ klart ✓", `pieces of ${size}`);
  }
  // A \u escape split over two pieces, and nothing before the key reaches the chat.
  const out = collect();
  const field = answerFieldStreamer(out.add);
  for (const piece of ['{"citations":[],"ans', 'wer":"caf\\u00', 'e9 ok"}']) field.push(piece);
  assert.equal(out.text(), "café ok");
  // A turn that turns to a tool starts over.
  field.reset();
  field.push('{"answer":"ny"}');
  assert.equal(out.text(), "café okny");
});

test("placeholders are held back until they are whole, then shown as the real name", () => {
  const alias = new AliasMap();
  const customer = alias.add("Kund", "Elfirman Syd AB");
  const out = collect();
  const restorer = aliasStreamRestorer((text) => alias.restore(text), out.add);
  const text = `Ring ${customer} i morgon [obs] och ${customer}.`;
  for (const char of text) restorer.push(char);
  restorer.flush();
  assert.equal(out.text(), "Ring Elfirman Syd AB i morgon [obs] och Elfirman Syd AB.");
  assert.ok(out.parts.every((part) => !part.includes("[Kund")), "no piece ever shows a placeholder");
});

test("the assistant streams the restored answer and still returns the whole, checked answer", async () => {
  const alias = new AliasMap();
  const person = alias.add("Person", "Anna Andersson");
  const final = `Hej, ${person} har två jobb idag.`;
  const provider: AssistantProviderAdapter = {
    id: "OFFLINE_STREAM",
    async generate(request) {
      assert.ok(request.onAnswerText, "the chat asked for a stream");
      // A first turn that was going to answer, then called a tool: its text is cleared.
      request.onAnswerText?.("Jag ");
      request.onAnswerReset?.();
      for (const piece of final.match(/.{1,4}/g) ?? []) request.onAnswerText?.(piece);
      return { providerResponseId: "resp_offline", answer: final, citationKeys: [], usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 } };
    },
  };
  let shown = "";
  let resets = 0;
  const result = await executeWorkflowAssistant(provider, {
    model: "gpt-5.6-luna", reasoningEffort: "low", maxOutputTokens: 400, organizationId: "org", actorId: "user", history: [{ role: "USER", content: "Vad gör Anna Andersson idag?" }],
    sources: assistantSources([]), alias, live: { onText: (text) => { shown += text; }, onReset: () => { shown = ""; resets += 1; } },
  });
  assert.equal(resets, 1);
  assert.equal(shown, "Hej, Anna Andersson har två jobb idag.");
  assert.equal(result.answer, shown, "the streamed text is the answer that is saved");
  assert.deepEqual(result.usage, { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 }, "the tokens are counted as without streaming");
});

test("without a stream nothing changes: the provider is asked as before", async () => {
  const provider: AssistantProviderAdapter = {
    id: "OFFLINE_PLAIN",
    async generate(request) {
      assert.equal(request.onAnswerText, undefined);
      assert.equal(request.signal, undefined);
      return { providerResponseId: "resp_plain", answer: "Svar", citationKeys: [], usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 } };
    },
  };
  const result = await executeWorkflowAssistant(provider, { model: "gpt-5.6-luna", reasoningEffort: "low", maxOutputTokens: 10, organizationId: "o", actorId: "u", history: [], sources: [] });
  assert.equal(result.answer, "Svar");
});
