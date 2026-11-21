import type { PdfDocumentType } from "./catalog";

/** The examples the editor's preview offers per document type (drawn by ./examples.ts on the server). */
export type PdfExampleVariant = { key: string; label: string };
export const PDF_EXAMPLE_VARIANTS: Record<PdfDocumentType, readonly PdfExampleVariant[]> = {
  quote: [{ key: "quote", label: "Offert" }, { key: "draft", label: "Utkast" }, { key: "ata", label: "ÄTA" }, { key: "reverse", label: "Omvänd moms" }, { key: "empty", label: "Utan rader" }, { key: "ata-reverse", label: "ÄTA, omvänd moms" }, { key: "ata-rot", label: "ÄTA, ROT" }],
  invoice_basis: [{ key: "basis", label: "Utkast" }, { key: "invoiced", label: "Fakturerat" }, { key: "invoiced-unnamed", label: "Fakturerat, utan namn" }, { key: "articles", label: "Med artikelnummer" }, { key: "reverse", label: "Omvänd moms" }, { key: "empty", label: "Utan rader" }],
  invoice: [{ key: "invoice", label: "Faktura" }, { key: "rot", label: "ROT" }, { key: "reverse", label: "Omvänd moms" }, { key: "proforma", label: "Proforma" }, { key: "preview", label: "Förhandsgranskning" }],
  credit_invoice: [{ key: "credit", label: "Kreditfaktura" }],
  work_order: [{ key: "order", label: "Pågående" }, { key: "done", label: "Klar med priser" }, { key: "no-rate", label: "Utan timpris" }, { key: "no-rate-one", label: "En utgift utan belopp" }, { key: "expenses", label: "Utgifter utan priser" }, { key: "empty", label: "Tom" }],
  protocol: [{ key: "protocol", label: "Protokoll" }, { key: "blank", label: "Tom mall" }, { key: "blank-round", label: "Tom mall, rond" }, { key: "blank-safety", label: "Tom mall, skyddsrond" }, { key: "full", label: "Med allt" }, { key: "full-preview", label: "Med allt, utan nummer" }, { key: "measure", label: "Mätprotokoll, klart" }, { key: "preview", label: "Utan protokollnummer" }, { key: "thermography", label: "Med objektkort" }, { key: "round", label: "Driftrond" }, { key: "safety", label: "Skyddsrond" }, { key: "risk", label: "Riskbedömning" }],
  risk_assessment: [{ key: "assessment", label: "Pågående" }, { key: "approved", label: "Godkänd" }, { key: "none", label: "Utan risker" }, { key: "step", label: "Som steg" }, { key: "step-extended", label: "Utökad" }, { key: "exception", label: "Undantag" }],
  project_report: [{ key: "project", label: "Projektrapport" }],
  staff_register: [{ key: "register", label: "Kontrollvy" }, { key: "corrections", label: "Med rättelser" }, { key: "empty", label: "Utan registreringar" }],
  self_inspection: [{ key: "programme", label: "Fastställd version" }, { key: "full", label: "Hela programmet" }, { key: "own", label: "Egen kopia" }, { key: "empty", label: "Utan utsedda" }],
  deviation: [{ key: "near-miss", label: "Tillbud" }, { key: "log", label: "Logg" }, { key: "log-all", label: "Logg, alla" }, { key: "log-one", label: "Logg, en post" }, { key: "not-reported", label: "Inte anmäld" }, { key: "accident", label: "Olycksfall" }, { key: "risk", label: "Riskobservation" }, { key: "self-check", label: "Avvikelse, stängd" }, { key: "improvement", label: "Förbättring" }, { key: "empty", label: "Tomt urval" }],
  payroll: [{ key: "payroll", label: "Period" }, { key: "other", label: "Alla månader" }, { key: "empty", label: "Utan tid" }],
  common: [{ key: "quote", label: "På en offert" }, { key: "order", label: "På en arbetsorder" }, { key: "long", label: "Lång tabell" }, { key: "project", label: "Projektrapport" }],
};
