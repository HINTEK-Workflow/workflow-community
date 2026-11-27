import assert from "node:assert/strict";
import test from "node:test";
import { AliasMap, aliasLabelledLines } from "../lib/ai/alias";
import { prepareWorkflowAssistantRequest, executeWorkflowAssistant, type AssistantProviderAdapter } from "../lib/ai/workflow-assistant";

test("alias: known names, addresses, e-mail and phone numbers never reach the provider; the answer gets them back", () => {
  const map = new AliasMap();
  assert.equal(map.add("Projekt", "Strömgatan 5"), "[Projekt 1]");
  assert.equal(map.add("Kund", "Elkraft i Småland AB"), "[Kund 1]");
  assert.equal(map.add("Kund", "elkraft i småland ab"), "[Kund 1]", "the same value keeps its alias");
  const sent = map.text("Status på Strömgatan 5 för Elkraft i Småland AB? Ring 070-123 45 67 eller mejla anna.berg@exempel.se, Ågatan 12, 352 30 Växjö.");
  for (const secret of ["Strömgatan", "Elkraft", "070-123", "anna.berg", "Ågatan 12", "352 30"]) assert.ok(!sent.includes(secret), `${secret} must be aliased: ${sent}`);
  assert.match(sent, /\[Projekt 1\].*\[Kund 1\].*\[Telefon 1\].*\[E-post 1\].*\[Adress 1\].*\[Postnummer 1\]/);
  assert.equal(map.restore("[Projekt 1] är försenat; kontakta [E-post 1]. [Kund 9] finns inte."), "Strömgatan 5 är försenat; kontakta anna.berg@exempel.se. [Kund 9] finns inte.");
});

test("alias: measurements, dates and ordinary words are left alone", () => {
  const map = new AliasMap();
  const text = "Isolation 550 MΩ, kontinuitet 0,12 Ω, datum 2026-10-01, vecka 41, 230 V, JFB 30 mA, 12345 st.";
  assert.equal(map.text(text), text);
});

test("alias: labelled lines in a report are aliased as a whole", () => {
  const map = new AliasMap();
  const text = aliasLabelledLines(map, "Servicerapport\nKund: Bostadsbolaget Norra\nKontaktperson: Per Svensson\nAnläggning: Elcentral A\nUtfört arbete: Bytt säkring");
  assert.ok(!/Bostadsbolaget|Per Svensson|Elcentral A/.test(text), text);
  assert.match(text, /Kund: \[Kund 1\]\nKontaktperson: \[Person 1\]\nAnläggning: \[Plats 1\]\nUtfört arbete: Bytt säkring/);
});

test("alias: the assistant request carries placeholders only, and the answer is restored", async () => {
  const sources = [{ key: "source-1", resourceType: "PROJECT", resourceId: "p1", title: "Strömgatan 5", description: "Projekt: Strömgatan 5, kund Elkraft AB", href: "/?view=project&projectId=p1", citationLabel: "Strömgatan 5" }];
  const input = { model: "m", reasoningEffort: "low" as const, maxOutputTokens: 100, organizationId: "o", actorId: "a", history: [{ role: "USER" as const, content: "Hur går det på Strömgatan 5? Ring 0470-12 34 56." }], sources, workContext: { mostRecentOpen: [{ title: "Byte av armatur", project: "Strömgatan 5" }] }, pageContext: { kind: "WORK_ORDER", step: "Utförande" } };
  const request = prepareWorkflowAssistantRequest(input);
  assert.ok(!request.input.includes("Strömgatan"), request.input);
  assert.ok(!request.input.includes("0470"), request.input);
  assert.match(request.input, /\[Projekt 1\]/);
  assert.match(request.instructions, /platshållare/);
  const provider: AssistantProviderAdapter = { id: "fake", generate: async () => ({ providerResponseId: "r", answer: "[Projekt 1] ligger i fas, ring [Telefon 1].", citationKeys: ["source-1"], usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 } }) };
  const result = await executeWorkflowAssistant(provider, input);
  assert.equal(result.answer, "Strömgatan 5 ligger i fas, ring 0470-12 34 56.");
});
