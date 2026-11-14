import type { AiTaskKind } from "@/lib/ai/model-catalog";

const PROPOSAL_PATTERN = /\b(skapa|lägg till|fyll i|uppdatera|ändra|rätta|skriv in|registrera)\b/i;
const DOCUMENT_PATTERN = /\b(dokument|pdf|bilaga|avtal|villkor|rapport|fil)\b/i;
const SEARCH_PATTERN = /\b(sök|hitta|visa|vilka|vilken|var finns|leta|mätvärde|isolationsvärde|riso)\b/i;

export function classifyAssistantTask(content: string): AiTaskKind {
  const normalized = content.trim();
  if (PROPOSAL_PATTERN.test(normalized)) return "WORKFLOW_PROPOSAL";
  if (SEARCH_PATTERN.test(normalized)) return "WORKFLOW_SEARCH";
  if (DOCUMENT_PATTERN.test(normalized)) return "DOCUMENT_ANALYSIS";
  return "SIMPLE_CHAT";
}

export function assistantTaskLimits(taskKind: AiTaskKind) {
  return {
    SIMPLE_CHAT: { minimumInputTokens: 2_000, maxOutputTokens: 1_000 },
    WORKFLOW_SEARCH: { minimumInputTokens: 3_000, maxOutputTokens: 1_200 },
    DOCUMENT_ANALYSIS: { minimumInputTokens: 12_000, maxOutputTokens: 3_000 },
    WORKFLOW_PROPOSAL: { minimumInputTokens: 8_000, maxOutputTokens: 2_500 },
    KFID_CONTROL_REVIEW: { minimumInputTokens: 4_000, maxOutputTokens: 2_000 },
    WRITING: { minimumInputTokens: 2_000, maxOutputTokens: 1_200 },
  }[taskKind];
}

export function estimateAssistantInputTokens(content: string) {
  return Math.max(1, Math.ceil(Buffer.byteLength(content, "utf8") / 3));
}
