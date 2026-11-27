import { prisma } from "@/lib/db";
import { buildMailingEmail, validWebVersion } from "@/lib/mail/mailings";

export const dynamic = "force-dynamic";

// Visa i webbläsaren (2026-10-04): a sent mailing as a web page, for when a mail program blocks its content.
// Public behind the mailing's signed address, without anyone's way to say no. The page is sandboxed: no scripts, its
// own origin, and nothing but images and inline styles may load, so even the mailing's own HTML block can do no harm.
const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "sandbox allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation; default-src 'none'; img-src http: https:; style-src 'unsafe-inline'; frame-ancestors 'none'",
};

const missing = () => new Response(`<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Utskicket finns inte</title></head>
<body style="margin:0;padding:48px 16px;background:#f3f7ff;font-family:'Segoe UI',Arial,sans-serif;color:#172033;text-align:center;">
<h1 style="margin:0 0 12px;font-size:20px;">Utskicket finns inte</h1>
<p style="font-size:15px;">Utskicket finns inte längre, eller så är länken ofullständig.</p></body></html>`, { status: 404, headers: HEADERS });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  if (!id || id.length > 64 || !validWebVersion(id, token)) return missing();
  const mailing = await prisma.mailing.findUnique({ where: { id }, select: { subject: true, body: true, audience: true } });
  if (!mailing) return missing();
  const { html } = buildMailingEmail({ subject: mailing.subject, body: mailing.body, unsubscribe: null, newsletter: mailing.audience === "NEWSLETTER" });
  const titled = html.replace("</head>", `<title>${mailing.subject.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)}</title></head>`);
  return new Response(titled, { headers: HEADERS });
}
