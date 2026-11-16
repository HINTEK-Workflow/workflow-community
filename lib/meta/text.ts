/**
 * Inlägg (2026-11-10): the post's texts, pure – shared by the server, the page and the tests.
 *
 * A post has a heading and a short text drawn in the picture, the post's own text (the caption) and – Facebook only – a link
 * after the text (Instagram shows no links in a caption). The limits are Instagram's, the strictest, when Instagram is chosen;
 * LinkedIn (2026-11-11) takes up to 3000 characters for the text and the link together.
 */
export const HEADING_MAX = 90;
export const BODY_MAX = 220;
/** Instagram's limit for the caption. */
export const CAPTION_MAX = 2200;
/** LinkedIn's limit for a post's text, here the text and the link (Posts API schema, commentary). */
export const LINKEDIN_COMMENTARY_MAX = 3000;
/** The longest text stored: the most any channel takes. */
export const CAPTION_STORE_MAX = LINKEDIN_COMMENTARY_MAX;
export const HASHTAGS_MAX = 30;
export const MENTIONS_MAX = 20;
export const LINK_MAX = 500;
/** Bara på Instagram (2026-11-16): the longest text added only to Instagram's caption. */
export const INSTAGRAM_TEXT_MAX = 300;
/** Fler bilder (2026-11-16): the most pictures in one post (the drawn one and up to nine more; Instagram takes 20, kept at 10). */
export const IMAGES_MAX = 10;
export const EXTRA_IMAGES_MAX = IMAGES_MAX - 1;

/** The picture (2026-11-12): portrait 4:5, Instagram's largest feed format; the same JPEG goes to Facebook and LinkedIn. */
export const IMAGE_WIDTH = 1080;
export const IMAGE_HEIGHT = 1350;
/** Instagram's profile grid shows a 3:4 tile, centred: the part of the picture that is seen there. */
export const GRID_CROP = { x: (IMAGE_WIDTH - (IMAGE_HEIGHT * 3) / 4) / 2, width: (IMAGE_HEIGHT * 3) / 4 };

/** The picture's templates (lib/meta/image.ts); `hint` is the picker's one-line description. Square, for every channel. */
export const POST_TEMPLATES = [
  { key: "color", label: "Färg", hint: "Rubrik och text på företagets färg" },
  { key: "light", label: "Ljus", hint: "Vit bakgrund med en färgad list" },
  { key: "frame", label: "Ram", hint: "Vitt kort i en färgad ram" },
  { key: "split", label: "Delad", hint: "Rubriken på färg, texten under" },
  { key: "dark", label: "Mörk", hint: "Mörkblå bakgrund med färgen som accent" },
  { key: "band", label: "Rand", hint: "Färg med en sned kant och vitt nertill" },
  { key: "tips", label: "Tips", hint: "Ett runt Tips-märke över rubriken" },
  { key: "news", label: "Nyhet", hint: "En Nytt-flik från överkanten" },
  { key: "figure", label: "Siffra", hint: "Rubriken mycket stor, som ett nyckeltal" },
  { key: "quote", label: "Citat", hint: "Texten som citat, rubriken som vem som säger det" },
  { key: "checklist", label: "Checklista", hint: "Textens rader som bockade punkter" },
  { key: "reminder", label: "Påminnelse", hint: "En kalender och ordet Påminnelse" },
  // Fler bakgrunder (2026-11-13): fixed white, blue and black, whatever the company's colour; the colour stays as an accent.
  { key: "white", label: "Vit", hint: "Vit bakgrund och mörk text" },
  { key: "blue", label: "Blå", hint: "Blå bakgrund och vit text" },
  { key: "black", label: "Svart", hint: "Svart bakgrund och vit text" },
] as const;
export type PostTemplate = (typeof POST_TEMPLATES)[number]["key"];
export const isTemplate = (value: string): value is PostTemplate => POST_TEMPLATES.some((template) => template.key === value);

