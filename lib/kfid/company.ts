import { z } from "zod";
import { normalizePostalCode } from "@/lib/postal-code";
import { maskPersonalNumber } from "@/lib/kfid/org-number";
const text = z.string().max(300).default("");
const email = z.union([z.literal(""), z.email()]).default("");
/** A bankgiro or plusgiro number as it is written: digits with an optional hyphen or spaces. The digits are not checked against a register. */
const giroNumber = z.string().trim().max(20).regex(/^[0-9][0-9- ]*$|^$/, "Skriv bara siffror och bindestreck.").default("");
const coordinate = (min: number, max: number) => z.number().finite().min(min).max(max).nullable().default(null);
/**
 * Företagets plats (2026-10-24: "bara en kartnål och adressen"): the company's own address and pin in
 * Företagsuppgifter, the same address fields and limits as a customer's top-level place. Stored in the profile JSON
 * (WorkspaceSettings.profile), so no migration; a profile from before has an empty place.
 */
export const companyPlaceSchema = z.object({
  address: z.string().trim().max(200).default(""),
  postalCode: z.string().trim().max(20).default("").transform(normalizePostalCode),
  city: z.string().trim().max(120).default(""),
  latitude: coordinate(-90, 90),
  longitude: coordinate(-180, 180),
}).superRefine((value, context) => {
  if ((value.latitude === null) !== (value.longitude === null)) context.addIssue({ code: "custom", path: ["latitude"], message: "Ange både latitud och longitud, eller ingen av dem." });
});
export type CompanyPlace = z.output<typeof companyPlaceSchema>;
export const blankCompanyPlace: CompanyPlace = { address: "", postalCode: "", city: "", latitude: null, longitude: null };
export const companyProfileSchema = z.object({
  /** Aktiebolag eller annat företag, or enskild firma (2026-11-04). For a sole trader `organizationNumber` holds the personal number. */
  companyType: z.enum(["company", "soleTrader"]).default("company"),
  organizationNumber: text,
  vatNumber: text,
  /** Godkänd för F-skatt (2026-11-01, beslut 5): the company says so itself; printed in the sender box of its customer documents. */
  fSkatt: z.boolean().default(false),
  address: text,
  postalCode: text,
  city: text,
  contactName: text,
  email,
  phone: text,
  installerEmail: email,
  billingEmail: email,
  /** Säte, bankgiro and plusgiro (2026-11-04, Företagsuppgifter for documents): what an invoice or quote letter states about the company. In the profile JSON, so no migration. */
  registeredOffice: text,
  bankgiro: giroNumber,
  plusgiro: giroNumber,
  website: z
    .union([
      z.literal(""),
      z
        .url()
        .refine(
          (v) => /^https?:\/\//i.test(v),
          "Ange en http- eller https-adress.",
        ),
    ])
    .default(""),
  notes: z.string().max(5000).default(""),
  place: companyPlaceSchema.default(blankCompanyPlace),
});
export const blankCompanyProfile = companyProfileSchema.parse({});

/**
 * Avsändarrutan (2026-11-01, beslut 5): what a customer document says about the company that sends it. The address is
 * the place's when the company has one, else the billing address. Read tolerantly: a profile that cannot be read gives
 * nothing, and the box is then left out.
 */
