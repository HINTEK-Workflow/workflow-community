import { readFileSync } from "node:fs";
import type { ReportFontSet } from "../../lib/workflow/report-fonts";

/** The document typeface as the server loads it (lib/workflow/report-server.ts): Manrope Regular and Bold with DejaVu Sans behind them. */
export function reportFontBytes(): ReportFontSet {
  const read = (name: string) => new Uint8Array(readFileSync(`public/fonts/${name}`));
  return { regular: read("Manrope-Regular.ttf"), bold: read("Manrope-Bold.ttf"), fallback: read("DejaVuSans.ttf") };
}