/**
 * Logga (2026-11-13): which of the company's logos the picture uses. Automatiskt takes the variant made for the template's
 * background (Logga för mörk bakgrund on a dark one, Logga för ljus bakgrund or Logga i svart on a light one) and the logo itself
 * when the company has not uploaded that variant (lib/meta/image.ts, pickLogo).
 */
export const LOGO_VARIANTS = [
  { key: "auto", label: "Automatiskt" },
  { key: "main", label: "Logotypen" },
  { key: "onDark", label: "För mörk bakgrund" },
  { key: "onLight", label: "För ljus bakgrund" },
  { key: "black", label: "Svart" },
] as const;
export type LogoVariant = (typeof LOGO_VARIANTS)[number]["key"];
export const isLogoVariant = (value: string): value is LogoVariant => LOGO_VARIANTS.some((variant) => variant.key === value);
export const LOGO_SIZES = [
  { key: "small", label: "Liten" },
  { key: "medium", label: "Mellan" },
  { key: "large", label: "Stor" },
] as const;
export type LogoSize = (typeof LOGO_SIZES)[number]["key"];
export const isLogoSize = (value: string): value is LogoSize => LOGO_SIZES.some((size) => size.key === value);
/**
 * Bakgrund bakom logotypen (2026-11-15): Ruta keeps the plate the template gives the logo (a white box on a dark template);
 * Ingen draws every variant directly on the template. Missing is Ruta, so earlier posts look the same.
 */
export const LOGO_PLATES = [
  { key: "box", label: "Ruta" },
  { key: "none", label: "Ingen" },
] as const;
export type LogoPlate = (typeof LOGO_PLATES)[number]["key"];
export const isLogoPlate = (value: string): value is LogoPlate => LOGO_PLATES.some((plate) => plate.key === value);

/**
 * The checklist template's rows: the text's lines, or its sentences when it is one line; list marks (-, •, *, ✓) are taken
 * off; at most four rows. Pure.
 */
export function checklistItems(body: string): string[] {
  const clean = (items: string[]) => items.map((item) => item.replace(/^\s*(?:[-•*✓✔]|\d+[.)])\s*/u, "").trim()).filter(Boolean);
  let items = clean(body.split(/\n+/));
  if (items.length === 1) items = clean(items[0].split(/(?<=[.!?;])\s+/));
  return items.slice(0, 4);
}

/**
 * The post's texts; `hashtags` (2026-11-12): its own field, "#tag #tag", added after the caption on every channel.
 * `instagramText` (2026-11-16): added only to Instagram's caption. `campaignLinks` (2026-11-16): the channel's ?via= on links to the
 * installation's own addresses (campaignText).
 */
export type PostText = { heading: string; body: string; caption: string; link: string | null; hashtags?: string; instagramText?: string; campaignLinks?: boolean };

/** The most hashtags the field keeps (Instagram's limit for a whole post). */
export const HASHTAG_FIELD_MAX = 30;
/** The field's longest stored text. */
export const HASHTAG_STORE_MAX = 1000;
const HASHTAG = /#[\p{L}\p{N}_]+/gu;

/**
 * Hashtaggar (2026-11-12): free text to "#tag #tag": words split on spaces, commas and #; each gets one #, keeps only
 * letters (åäö too), digits and _; doubles (any case) and empty words go; at most HASHTAG_FIELD_MAX and HASHTAG_STORE_MAX. Pure.
 */
