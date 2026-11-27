import assert from "node:assert/strict";
import { test } from "node:test";
import { planAnswer, periodOf } from "../lib/ai/assistant-rules";
import { formatKnowledgeAnswer, knowledgePlan } from "../lib/ai/assistant-rules-knowledge";
import { modelView, quoteForModel } from "../lib/ai/assistant-tools";
import { raisedAlarms } from "../lib/maintenance/machine-alarms-server";
import { describePrompt, getPrompt, KNOWLEDGE_RESOURCE_URI, MCP_PROMPT_RULES, MCP_PROMPTS, promptsFor, readKnowledgeResource } from "../lib/mcp/prompts";
import { WORKFLOW_KNOWLEDGE } from "../lib/ai/knowledge/workflow-knowledge";
import { TOOL_NAMES } from "../lib/tools/catalog";

// Läsverktygen för offerter, fakturering, underhåll och maskinlarm, och MCP-arbetsgångarna (2026-11-21).

const now = new Date("2026-11-21T09:00:00Z");
const plan = (question: string) => { const value = planAnswer(question, now); return value.kind === "tool" ? [value.tool, value.input] : [value.kind]; };

test("rules first: invoicing, quotes, maintenance and alarms are answered by the read tools, without AI", () => {
  assert.deepEqual(plan("Vad kan vi fakturera?"), ["get_invoicing_overview", {}]);
  assert.deepEqual(plan("vad är ofakturerat"), ["get_invoicing_overview", {}]);
  assert.deepEqual(plan("Vilka offerter väntar på svar?"), ["list_quotes", { status: "SENT" }]);
  assert.deepEqual(plan("visa accepterade offerter"), ["list_quotes", { status: "ACCEPTED" }]);
  assert.deepEqual(plan("Vilka maskinlarm är aktiva?"), ["list_machine_alarms", {}]);
  const due = periodOf("underhåll nästa vecka", now);
  assert.deepEqual(plan("Vilket underhåll ska göras nästa vecka?"), ["list_maintenance_due", { from: due.from, to: due.to }]);
  assert.deepEqual(plan("försenat underhåll"), ["list_maintenance_due", {}]);
  // Interpretation still goes to the model.
  assert.deepEqual(plan("Sammanfatta vad som är ofakturerat och föreslå en ordning"), ["ai"]);
  assert.deepEqual(plan("Förklara maskinlarmet på pressen"), ["ai"]);
  assert.equal(knowledgePlan("hur många arbetsordrar har jag", now, periodOf), null);
});

test("quotes reach the model with selling prices only: no purchase price, markup or catalogue data", () => {
  const quote = { id: "q1", label: "O-7", title: "Laddbox", status: "SENT", lines: [{ id: "l1", kind: "MATERIAL", name: "Laddbox", quantity: "2", unit: "st", unitPrice: "1000", markupPercent: "25", catalogue: { supplierName: "Grossisten" } }] };
  const seen = quoteForModel(quote) as { lines: Record<string, unknown>[] };
  assert.deepEqual(Object.keys(seen.lines[0]).sort(), ["amount", "kind", "name", "quantity", "saleUnitPrice", "unit"]);
  assert.equal(seen.lines[0].saleUnitPrice, 1250);
  assert.equal(seen.lines[0].amount, 2500);
  assert.doesNotMatch(JSON.stringify(modelView("get_quote", { quote })), /Grossisten|markupPercent|"unitPrice"/);
});

