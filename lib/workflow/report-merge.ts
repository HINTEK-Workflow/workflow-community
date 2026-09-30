import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";

/**
 * A project report is put together from separate PDFs (the Workflow report, each protocol, each control), and each one
 * numbered its own pages. After merging, every page gets one common footer with continuous numbering – "Sida 3 av 8" –
 * so the whole report reads as one document (totalkontrollen F5, 2026-09-29). The footer line above stays as each part
 * drew it; only the text strip below it is replaced. Shared by Cloud and Local.
 */
export async function stampContinuousFooter(pdf: PDFDocument, input: { fontBytes: Uint8Array; left: string; company: string }) {
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(input.fontBytes, { subset: true });
  const pages = pdf.getPages();
  const muted = rgb(0.35, 0.4, 0.45);
  const size = 6.8;
  pages.forEach((page, index) => {
    const { width } = page.getSize();
    page.drawRectangle({ x: 0, y: 14, width, height: 26, color: rgb(1, 1, 1) });
    const right = `${input.company} · Sida ${index + 1} av ${pages.length}`;
    const left = fit(font, input.left, size, width - 100 - font.widthOfTextAtSize(right, size) - 16);
    page.drawText(left, { x: 50, y: 27, size, font, color: muted });
    page.drawText(right, { x: width - 50 - font.widthOfTextAtSize(right, size), y: 27, size, font, color: muted });
  });
}

function fit(font: { widthOfTextAtSize: (text: string, size: number) => number }, text: string, size: number, max: number) {
  if (font.widthOfTextAtSize(text, size) <= max) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}…`, size) > max) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}
