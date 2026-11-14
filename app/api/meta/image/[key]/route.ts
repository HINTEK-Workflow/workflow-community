import { publicPostImage } from "@/lib/meta/server";

export const dynamic = "force-dynamic";

// Inlägg (2026-11-10): public, because Instagram fetches the picture without signing in. Only a post's picture, by a random key
// that is made just before Instagram is asked and removed right after (at most one hour); nothing else about the post or the
// company is shown, and an unknown or expired key is simply not found.
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const bytes = await publicPostImage((await params).key).catch(() => null);
  if (!bytes) return new Response("Finns inte.", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'", "Cross-Origin-Resource-Policy": "cross-origin",
  } });
}