export function normalizeHashtags(input: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  let length = 0;
  for (const word of input.normalize("NFC").split(/[\s,;#]+/u)) {
    const tag = word.replace(/[^\p{L}\p{N}_]/gu, "");
    const key = tag.toLocaleLowerCase("sv");
    if (!tag || seen.has(key)) continue;
    if (out.length >= HASHTAG_FIELD_MAX || length + tag.length + 2 > HASHTAG_STORE_MAX) break;
    seen.add(key);
    out.push(`#${tag}`);
    length += tag.length + 2;
  }
  return out.join(" ");
}

/** The hashtags of a text (the field or a caption) as a list. */
export const hashtagList = (text: string | null | undefined) => (text ?? "").match(HASHTAG) ?? [];

export type PostChannel = "facebook" | "instagram" | "linkedin";

/**
 * Kampanjlänkar (2026-11-15, built 2026-11-16): an address on one of the installation's own hosts gets ?via=<channel>, so
 * Beteendeanalys can tell which channel brought the visit (lib/analytics/catalog.ts, demoStartKey). An address that already has
 * a via keeps it; any other address is left as it is. Pure.
 */
export function campaignLink(url: string, channel: PostChannel, hosts: readonly string[]): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return url; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return url;
  const own = hosts.map((host) => host.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);
  if (!own.includes(parsed.host.toLowerCase()) && !own.includes(parsed.hostname.toLowerCase())) return url;
  if (parsed.searchParams.has("via")) return url;
  parsed.searchParams.set("via", channel);
  return parsed.toString();
}

/** Every https/http address in a text through campaignLink; a full stop or bracket right after an address stays outside it. Pure. */
export function campaignText(text: string, channel: PostChannel, hosts: readonly string[]): string {
  if (!hosts.length) return text;
  return text.replace(/https?:\/\/[^\s<>"]+/gi, (match) => {
    const tail = /[.,;:!?)\]'’”]+$/u.exec(match)?.[0] ?? "";
    const url = tail ? match.slice(0, -tail.length) : match;
    return campaignLink(url, channel, hosts) + tail;
  });
}

/**
 * The caption a channel gets: the post's text, then (Instagram only) the Instagram text, then its hashtags after one blank line,
 * then (Facebook and LinkedIn) the link on its own line; with campaignLinks and `hosts`, the channel's ?via= on the own links.
 * The stored caption itself never holds the field's hashtags; the newsletter uses the caption alone.
 */
export function captionWithHashtags(post: Pick<PostText, "caption" | "link" | "hashtags" | "instagramText" | "campaignLinks">, channel: PostChannel, hosts: readonly string[] = []): string {
  const extra = channel === "instagram" ? (post.instagramText ?? "").trim() : "";
  const text = [post.caption.trim(), extra, normalizeHashtags(post.hashtags ?? "")].filter(Boolean).join("\n\n");
  const full = channel !== "instagram" && post.link ? `${text}\n\n${post.link}` : text;
  return post.campaignLinks ? campaignText(full, channel, hosts) : full;
}

export type PostChannels = { toFacebook: boolean; toInstagram: boolean; toLinkedIn?: boolean };

/** The longest caption the chosen channels take: Instagram's when it is chosen, else the stored maximum. Pure. */
export const captionLimit = (channels: PostChannels) => (channels.toInstagram ? CAPTION_MAX : CAPTION_STORE_MAX);

