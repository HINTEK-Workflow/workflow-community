import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { tagAttribute } from "./blocks";
import { siteOrigin, siteRoot } from "./frame";
import { facesToCopy, fontFaceCss, frameBaseFont, isWebFont, readSiteLook, type CssSource, type SiteLookStyles, type StoredFace } from "./site-look";
import { fetchPublic, fetchSitePage, type WpConfig } from "./wp-client";

/**
 * Sajtens utseende (2026-11-10) on the server: reads the site's public front page once – on connecting and on Kontrollera, and
 * when the editor opens a site that has none yet – with the same protected requests as the rest of Min webbsida (net.ts), takes
 * the css it loads in order (its own stylesheets, its inline css and the font css it links from Google Fonts), reads the
 * typography (site-look.ts) and copies the web fonts it uses to Workflow (woff2/woff only, at most 12, 1.5 MB each, from the
 * addresses that css names; net.ts's rules apply). The browser then never loads anything from the font's host. When anything
 * fails the look is stored as not read, and the editor says "Sajtens typsnitt kunde inte läsas" and uses a close system font.
 */
const MAX_SHEETS = 15;
const MAX_CSS_BYTES = 1024 * 1024;
const MAX_FONT_BYTES = 1.5 * 1024 * 1024;
/** Font css from these hosts is read as well as the site's own (the files it names come from wherever it says, under net.ts). */
const FONT_CSS_HOSTS = new Set(["fonts.googleapis.com"]);
// Google Fonts answers woff2 only to a browser it knows.
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

type Copied = Omit<StoredFace, "data"> & { bytes: Buffer };
export type StoredLook = { ok: boolean; readAt: string; styles?: SiteLookStyles; families?: string[] };
export const lookOf = (value: Prisma.JsonValue | null | undefined): StoredLook | null => (value && typeof value === "object" && !Array.isArray(value) && typeof (value as StoredLook).readAt === "string" ? value as unknown as StoredLook : null);

/** The page's css in the order it loads it: linked stylesheets (the site's own and font css) and inline <style>. */
async function cssOf(config: Pick<WpConfig, "baseUrl">, pageUrl: string, html: string): Promise<CssSource[]> {
  const origin = siteOrigin(config.baseUrl);
  const head = html.slice(0, Math.max(0, html.search(/<\/head>/i)) || Math.min(html.length, 1_000_000));
  const sources: CssSource[] = [];
  let sheets = 0;
  for (const match of head.matchAll(/<link\b[^>]*>|<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    if (match[0].toLowerCase().startsWith("<style")) { sources.push({ css: match[1] ?? "", url: pageUrl }); continue; }
    const tag = match[0];
    if (!/\bstylesheet\b/i.test(tagAttribute(tag, "rel") ?? "") || /^print$/i.test((tagAttribute(tag, "media") ?? "").trim())) continue;
    let url: URL;
    try { url = new URL((tagAttribute(tag, "href") ?? "").replace(/&amp;/g, "&"), pageUrl); } catch { continue; }
    const fonts = FONT_CSS_HOSTS.has(url.hostname);
    if (url.origin !== origin && !fonts) continue;
    if (++sheets > MAX_SHEETS) break;
    try {
      const answer = await fetchPublic(url.href, { accept: "text/css,*/*;q=0.1", maxBytes: MAX_CSS_BYTES, userAgent: fonts ? BROWSER : undefined });
      if (answer.status === 200 && answer.type === "text/css") sources.push({ css: answer.bytes.toString("utf8"), url: url.href });
    } catch { /* a sheet that cannot be read is left out */ }
  }
  return sources;
}

/** Reads the site's look and copies its fonts; returns whether it could be read. */
export async function refreshSiteLook(organizationId: string, config: Pick<WpConfig, "baseUrl">): Promise<boolean> {
  const readAt = new Date().toISOString();
  let look: StoredLook = { ok: false, readAt };
  const fonts: Copied[] = [];
  try {
    const root = siteRoot(config.baseUrl);
    if (!root) throw new Error("no root");
    const html = await fetchSitePage(config, root);
    const { styles, faces } = readSiteLook(await cssOf(config, root, html));
    if (!styles.body.family && !Object.values(styles.headings).some((heading) => heading?.family)) throw new Error("no typography");
    for (const face of facesToCopy(faces, styles)) {
      try {
        const file = await fetchPublic(face.url, { accept: "font/woff2,font/woff,*/*;q=0.1", maxBytes: MAX_FONT_BYTES, userAgent: BROWSER });
        if (file.status === 200 && isWebFont(file.bytes)) fonts.push({ family: face.family, weight: face.weight, style: face.style, format: file.bytes[3] === 0x32 ? "woff2" : "woff", unicodeRange: face.unicodeRange, bytes: file.bytes });
      } catch { /* a font that cannot be read is left out: the fallback shows */ }
    }
    look = { ok: true, readAt, styles, families: [...new Set(fonts.map((font) => font.family))] };
  } catch { look = { ok: false, readAt }; }
  await prisma.$transaction([
    prisma.websiteFont.deleteMany({ where: { organizationId } }),
    ...fonts.map((font) => prisma.websiteFont.create({ data: { organizationId, family: font.family, weight: font.weight, style: font.style, format: font.format, unicodeRange: font.unicodeRange ?? null, bytes: new Uint8Array(font.bytes) } })),
    prisma.websiteConnection.updateMany({ where: { organizationId }, data: { look: look as unknown as Prisma.InputJsonValue } }),
  ]);
  return look.ok;
}

/** What the editor and the frames need: the look (or null while none is read), and the fonts as @font-face with data: addresses. */
export async function siteLookView(organizationId: string): Promise<{ look: StoredLook | null; fontCss: string; baseFont: string }> {
  const [row, fonts] = await Promise.all([
    prisma.websiteConnection.findUnique({ where: { organizationId }, select: { look: true } }),
    prisma.websiteFont.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, take: 12 }),
  ]);
  const look = lookOf(row?.look);
  const fontCss = fontFaceCss(fonts.map((font) => ({ family: font.family, weight: font.weight, style: font.style, format: font.format === "woff" ? "woff" : "woff2", unicodeRange: font.unicodeRange ?? undefined, data: Buffer.from(font.bytes).toString("base64") })));
  return { look, fontCss, baseFont: frameBaseFont(look?.ok ? look.styles ?? null : null) };
}
