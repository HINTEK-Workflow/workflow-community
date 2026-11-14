import type { KitIdentity } from "@/lib/workflow/report-kit";
import { DEMO_COMPANY, DEMO_COMPANY_DETAILS } from "./demo-data";

/**
 * PDF:er i demon (2026-11-06: "Tillåt att i demot få testa lite demofaktura och demo pdf:er på kontroller"). The demo has no
 * server, so a document is drawn in this browser with the same report kit as Cloud and Local, from the invented company. Every
 * page is stamped "Demo", nothing is kept and nothing is sent: the file goes only to the visitor's own download.
 */
const DEMO_PDF_NOTE = "påhittade uppgifter, inte ett riktigt dokument";
export const DEMO_PDF_MARK = `Demo – ${DEMO_PDF_NOTE}`;

/** The invented company as the report kit prints it: its name and the sender box, no logo. */
export function demoReportIdentity(): KitIdentity {
  const details = DEMO_COMPANY_DETAILS;
  return { company: DEMO_COMPANY, sender: { organizationNumber: details.organizationNumber, vatNumber: details.vatNumber, fSkatt: details.fSkatt, address: `${details.address}, ${details.postalCode} ${details.city}`, phone: details.phone, email: details.email, registeredOffice: details.registeredOffice, bankgiro: details.bankgiro, plusgiro: details.plusgiro } };
}

/** Stamps every page: a large, light "DEMO" across the page and one short line at the top edge. */
export async function stampDemoPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, degrees, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.load(bytes);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.min(width, height) / 4;
    const word = "DEMO";
    const wide = bold.widthOfTextAtSize(word, size);
    // Centred on the page, turned 45 degrees: the start point is moved back along the text's own direction.
    const angle = Math.PI / 4;
    page.drawText(word, { x: width / 2 - (wide / 2) * Math.cos(angle) + (size / 3) * Math.sin(angle), y: height / 2 - (wide / 2) * Math.sin(angle) - (size / 3) * Math.cos(angle), size, font: bold, color: rgb(0.85, 0.15, 0.15), opacity: 0.1, rotate: degrees(45) });
    const lineSize = 7;
    const line = bold.widthOfTextAtSize("DEMO", lineSize) + regular.widthOfTextAtSize(` · ${DEMO_PDF_NOTE}`, lineSize);
    const x = (width - line) / 2;
    page.drawText("DEMO", { x, y: height - 12, size: lineSize, font: bold, color: rgb(0.75, 0.1, 0.1) });
    page.drawText(` · ${DEMO_PDF_NOTE}`, { x: x + bold.widthOfTextAtSize("DEMO", lineSize), y: height - 12, size: lineSize, font: regular, color: rgb(0.35, 0.35, 0.35) });
  }
  pdf.setKeywords(["Demo"]);
  pdf.setSubject(DEMO_PDF_MARK);
  return pdf.save();
}

/** The answer a PDF route gives, as the server's: the file and its name (Content-Disposition, `filename*=UTF-8''…`). */
export function demoPdfResponse(bytes: Uint8Array, filename: string, inline = false, headers: Record<string, string> = {}) {
  return new Response(new Blob([bytes as BlobPart], { type: "application/pdf" }), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`, ...headers } });
}

/** The file name a demo PDF gets: the usual name with "demo-" first, so a saved file says what it is. */
export const demoFileName = (name: string) => `demo-${name.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")}`;
