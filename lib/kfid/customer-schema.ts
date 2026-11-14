import { z } from "zod";
import { normalizePostalCode } from "@/lib/postal-code";

/** Kundtyp (2026-10-10): the same two values as the quote's customer type (lib/quotes/model.ts). */
export const CUSTOMER_TYPES = ["COMPANY", "PRIVATE"] as const;

/** A customer in the register (Cloud and the Local file share the same fields). */
const short = z.string().max(500);
const coordinate = (max: number) =>
  z
    .preprocess(
      (v) =>
        v == null || v === ""
          ? null
          : typeof v === "string"
            ? Number(v.replace(",", "."))
            : v,
      z.number().min(-max).max(max).nullable(),
    )
    .optional();
export const customerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  company: short.default(""),
  address: short.default(""),
  postalCode: short.default("").transform(normalizePostalCode),
  city: short.default(""),
  email: z
    .string()
    .max(254)
    .refine((v) => !v || z.email().safeParse(v).success, "Ogiltig e-post")
    .default(""),
  phone: short.default(""),
  mobile: short.default(""),
  lat: coordinate(90),
  lng: coordinate(180),
  notes: z.string().max(5000).default(""),
  // Särskilda krav (2026-10-07): what the customer requires beyond the ordinary way of working. Optional without a
  // default, so a client or a tool that does not send it (an older page, the API tools) never empties what is stored.
  specialRequirements: z.string().max(8000).optional(),
  // Kundtyp (2026-10-10): a company or a private person, the quote's own values. Optional without a default for the
  // same reason: a page, a file or a tool that does not send it keeps what is stored (a new customer starts as a company).
  customerType: z.enum(CUSTOMER_TYPES).optional(),
  // Kundnummer i bokföringen (2026-10-11, plan 1L): the customer's number in the company's accounts (Fortnox),
  // at most 60 characters, trimmed. Optional without a default, so a sender without it keeps what is stored.
  accountingCustomerNumber: z.string().trim().max(60).optional(),
});

/** The customer types, with the quote's words (Företag / Privatperson). */
export type CustomerType = (typeof CUSTOMER_TYPES)[number];
export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = { COMPANY: "Företag", PRIVATE: "Privatperson" };
/** A stored or sent value as a type; anything else (an older file, a missing field) is a company. */
export const customerTypeOf = (value: unknown): CustomerType => value === "PRIVATE" ? "PRIVATE" : "COMPANY";