test("the rule answers: short, linked, Workflow's own amounts", () => {
  const overview = formatKnowledgeAnswer("get_invoicing_overview", "Att fakturera", {
    drafts: { count: 2, net: 12500 }, unbilled: { totalSeconds: 7 * 3600, totalEstimate: 4200, materialRows: 3, more: 0, rows: [{ kind: "task", id: "t1", title: "Byte av central", customer: "Kunden AB", seconds: 7 * 3600, materialRows: 3, estimate: 4200, url: "/?view=workflow_task&taskId=t1&taskType=WORK_ORDER" }] },
    quotes: { awaiting: { count: 1, net: 9000 }, expiring: [], withoutWorkOrder: [] },
  });
  assert.match(overview.answer, /Utkast till fakturaunderlag som väntar: 2, 12\s500 kr exkl\. moms/);
  assert.match(overview.answer, /7 h 0 min/);
  assert.ok(overview.citations.some((item) => item.href.includes("taskId=t1")));
  const none = formatKnowledgeAnswer("get_invoicing_overview", "Att fakturera", { drafts: { count: 0, net: 0 }, unbilled: null, quotes: null });
  assert.match(none.answer, /Inget väntar på fakturering/);
  const alarms = formatKnowledgeAnswer("list_machine_alarms", "Maskinlarm", { raised: [{ code: "E12", text: "Övertemperatur", severity: "fault", occurredAt: "2026-11-21T07:00:00Z", partPath: "Linje 2 › Press 4", partId: "p4", url: "/?view=maintenance&part=p4" }], observations: [{ title: "Larmet E12 kommer oftare" }] });
  assert.match(alarms.answer, /Aktiva larm: 1/);
  assert.match(alarms.answer, /Reglernas observationer: Larmet E12 kommer oftare/);
  assert.doesNotMatch(alarms.answer, /säker/i, "never says a machine is safe or unsafe");
});

test("an alarm is still raised when its latest event per source and code says raised", () => {
  const events = [
    { type: "alarm", code: "E1", state: "cleared", sourceName: "PLC" }, { type: "alarm", code: "E1", state: "raised", sourceName: "PLC" },
    { type: "alarm", code: "E2", state: "raised", sourceName: "PLC" }, { type: "diagnosis", code: "D1", state: null, sourceName: "PLC" },
    { type: "alarm", code: "E2", state: "raised", sourceName: "Andra" },
  ];
  assert.deepEqual(raisedAlarms(events).map((event) => `${event.sourceName}:${event.code}`), ["PLC:E2", "Andra:E2"]);
});

test("MCP prompts: the main skills, listed only with the tools they need, and the safety rules in every one", () => {
  const names = MCP_PROMPTS.map((prompt) => prompt.name);
  for (const name of ["hur_gor_jag", "planera_veckan", "arbetsorder_ur_beskrivning", "vad_saknas_fore_fakturering", "kundens_historik", "offertutkast", "forklara_avvikelse"]) assert.ok(names.includes(name), name);
  for (const prompt of MCP_PROMPTS) for (const tool of prompt.requires) assert.ok((TOOL_NAMES as string[]).includes(tool), `${prompt.name}: ${tool}`);
  assert.deepEqual(promptsFor([]), []);
  assert.deepEqual(promptsFor(["search_help"]).map((prompt) => prompt.name), ["hur_gor_jag"]);
  const listed = describePrompt(MCP_PROMPTS[0]);
  assert.deepEqual(Object.keys(listed).sort(), ["arguments", "description", "name", "title"]);
  assert.equal(getPrompt("hur_gor_jag", { fraga: "hur gör jag ett fakturaunderlag" }, []), null, "not listed, not given");
  assert.deepEqual(getPrompt("hur_gor_jag", {}, ["search_help"]), { error: "Ange fraga." });
  const given = getPrompt("hur_gor_jag", { fraga: "hur gör jag ett fakturaunderlag" }, ["search_help"]) as { messages: { role: string; content: { type: string; text: string } }[] };
  assert.equal(given.messages[0].role, "user");
  assert.match(given.messages[0].content.text, /hur gör jag ett fakturaunderlag/);
  assert.ok(given.messages[0].content.text.includes(MCP_PROMPT_RULES));
  assert.match(MCP_PROMPT_RULES, /får spänningssättas/);
  assert.match(MCP_PROMPT_RULES, /Hitta aldrig på/);
});

test("MCP resource: the knowledge package as Workflow's own text, nothing else", () => {
  const read = readKnowledgeResource(KNOWLEDGE_RESOURCE_URI);
  assert.equal(read?.contents[0].text, WORKFLOW_KNOWLEDGE);
  assert.equal(readKnowledgeResource("workflow://kunskap/annat"), null);
  assert.equal(readKnowledgeResource("file:///etc/passwd"), null);
});
