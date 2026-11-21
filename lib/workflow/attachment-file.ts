import "server-only";
import sharp from "sharp";
import { ApiError } from "@/lib/kfid/server";

export const MAX_ATTACHMENT_BYTES = 10_000_000;

/** The file as it is stored: images are turned upright and made JPEG, other files must be what their name says. */
export async function prepareAttachmentFile(file: File) {
  if (!file.size || file.size > MAX_ATTACHMENT_BYTES) throw new ApiError(400, "Välj en fil på högst 10 MB.");
  let buffer = Buffer.from(await file.arrayBuffer());
  let mimeType = file.type;
  let extension = "";
  if (["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    try { buffer = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer(); }
    catch { throw new ApiError(400, "Bilden kunde inte läsas. Välj JPG, PNG eller WebP."); }
    mimeType = "image/jpeg"; extension = "jpg";
  } else if (mimeType === "application/pdf" && buffer.subarray(0, 5).toString() === "%PDF-") extension = "pdf";
  else if (file.name.toLowerCase().endsWith(".txt") && !buffer.includes(0)) { extension = "txt"; mimeType = "text/plain"; }
  else if (/\.(docx|xlsx)$/i.test(file.name) && buffer[0] === 0x50 && buffer[1] === 0x4b) { extension = file.name.toLowerCase().endsWith(".docx") ? "docx" : "xlsx"; mimeType = "application/octet-stream"; }
  else throw new ApiError(400, "Tillåtna filer: JPG, PNG, WebP, PDF, TXT, DOCX och XLSX.");
  return { buffer, mimeType, extension };
}
