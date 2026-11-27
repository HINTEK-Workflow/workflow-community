import type { ReportRow, RunReport } from "./model";

/**
 * Rapportmallar (2026-11-21: "Skapa även färdiga mallar … som AI-agenterna kan leverera, så den inte behöver skapa dem varje
 * gång" – "alltså PDF-mallar"). A report template is a fixed structure: its title, its parts in order (Sammanfattning, Siffror, the
 * lists with links, Bedömning, Nästa steg) and which parts the rules fill and which slot Workflow AI fills, with a length limit. The words
 * themselves (headings, the AI label, the empty line, the footer) are the PDF document type Agentrapport in Workflow's PDF template
 * editor (lib/pdf-templates/catalog.ts), so the company edits them where it edits every other document. The same output every time
 * apart from the slots: cheaper, and the same look. Pure: the runners, the PDF and the tests read the same rules.
 */
export const REPORT_TEMPLATE_KEYS = ["weekly_work_orders", "deviations", "time", "pending_invoicing", "quotes_waiting", "capacity", "calibrations", "weekly_news", "internal_news", "general"] as const;
export type ReportTemplateKey = (typeof REPORT_TEMPLATE_KEYS)[number];
export type ReportTemplate = {
  key: ReportTemplateKey;
  name: string;
  /** The AI slot: Bedömning (an assessment of the records) or Text (a summary in prose); null: the rules fill everything. */
  ai: { kind: "assessment" | "summary"; max: number } | null;
  /** The mission templates that use it by default. */
  missions: readonly string[];
};

export const REPORT_TEMPLATES: readonly ReportTemplate[] = [
  { key: "weekly_work_orders", name: "Veckorapport arbetsordrar", ai: null, missions: ["weekly_work_orders"] },
  { key: "deviations", name: "Tillbud och avvikelser", ai: { kind: "assessment", max: 1_200 }, missions: ["open_deviations"] },
  { key: "time", name: "Tidsammanställning", ai: null, missions: ["my_week_time"] },
  { key: "pending_invoicing", name: "Fakturaunderlag som väntar", ai: null, missions: ["pending_invoicing"] },
  { key: "quotes_waiting", name: "Offerter som väntar", ai: null, missions: ["quotes_waiting"] },
  { key: "capacity", name: "Kapacitet nästa vecka", ai: null, missions: ["next_week_capacity"] },
  { key: "calibrations", name: "Kalibreringar och behörigheter", ai: null, missions: ["expiring_calibrations"] },
  { key: "weekly_news", name: "Veckonyhet", ai: { kind: "summary", max: 700 }, missions: ["weekly_news_draft"] },
  { key: "internal_news", name: "Intern nyhet", ai: null, missions: ["weekly_planning_news"] },
  { key: "general", name: "Rapport", ai: { kind: "summary", max: 1_200 }, missions: ["custom", "round_month"] },
];
const BY_KEY = new Map(REPORT_TEMPLATES.map((item) => [item.key, item]));
export const reportTemplate = (key: string | null | undefined) => BY_KEY.get(key as ReportTemplateKey) ?? BY_KEY.get("general")!;
/** The title block of a report template in the PDF document type Agentrapport (block ids use hyphens). */
export const reportTitleBlock = (key: string) => `title.${key.replaceAll("_", "-")}`;
/** The report template a mission template uses by default. */
export const reportTemplateFor = (missionTemplate: string) => REPORT_TEMPLATES.find((item) => item.missions.includes(missionTemplate))?.key ?? "general";

/** The words the template fills with (the PDF texts of Agentrapport, or their defaults). */
export type ReportWords = { empty: string; assessmentLabel: string; summaryLabel: string };
export const DEFAULT_REPORT_WORDS: ReportWords = {
  empty: "Inget att rapportera.",
  assessmentLabel: "Workflow AI:s bedömning av posterna. Det är inget beslut om elsäkerhet – det fattar en behörig person.",
  summaryLabel: "Skrivet av Workflow AI utifrån posterna.",
};

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`);

/**
 * Fills a report template: the rules' parts as they are (an empty list becomes the plain empty line), the AI slot only when the
 * template has one and the text is there – cut to its limit and marked. No AI text where the template has no slot.
 */
export function fillReport(key: string, parts: { title: string; summary: string; facts?: { label: string; value: string }[]; sections: { heading: string; rows: ReportRow[] }[]; ai?: string | null; nextSteps?: string[] }, words: ReportWords = DEFAULT_REPORT_WORDS): RunReport {
  const template = reportTemplate(key);
  const sections = parts.sections.filter((section) => section.heading);
  const nothing = !sections.some((section) => section.rows.length);
  const ai = template.ai && parts.ai?.trim() ? clip(parts.ai.trim(), template.ai.max) : null;
  return {
    template: template.key,
    title: parts.title,
    summary: parts.summary.trim() || (nothing ? words.empty : ""),
    facts: parts.facts ?? [],
    sections: nothing ? [] : sections.map((section) => (section.rows.length ? section : { heading: section.heading, rows: [{ title: words.empty }] })),
    assessment: ai ? { label: template.ai!.kind === "assessment" ? words.assessmentLabel : words.summaryLabel, text: ai } : null,
    nextSteps: parts.nextSteps ?? [],
  };
}
