import type { FormLeafBlock } from "@/lib/workflow/form-document";

export const BLOCK_LABEL: Record<FormLeafBlock["type"] | "section", string> = {
  section: "Avsnitt", heading: "Rubrik", text: "Hjälptext", field: "Fält", checklist: "Checklista", table: "Tabell", computed: "Formel", images: "Foto/bilaga", signature: "Signatur", pagebreak: "Sidbrytning",
  summary: "Sammanfattning", note: "Infokort", matrix: "Riskmatris",
};
export const INPUT_LABEL: Record<string, string> = { text: "Textfält", textarea: "Lång text", number: "Tal", date: "Datum", datetime: "Datum och tid", choice: "Val", yesno: "Ja/nej", formula: "Formel", images: "Bilder", check: "Kryssruta", assessment: "Godkänd", scale: "Skala" };

/** The type shown on a block in the canvas, e.g. "Mätvärde · V" or "Flerval". */
export function blockTypeLabel(block: FormLeafBlock) {
  if (block.type !== "field") return BLOCK_LABEL[block.type];
  if (block.input === "choice") return block.multiple ? "Flerval" : "Enval";
  if (block.input === "number" && block.unit) return `Mätvärde · ${block.unit}`;
  return INPUT_LABEL[block.input];
}

export const blockName = (block: FormLeafBlock) => "label" in block ? block.label : block.type === "heading" || block.type === "text" ? block.text.slice(0, 60) : block.type === "note" ? block.title : "Sidbrytning";
