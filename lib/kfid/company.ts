import { z } from "zod";
const text = z.string().max(300).default("");
const email = z.union([z.literal(""), z.email()]).default("");
export const companyProfileSchema = z.object({
  organizationNumber: text,
  vatNumber: text,
  address: text,
  postalCode: text,
  city: text,
  contactName: text,
  email,
  phone: text,
  installerEmail: email,
  billingEmail: email,
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
});
export const blankCompanyProfile = companyProfileSchema.parse({});
