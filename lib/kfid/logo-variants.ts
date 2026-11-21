/**
 * Loggans varianter (2026-11-13): besides its logo the company may upload the logo for a dark background (usually
 * white), for a light background (blue or the colour) and in black, under Inställningar → Företag. Stored like the logo – the
 * same storage, the same size and type checks, the company's own settings row – but as PNG, so a white logo keeps its
 * transparency. The posts' pictures choose the one that reads on the template (lib/meta/image.ts, pickLogo); PDFs and the
 * website may use them later. Pure, so the routes, the page and the tests share it.
 */
export const LOGO_VARIANT_FILES = [
  { key: "onDark", id: "logo-on-dark", column: "logoOnDarkPath", label: "Logga för mörk bakgrund", help: "Oftast vit. Används på mörka mallar." },
  { key: "onLight", id: "logo-on-light", column: "logoOnLightPath", label: "Logga för ljus bakgrund", help: "Blå eller i färg. Används på ljusa mallar." },
  { key: "black", id: "logo-black", column: "logoBlackPath", label: "Logga i svart", help: "Valfri. Används på ljusa mallar om ljus logga saknas." },
] as const;
export type LogoVariantKey = (typeof LOGO_VARIANT_FILES)[number]["key"];
export type LogoVariantColumn = (typeof LOGO_VARIANT_FILES)[number]["column"];

export const logoVariantByKey = (key: string) => LOGO_VARIANT_FILES.find((variant) => variant.key === key) ?? null;
export const logoVariantById = (id: string) => LOGO_VARIANT_FILES.find((variant) => variant.id === id) ?? null;