export type CompanySender = { organizationNumber: string; vatNumber: string; fSkatt: boolean; address: string; phone: string; email: string; registeredOffice: string; bankgiro: string; plusgiro: string };
export function companySenderOf(profile: unknown): CompanySender | null {
  const parsed = companyProfileSchema.safeParse(profile ?? {});
  if (!parsed.success) return null;
  const { organizationNumber, vatNumber, fSkatt, address, postalCode, city, phone, email, place, registeredOffice, bankgiro, plusgiro } = parsed.data;
  const parts = place.address.trim() ? [place.address, place.postalCode, place.city] : [address, postalCode, city];
  const line = [parts[0].trim(), [parts[1], parts[2]].map((part) => part.trim()).filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return { organizationNumber: organizationNumber.trim(), vatNumber: vatNumber.trim(), fSkatt, address: line, phone: phone.trim(), email: email.trim(), registeredOffice: registeredOffice.trim(), bankgiro: bankgiro.trim(), plusgiro: plusgiro.trim() };
}

/**
 * What a company's documents (quotes, invoice bases, reports) need to say about the company (2026-11-04): the gaps are
 * shown where the details are kept and in Kom igång, so a document never goes out without them unnoticed. An unknown organisation
 * number never blocks a sign-up; this list is what the guide and the page ask for afterwards. F-skatt and the VAT number are the
 * company's own statements and are not "missing" when empty (a company may have neither).
 */
export type CompanyDocumentGap = { key: "organizationNumber" | "address" | "contact" | "registeredOffice" | "giro"; label: string };
export function companyDocumentGaps(profile: unknown): CompanyDocumentGap[] {
  const parsed = companyProfileSchema.safeParse(profile ?? {});
  if (!parsed.success) return [{ key: "organizationNumber", label: "Företagsuppgifterna går inte att läsa" }];
  const p = parsed.data;
  const has = (value: string) => value.trim().length > 0;
  const gaps: CompanyDocumentGap[] = [];
  if (!has(p.organizationNumber)) gaps.push({ key: "organizationNumber", label: p.companyType === "soleTrader" ? "Personnummer" : "Organisationsnummer" });
  const placeAddress = has(p.place.address) && has(p.place.city);
  if (!placeAddress && !(has(p.address) && has(p.postalCode) && has(p.city))) gaps.push({ key: "address", label: "Adress, postnummer och ort" });
  if (!has(p.email) && !has(p.phone)) gaps.push({ key: "contact", label: "E-post eller telefon" });
  if (!has(p.registeredOffice)) gaps.push({ key: "registeredOffice", label: "Säte" });
  if (!has(p.bankgiro) && !has(p.plusgiro)) gaps.push({ key: "giro", label: "Bankgiro eller plusgiro" });
  return gaps;
}

/**
 * The profile for someone who may not see a sole trader's whole personal number (everyone but the company's own administrator):
 * the number is shown as ÅÅMMDD-•••• (2026-11-04). An organisation number is public and stays as it is.
 */
export function profileWithMaskedNumber<T>(profile: T): T {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return profile;
  const record = profile as Record<string, unknown>;
  if (record.companyType !== "soleTrader" || typeof record.organizationNumber !== "string" || !record.organizationNumber) return profile;
  return { ...record, organizationNumber: maskPersonalNumber(record.organizationNumber) } as T;
}

/** The VAT number a Swedish company normally has (SE + organisation number + 01); offered as a hint, never filled in without a choice. */
export const vatNumberHint = (organizationDigits: string) => (organizationDigits.length === 10 ? `SE${organizationDigits}01` : "");

/** The details of Företagsuppgifter that Kom igång and the product administration's company page write (the profile's text fields and F-skatt). */
export const COMPANY_DETAIL_KEYS = ["companyType", "organizationNumber", "vatNumber", "fSkatt", "address", "postalCode", "city", "contactName", "email", "phone", "billingEmail", "registeredOffice", "bankgiro", "plusgiro"] as const;
export type CompanyDetailKey = (typeof COMPANY_DETAIL_KEYS)[number];

/**
 * The saved profile with only the given details changed (2026-11-04). Each given value is checked by the profile's own
 * rules (lengths, e-mail form, giro digits) and the rest of the stored profile – the place, the notes, what the company works
 * with – stays exactly as it was. Throws the schema's error for a value it refuses.
 */
export function mergeCompanyDetails(stored: unknown, given: Partial<Record<CompanyDetailKey, string | boolean>>): Record<string, unknown> {
  const current = (stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {}) as Record<string, unknown>;
  const provided = Object.fromEntries(Object.entries(given).filter(([key, value]) => value !== undefined && (COMPANY_DETAIL_KEYS as readonly string[]).includes(key)));
  const checked = companyProfileSchema.parse({ ...current, ...provided }) as Record<string, unknown>;
  return { ...current, ...Object.fromEntries(Object.keys(provided).map((key) => [key, checked[key]])) };
}