/** Why the post cannot be published as it is, or null. */
export function postProblem(post: PostText & PostChannels): string | null {
  if (!post.toFacebook && !post.toInstagram && !post.toLinkedIn) return "Välj Facebook, Instagram, LinkedIn eller flera.";
  if (!post.heading.trim()) return "Skriv en rubrik till bilden.";
  if (post.heading.length > HEADING_MAX) return `Rubriken får vara högst ${HEADING_MAX} tecken.`;
  if (post.body.length > BODY_MAX) return `Texten i bilden får vara högst ${BODY_MAX} tecken.`;
  if (!post.caption.trim()) return "Skriv inläggets text.";
  if ((post.instagramText ?? "").length > INSTAGRAM_TEXT_MAX) return `Texten bara för Instagram får vara högst ${INSTAGRAM_TEXT_MAX} tecken.`;
  const max = captionLimit(post);
  if (post.caption.length > max) return `Inläggets text får vara högst ${max} tecken${post.toInstagram ? " (Instagrams gräns)" : ""}.`;
  if (post.toInstagram && instagramCaption(post).length > CAPTION_MAX) return `Texten och hashtaggarna får vara högst ${CAPTION_MAX} tecken tillsammans (Instagrams gräns).`;
  if (post.toInstagram && (post.caption.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length + hashtagList(normalizeHashtags(post.hashtags ?? "")).length > HASHTAGS_MAX) return `Instagram tillåter högst ${HASHTAGS_MAX} hashtaggar, i texten och under Hashtaggar tillsammans.`;
  if (post.toInstagram && (post.caption.match(/(^|\s)@[\w.]+/g) ?? []).length > MENTIONS_MAX) return `Instagram tillåter högst ${MENTIONS_MAX} omnämnanden.`;
  if (post.link && !safeLink(post.link)) return "Länken ska börja med https://.";
  if (post.toLinkedIn && linkedInCommentary(post).length > LINKEDIN_COMMENTARY_MAX) return `LinkedIn tar högst ${LINKEDIN_COMMENTARY_MAX} tecken för texten, hashtaggarna och länken tillsammans.`;
  return null;
}

export const safeLink = (value: string) => {
  try { const url = new URL(value); return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && value.length <= LINK_MAX; } catch { return false; }
};

type CaptionInput = Pick<PostText, "caption" | "link" | "hashtags" | "instagramText" | "campaignLinks">;
/** The text Facebook gets: the caption, the hashtags, then the link on its own line. */
export const facebookCaption = (post: CaptionInput, hosts: readonly string[] = []) => captionWithHashtags(post, "facebook", hosts);
/** Instagram's: the caption, the Instagram text and the hashtags (Instagram shows no links in a caption). */
export const instagramCaption = (post: Omit<CaptionInput, "link">, hosts: readonly string[] = []) => captionWithHashtags({ ...post, link: null }, "instagram", hosts);
/** The text LinkedIn gets: like Facebook's, the caption, the hashtags and the link on its own line (LinkedIn shows links in the text). */
export const linkedInCommentary = (post: CaptionInput, hosts: readonly string[] = []) => captionWithHashtags(post, "linkedin", hosts);

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#039": "'", "#8211": "–", "#8217": "’" };
/** Markup as plain text: tags and comments out, entities read, spaces collapsed. */
export function plainText(markup: string): string {
  return markup.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (whole, name: string) => ENTITIES[name] ?? (name.startsWith("#") && /^#\d+$/.test(name) ? String.fromCodePoint(Number(name.slice(1))) : whole))
    .replace(/\s+/g, " ").trim();
}

/** Shortens a text at a word, with an ellipsis. */
export function shorten(text: string, max: number): string {
  const clean = text.replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

/** The first paragraph of a page's block markup, as plain text (the picture's short text). */
export function firstParagraph(markup: string): string {
  for (const match of markup.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = plainText(match[1]);
    if (text.length >= 3) return text;
  }
  return "";
}

/** A draft from a page that was just published on the company's website. */
export function draftFromWebsitePage(page: { title: string; markup: string; link: string | null }): PostText {
  const heading = shorten(plainText(page.title) || "Nytt på webbplatsen", HEADING_MAX);
  const paragraph = firstParagraph(page.markup);
  const link = page.link && safeLink(page.link) ? page.link : null;
  return { heading, body: shorten(paragraph, BODY_MAX), caption: shorten([heading, paragraph].filter(Boolean).join("\n\n"), CAPTION_MAX), link };
}

/** A draft from a version's news (lib/release-notes.ts). */
export function draftFromRelease(note: { version: string; summary: string; items: readonly string[] }): PostText {
  const heading = shorten(`Nytt i version ${note.version}`, HEADING_MAX);
  const caption = [note.summary, ...note.items.map((item) => `• ${item}`)].join("\n");
  return { heading, body: shorten(note.summary, BODY_MAX), caption: shorten(caption, CAPTION_MAX), link: null };
}

/**
 * Words into lines no wider than `max` (a word wider than a line stands alone); `measure` gives a text's width. Pure.
 * Line breaks in the text are kept.
 */
export function wrapText(text: string, max: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  for (const part of text.split(/\n/)) {
    const words = part.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > max) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
  }
  return lines;
}
