import { z } from "zod";

const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Ange en färg som #123ABC.")
  .transform((value) => value.toUpperCase());

export const DEFAULT_REPORT_BRANDING = {
  primary: "#174C72",
  accent: "#2E7EAA",
  soft: "#EDF5F9",
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
