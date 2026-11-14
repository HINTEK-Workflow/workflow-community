import { z } from "zod";

const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Ange en färg som #123ABC.")
  .transform((value) => value.toUpperCase());

/**
 * Workflow's colours as the defaults of the document design (2026-11-03): navy for headings, the title and the total;
 * the clear Workflow blue for the payment box's key figures; the soft tint behind the table head. A company's own report
 * colours take precedence, as before.
 */
export const DEFAULT_REPORT_BRANDING = {
  primary: "#113351",
  accent: "#0B65C2",
  soft: "#E9EFF5",
} as const;

export const reportBrandingSchema = z.object({
  primary: color.default(DEFAULT_REPORT_BRANDING.primary),
  accent: color.default(DEFAULT_REPORT_BRANDING.accent),
  soft: color.default(DEFAULT_REPORT_BRANDING.soft),
});

export type ReportBranding = z.infer<typeof reportBrandingSchema>;

export function reportBranding(input?: Partial<ReportBranding> | null) {
  return reportBrandingSchema.parse(input ?? {});
}

export function hexRgb(value: string) {
  const normalized = color.parse(value).slice(1);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16) / 255,
    g: Number.parseInt(normalized.slice(2, 4), 16) / 255,
    b: Number.parseInt(normalized.slice(4, 6), 16) / 255,
  };
}
