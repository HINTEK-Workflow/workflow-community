import { z } from "zod";
import { PDF_DOCUMENT_TYPES } from "./catalog";

/**
 * What the editor sends (PDF-mallar, 2026-11-03): one document's wanted overrides. Lengths are capped here as a first
 * fence (no block allows more than 600 characters); each block's own rules are checked by lib/pdf-templates/model.ts.
 */
const MAX_BLOCKS = 800;
const blockInput = z.object({
  blockId: z.string().min(1).max(60).regex(/^[a-z][a-z0-9.-]*$/),
  text: z.string().max(600).nullable(),
  visible: z.boolean().nullable(),
  orderIndex: z.number().int().min(0).max(50).nullable(),
  confirm: z.boolean().optional(),
}).strict();

export const pdfTemplateSaveSchema = z.object({
  documentType: z.enum(PDF_DOCUMENT_TYPES as [string, ...string[]]),
  basedOn: z.string().min(1).max(40),
  blocks: z.array(blockInput).max(MAX_BLOCKS),
}).strict();

/**
 * The live preview: the editor's unsaved overrides, each with the version it stands on. A document also prints blocks of
 * others (the common texts, a work order's risk step), so each block says its own document; left out, it is the shown one.
 */
export const pdfTemplatePreviewSchema = z.object({
  documentType: z.enum(PDF_DOCUMENT_TYPES as [string, ...string[]]),
  variant: z.string().max(30).nullable().optional(),
  blocks: z.array(blockInput.omit({ confirm: true }).extend({ basedOnVersion: z.string().max(40), documentType: z.enum(PDF_DOCUMENT_TYPES as [string, ...string[]]).optional() }).strict()).max(MAX_BLOCKS),
}).strict();
