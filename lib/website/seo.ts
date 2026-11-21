/**
 * Sökmotorer och delning on a company's WordPress page (Min webbsida, 2026-11-11). Plain WordPress has no such fields; the
 * optional plugin Workflow SEO registers four post meta keys with show_in_rest (the contract in docs/drift/MIN_WEBBSIDA.md §3b):
 *
 *   hintek_seo_title (string, at most 70), hintek_seo_description (string, at most 200),
 *   hintek_seo_noindex (boolean), hintek_seo_image (integer, the attachment's id, 0 = the site's own fallback picture).
 *
 * They are read and written in `meta` of wp/v2/pages/<id> (context=edit). A site supports them when that page's `meta` holds
 * the keys; otherwise nothing here is shown and no `meta` is ever sent, so a site without the plugin works exactly as before.
 * Pure functions only (the editor and the server share them).
 */
export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 200;
export const SEO_IMAGE_MAX_ID = 1_000_000_000;

export type PageSeo = { title: string; description: string; noindex: boolean; image: number };
export const EMPTY_SEO: PageSeo = { title: "", description: "", noindex: false, image: 0 };

export const SEO_META_KEYS = { title: "hintek_seo_title", description: "hintek_seo_description", noindex: "hintek_seo_noindex", image: "hintek_seo_image" } as const;
export const SEO_NAMESPACE = "hintek-seo/v1";

/** Characters as WordPress counts them (mb_strlen: code points, not UTF-16 units). */
export const seoLength = (value: string) => [...value].length;

/** One line of plain text: control characters and line breaks become spaces, runs of spaces one, no space at the ends. */
export function cleanSeoText(value: string) {
  // Control characters and the line and paragraph separators become spaces.
  return value.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s{2,}/g, " ").trim();
}

/**
 * The page's SEO values from WordPress's `meta`, or null when the site does not have them (no plugin: `meta` is an empty list,
 * missing, or lacks the keys). The values are taken as they come, with the plugin's types; anything odd counts as empty.
 */
export function seoFromMeta(meta: unknown): PageSeo | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const record = meta as Record<string, unknown>;
  if (!(SEO_META_KEYS.title in record) || !(SEO_META_KEYS.description in record)) return null;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const image = Number(record[SEO_META_KEYS.image]);
  const noindex = record[SEO_META_KEYS.noindex];
  return {
    title: text(record[SEO_META_KEYS.title]),
    description: text(record[SEO_META_KEYS.description]),
    noindex: noindex === true || noindex === 1 || noindex === "1" || noindex === "true",
    image: Number.isInteger(image) && image > 0 && image <= SEO_IMAGE_MAX_ID ? image : 0,
  };
}

/** Whether the REST index names the plugin's own namespace (a second sign, used where no page has been read). */
export function indexHasSeo(index: unknown) {
  const namespaces = (index as { namespaces?: unknown } | null)?.namespaces;
  return Array.isArray(namespaces) && namespaces.includes(SEO_NAMESPACE);
}

/** Why the values cannot be written, or null. The server checks this on every save and publish. */
export function seoProblem(seo: PageSeo): string | null {
  if (seoLength(seo.title) > SEO_TITLE_MAX) return `Sidtiteln får vara högst ${SEO_TITLE_MAX} tecken.`;
  if (seoLength(seo.description) > SEO_DESCRIPTION_MAX) return `Beskrivningen får vara högst ${SEO_DESCRIPTION_MAX} tecken.`;
  if (!Number.isInteger(seo.image) || seo.image < 0 || seo.image > SEO_IMAGE_MAX_ID) return "Delningsbilden är ogiltig.";
  if (typeof seo.noindex !== "boolean") return "Valet för sökmotorer är ogiltigt.";
  return null;
}

/** The values as they are stored and sent: the texts cleaned to one line. */
export const normalSeo = (seo: PageSeo): PageSeo => ({ title: cleanSeoText(seo.title), description: cleanSeoText(seo.description), noindex: seo.noindex === true, image: Math.trunc(seo.image) || 0 });

export const sameSeo = (left: PageSeo | null | undefined, right: PageSeo | null | undefined) =>
  !left || !right ? !left && !right
    : left.title === right.title && left.description === right.description && left.noindex === right.noindex && left.image === right.image;

/**
 * The `meta` for wp/v2/pages/<id>: only the keys whose value differs from what WordPress has now; null when nothing differs.
 * Never anything but the four keys.
 */
export function seoMetaPayload(next: PageSeo, current: PageSeo): Record<string, string | number | boolean> | null {
  const meta: Record<string, string | number | boolean> = {};
  if (next.title !== current.title) meta[SEO_META_KEYS.title] = next.title;
  if (next.description !== current.description) meta[SEO_META_KEYS.description] = next.description;
  if (next.noindex !== current.noindex) meta[SEO_META_KEYS.noindex] = next.noindex;
  if (next.image !== current.image) meta[SEO_META_KEYS.image] = next.image;
  return Object.keys(meta).length ? meta : null;
}

/** A stored value (a draft's or a backup's JSON) read back, or null. */
export function storedSeo(value: unknown): PageSeo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.title !== "string" || typeof row.description !== "string" || typeof row.noindex !== "boolean" || typeof row.image !== "number") return null;
  return { title: row.title, description: row.description, noindex: row.noindex, image: row.image };
}
