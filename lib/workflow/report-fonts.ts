/**
 * The document typeface (2026-11-03, the new PDF design): Manrope Regular and Bold (SIL Open Font License,
 * public/fonts/Manrope-LICENSE.txt) embedded in every PDF, with DejaVu Sans as the fallback for glyphs Manrope lacks
 * (☐, ✓ and other symbols). A document is drawn from the three files; a bare Uint8Array (one font for everything) is
 * still accepted so a caller with a single font keeps working.
 */
export type ReportFontSet = { regular: Uint8Array; bold: Uint8Array; fallback?: Uint8Array | null };
export type ReportFontBytes = Uint8Array | ReportFontSet;

/** The files under public/fonts, as the browser fetches them (Local draws its PDFs in the browser). */
export const REPORT_FONT_FILES = { regular: "/fonts/Manrope-Regular.ttf", bold: "/fonts/Manrope-Bold.ttf", fallback: "/fonts/DejaVuSans.ttf" } as const;

export function reportFontSet(bytes: ReportFontBytes): ReportFontSet {
  return bytes instanceof Uint8Array ? { regular: bytes, bold: bytes, fallback: null } : bytes;
}

/** The font set fetched in the browser; a failed fetch is a plain Swedish error, like before. */
export async function fetchReportFonts(fetcher: typeof fetch = fetch): Promise<ReportFontSet> {
  const load = async (path: string) => {
    const response = await fetcher(path);
    if (!response.ok) throw new Error("Typsnittet för PDF kunde inte läsas in.");
    return new Uint8Array(await response.arrayBuffer());
  };
  const [regular, bold, fallback] = await Promise.all([load(REPORT_FONT_FILES.regular), load(REPORT_FONT_FILES.bold), load(REPORT_FONT_FILES.fallback)]);
  return { regular, bold, fallback };
}
