import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { read } from "@/lib/kfid/storage";
import { boardImageFor } from "./server";
import type { BoardLayout } from "./model";

/**
 * Small shared parts of the routes under /skarm/api and /visa/api (Tavlor etapp 2, 2026-11-18): the cookies' common settings (HttpOnly,
 * Secure on https, their own path so they never reach /api), the answers without caching, a picture of the shown board, and the
 * pairing page's QR code made on this server.
 */
export const viewerCookie = (path: string, maxAgeSeconds: number) => ({ httpOnly: true, secure: new URL(env.APP_URL).protocol === "https:", sameSite: "strict" as const, path, maxAge: maxAgeSeconds });
export const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
export const appOrigin = () => new URL(env.APP_URL).origin;

/** The address the QR code on a screen leads to: Skärmar with the code filled in (only the code, never the screen's secret). */
export const pairPageUrl = (code: string) => `${appOrigin()}/?view=boards&tab=screens&koppla=${encodeURIComponent(code)}`;
export const qrSvg = (text: string) => QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#000000", light: "#ffffff" } });

export async function imageAnswer(organizationId: string, layouts: BoardLayout[], id: string | null) {
  const image = id ? await boardImageFor(organizationId, layouts, id.slice(0, 60)) : null;
  if (!image) return NextResponse.json({ error: "Bilden finns inte." }, { status: 404, headers: noStore });
  return new Response(new Uint8Array(await read(image.storagePath)), { headers: { "Content-Type": image.mimeType, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
