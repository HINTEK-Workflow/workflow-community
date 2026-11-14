import { readMailingImage } from "@/lib/mail/mailing-images";

export const dynamic = "force-dynamic";

// Bilder i utskick (2026-10-03): public, because mail programs fetch them without signing in; only images from
// the newsletter folder, by a random name.
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const image = await readMailingImage((await params).key);
  if (!image) return new Response("Finns inte.", { status: 404 });
  return new Response(new Uint8Array(image.bytes), { headers: {
    "Content-Type": image.type, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'", "Cross-Origin-Resource-Policy": "cross-origin",
  } });
}
