import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { publicInstance } from "@/lib/instance";
import { SITE_TAGLINE } from "@/lib/site-metadata";

/**
 * The link preview picture (2026-11-07): the name in plain text on Workflow Blue, never the icon and wordmark logo. Manrope
 * from public/fonts (the PDF's font file; the Gugi file is woff2, which the image renderer cannot read).
 */
export const alt = `Workflow – ${SITE_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function OpenGraphImage() {
  const { name } = publicInstance();
  const font = await readFile(path.join(process.cwd(), "public/fonts/Manrope-Bold.ttf"));
  const tagline = SITE_TAGLINE.charAt(0).toUpperCase() + SITE_TAGLINE.slice(1);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 96px", background: "#113351", color: "#ffffff", fontFamily: "Manrope" }}>
        <div style={{ fontSize: 96, lineHeight: 1.1 }}>{name}</div>
        <div style={{ marginTop: 32, fontSize: 44, lineHeight: 1.3, color: "#cfe0f2" }}>{tagline}</div>
        <div style={{ marginTop: 56, fontSize: 30, color: "#9fbbd8" }}>Operatörsterminal och AI på samma ställe</div>
      </div>
    ),
    { ...size, fonts: [{ name: "Manrope", data: font, weight: 700, style: "normal" }] },
  );
}
