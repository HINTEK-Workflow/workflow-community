/**
 * Sajtens utseende i redigeraren (2026-11-10: "the font I edit with must be the same as shown on the WordPress site"):
 * the theme's typography read from the site's own css – font families, weights, sizes, line heights and colours for the body,
 * h1–h6, links and buttons – and the web fonts it uses, so the editor's canvas and the preview frames show the page in the
 * site's own type. Any WordPress: a classic theme's inline css (Astra, …), a block theme's global styles (theme.json, written as
 * css custom properties in <head>) and the font css the page links (the site's own, or Google Fonts).
 *
 * Every value is checked against a narrow pattern before it is kept (it is written into a stylesheet later), and the fonts are
 * copied to Workflow on the server (lib/website/server.ts), so the browser never loads anything from the site's font host
 * (no visitor's address reaches Google). Pure: no network.
 */
export type TextLook = { family?: string; weight?: string; size?: string; lineHeight?: string; color?: string; transform?: string; letterSpacing?: string };
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export const LEVELS: readonly HeadingLevel[] = [1, 2, 3, 4, 5, 6];
export type SiteLookStyles = {
  body: TextLook;
  headings: Partial<Record<HeadingLevel, TextLook>>;
  /** Sizes at smaller widths (the theme's tablet and phone rules). */
  small: { body?: string; headings: Partial<Record<HeadingLevel, string>> };
  link: TextLook;
  button: TextLook & { background?: string };
};
export type FontFaceRef = { family: string; weight: string; style: string; url: string; format: "woff2" | "woff"; unicodeRange?: string };
export type CssSource = { css: string; url: string };

// ---------- reading css ----------

type Rule = { selectors: string[]; declarations: Map<string, string>; media: string | null; atRule: string | null };

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations split on ";" outside parentheses and quotes (url(data:…;base64,…) stays whole). */
function declarationsOf(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let depth = 0; let quote = ""; let start = 0;
  const take = (end: number) => {
    const part = body.slice(start, end);
    const colon = part.indexOf(":");
    if (colon > 0) out.set(part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).replace(/!important/i, "").trim());
  };
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === "\"" || char === "'") quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0) { take(index); start = index + 1; }
  }
  take(body.length);
  return out;
}

/** The rules of a stylesheet in order, @media and @supports opened (with their condition), @font-face kept as such. */
export function parseCss(source: string, media: string | null = null, limit = { rules: 0 }): Rule[] {
  const css = stripComments(source);
  const rules: Rule[] = [];
  let index = 0;
  while (index < css.length && limit.rules < 20_000) {
    const open = css.indexOf("{", index);
    if (open < 0) break;
    // A statement before the rule (@import …; @charset …;) is not part of its selector.
    const raw = css.slice(index, open);
    const prelude = raw.slice(raw.lastIndexOf(";") + 1).trim().replace(/^[}\s]+/, "");
    // The matching brace.
    let depth = 1; let at = open + 1;
    while (at < css.length && depth > 0) { if (css[at] === "{") depth += 1; else if (css[at] === "}") depth -= 1; at += 1; }
    const body = css.slice(open + 1, at - 1);
    index = at;
    limit.rules += 1;
    if (prelude.startsWith("@media")) rules.push(...parseCss(body, prelude.slice(6).trim(), limit));
    else if (prelude.startsWith("@supports") || prelude.startsWith("@layer")) rules.push(...parseCss(body, media, limit));
    else if (prelude.startsWith("@font-face")) rules.push({ selectors: [], declarations: declarationsOf(body), media, atRule: "font-face" });
    else if (prelude.startsWith("@")) continue;
    // Split on commas outside parentheses: `.card :where(h2,h3)` is one selector, not "h3" alone (2026-11-12: it made h3 white).
    else rules.push({ selectors: prelude.split(/,(?![^()]*\))/).map((item) => item.trim().replace(/\s+/g, " ")).filter(Boolean), declarations: declarationsOf(body), media, atRule: null });
  }
  return rules;
}

// ---------- the values kept ----------

const FAMILY = /^[\w\s,'"-]{1,200}$/;
const WEIGHT = /^(normal|bold|[1-9]00)$/;
const LENGTH = /^(\d{1,3}(\.\d{1,4})?(px|rem|em)|(clamp|min|max)\([\d.\s,a-z%+*/()-]{1,120}\))$/i;
const LINE_HEIGHT = /^(normal|\d{1,2}(\.\d{1,4})?(px|em|rem|%)?)$/;
const COLOUR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([\d.,\s%/]{1,60}\))$/i;
const TRANSFORM = /^(none|uppercase|lowercase|capitalize)$/;
const SPACING = /^(normal|-?\d{1,2}(\.\d{1,4})?(px|em|rem))$/;

/** A family list with plain quotes, or undefined. */
export function cleanFamily(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const list = value.split(",").map((part) => part.trim().replace(/^['"]|['"]$/g, "").trim()).filter(Boolean);
  if (!list.length || !list.every((part) => /^[\w\s-]{1,60}$/.test(part)) || !FAMILY.test(value)) return undefined;
  const generic = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "inherit"]);
  return list.map((part) => (generic.has(part.toLowerCase()) ? part.toLowerCase() : `"${part}"`)).join(", ");
}
/** The first family's name ("Karla"), or null. */
export const firstFamily = (value: string | undefined) => value?.split(",")[0]?.trim().replace(/^"|"$/g, "") || null;

function resolveVars(value: string, vars: Map<string, string>, depth = 0): string {
  if (depth > 6 || !value.includes("var(")) return value;
  const next = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_whole, name: string, fallback?: string) => vars.get(name) ?? fallback ?? "");
  return next === value ? value : resolveVars(next, vars, depth + 1);
}

function textLook(declarations: Map<string, string>, vars: Map<string, string>, into: TextLook) {
  const get = (name: string) => { const raw = declarations.get(name); return raw === undefined ? undefined : resolveVars(raw, vars).trim(); };
  const family = cleanFamily(get("font-family"));
  if (family) into.family = family;
  const weight = get("font-weight"); if (weight && WEIGHT.test(weight)) into.weight = weight === "normal" ? "400" : weight === "bold" ? "700" : weight;
  const size = get("font-size"); if (size && LENGTH.test(size)) into.size = size;
  const height = get("line-height"); if (height && LINE_HEIGHT.test(height)) into.lineHeight = height;
  const colour = get("color"); if (colour && COLOUR.test(colour)) into.color = colour;
  const transform = get("text-transform"); if (transform && TRANSFORM.test(transform)) into.transform = transform;
  const spacing = get("letter-spacing"); if (spacing && SPACING.test(spacing)) into.letterSpacing = spacing;
}

const HEADING = (level: number) => new RegExp(`^(?:(?:\\.[\\w-]+|body|html|main|article|:root)\\s+)?(?::where\\()?h${level}(?:\\.[\\w-]+)*\\)?$`, "i");
const BODY = /^(?:html\s+)?body$|^:root$/i;
const LINK = /^(?:(?:\.[\w-]+|body)\s+)?a(?::where\([^)]*\))?(?::not\([^)]*\))?$/i;
const BUTTON = /^(?:(?:\.[\w-]+)\s+)?(?:\.wp-block-button__link|\.wp-element-button|\.ast-button|button|\.wp-block-button \.wp-block-button__link)$/i;
const isDesktop = (media: string | null) => !media || /^(all|screen)$/i.test(media) || (/min-width/i.test(media) && !/max-width/i.test(media));
const smallWidth = (media: string | null) => {
  const match = media ? /max-width\s*:\s*(\d+)px/i.exec(media) : null;
  return match ? Number(match[1]) : null;
};

/** The site's typography from its css, in the order the page loads it (later rules win, as in the browser). */
export function readSiteLook(sources: readonly CssSource[]): { styles: SiteLookStyles; faces: FontFaceRef[] } {
  const styles: SiteLookStyles = { body: {}, headings: {}, small: { headings: {} }, link: {}, button: {} };
  const vars = new Map<string, string>();
  const faces: FontFaceRef[] = [];
  const all = sources.map((source) => ({ source, rules: parseCss(source.css) }));
  // Custom properties first (theme.json's presets), so a rule may use one defined after it.
  for (const { rules } of all) for (const rule of rules) {
    if (rule.atRule || !rule.selectors.some((selector) => /^(:root|body|html)$/i.test(selector))) continue;
    for (const [name, value] of rule.declarations) if (name.startsWith("--") && value.length <= 300) vars.set(name, value);
  }
  let tablet = 0;
  for (const { source, rules } of all) for (const rule of rules) {
    if (rule.atRule === "font-face") {
      const face = fontFaceOf(rule.declarations, source.url);
      if (face) faces.push(face);
      continue;
    }
    const desktop = isDesktop(rule.media);
    const small = smallWidth(rule.media);
    for (const selector of rule.selectors) {
      if (desktop) {
        if (BODY.test(selector)) textLook(rule.declarations, vars, styles.body);
        else if (LINK.test(selector)) textLook(rule.declarations, vars, styles.link);
        else if (BUTTON.test(selector)) {
          textLook(rule.declarations, vars, styles.button);
          const background = resolveVars(rule.declarations.get("background-color") ?? rule.declarations.get("background") ?? "", vars).trim();
          if (COLOUR.test(background)) styles.button.background = background;
        } else for (const level of LEVELS) if (HEADING(level).test(selector)) textLook(rule.declarations, vars, (styles.headings[level] ??= {}));
      } else if (small !== null && small >= 544 && small <= 1100) {
        // The widest "smaller" rule (a tablet's) is the one shown for a narrow editor.
        if (small < tablet) continue;
        tablet = small;
        const size = resolveVars(rule.declarations.get("font-size") ?? "", vars).trim();
        if (!size || !LENGTH.test(size)) continue;
        if (BODY.test(selector)) styles.small.body = size;
        else for (const level of LEVELS) if (HEADING(level).test(selector)) styles.small.headings[level] = size;
      }
    }
  }
  return { styles, faces };
}

/** One @font-face: its family, weight, style and the woff2 (else woff) file, resolved against the stylesheet's address. */
export function fontFaceOf(declarations: Map<string, string>, base: string): FontFaceRef | null {
  const family = firstFamily(cleanFamily(declarations.get("font-family")));
  if (!family) return null;
  const weightRaw = (declarations.get("font-weight") ?? "400").trim();
  const weight = /^([1-9]00)(\s+[1-9]00)?$/.test(weightRaw) ? weightRaw : weightRaw === "bold" ? "700" : "400";
  const style = /^italic$/i.test((declarations.get("font-style") ?? "").trim()) ? "italic" : "normal";
  const src = declarations.get("src") ?? "";
  const candidates = [...src.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)\s*(?:format\(\s*['"]?([\w-]+)['"]?\s*\))?/g)].map((match) => ({ url: match[2], format: (match[3] ?? match[2].split("?")[0].split(".").pop() ?? "").toLowerCase() }));
  const chosen = candidates.find((item) => item.format === "woff2") ?? candidates.find((item) => item.format === "woff");
  if (!chosen || chosen.url.startsWith("data:")) return null;
  let url: URL;
  try { url = new URL(chosen.url, base); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const range = (declarations.get("unicode-range") ?? "").trim();
  return { family, weight, style, url: url.href, format: chosen.format as "woff2" | "woff", ...(range && /^[U+0-9A-F?,\s-]{1,600}$/i.test(range) ? { unicodeRange: range } : {}) };
}

/** The faces worth copying: the families the look uses, latin and latin-ext only, at most `max`. */
export function facesToCopy(faces: readonly FontFaceRef[], styles: SiteLookStyles, max = 12): FontFaceRef[] {
  const used = new Set([styles.body.family, styles.link.family, styles.button.family, ...LEVELS.map((level) => styles.headings[level]?.family)]
    .map(firstFamily).filter((name): name is string => Boolean(name)).map((name) => name.toLowerCase()));
  const latin = (face: FontFaceRef) => !face.unicodeRange || /U\+0000|U\+0-|U\+0100|U\+00/i.test(face.unicodeRange);
  const seen = new Set<string>();
  return faces.filter((face) => {
    if (!used.has(face.family.toLowerCase()) || !latin(face)) return false;
    const key = `${face.family}|${face.weight}|${face.style}|${face.unicodeRange ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, max);
}

/** Whether a file is a web font (woff2 or woff) by its first bytes. */
export const isWebFont = (bytes: Uint8Array) => bytes.length > 12 && bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && (bytes[3] === 0x32 || bytes[3] === 0x46);

// ---------- writing it back ----------

export type StoredFace = { family: string; weight: string; style: string; format: "woff2" | "woff"; unicodeRange?: string; data: string };

const FALLBACK_SANS = "Arial, Helvetica, sans-serif";
/** The family list with a close system font behind it. */
export const withFallback = (family: string | undefined) => (family ? `${family}, ${/serif"?$|Georgia|Times|Merriweather|Lora|Playfair/i.test(family) && !/sans/i.test(family) ? "Georgia, serif" : FALLBACK_SANS}` : FALLBACK_SANS);

/** @font-face rules for the copied fonts, as data: addresses (the app's and the frame's policies allow data: fonts only). */
export function fontFaceCss(faces: readonly StoredFace[]): string {
  return faces.filter((face) => /^[A-Za-z0-9+/=]+$/.test(face.data) && /^[\w\s-]{1,60}$/.test(face.family)).map((face) => `@font-face{font-family:"${face.family}";font-weight:${face.weight};font-style:${face.style};font-display:swap;`
    + `src:url(data:font/${face.format};base64,${face.data}) format("${face.format}")${face.unicodeRange ? `;unicode-range:${face.unicodeRange}` : ""}}`).join("\n");
}

const declarations = (look: TextLook | undefined, extra: Record<string, string | undefined> = {}) => {
  const out: string[] = [];
  if (look?.family) out.push(`font-family:${withFallback(look.family)}`);
  if (look?.weight) out.push(`font-weight:${look.weight}`);
  if (look?.size) out.push(`font-size:${look.size}`);
  if (look?.lineHeight) out.push(`line-height:${look.lineHeight}`);
  if (look?.color) out.push(`color:${look.color}`);
  if (look?.transform) out.push(`text-transform:${look.transform}`);
  if (look?.letterSpacing) out.push(`letter-spacing:${look.letterSpacing}`);
  for (const [name, value] of Object.entries(extra)) if (value) out.push(`${name}:${value}`);
  return out.join(";");
};

/**
 * The look as css for one scope (the editor's page area, never the app around it). The values were checked when they were read;
 * the selector is the caller's own constant.
 */
export function siteLookCss(styles: SiteLookStyles, scope: string): string {
  const s = `${scope}${scope}`;
  const rules: string[] = [];
  const body = declarations(styles.body);
  if (body) rules.push(`${s}{${body}}`, `${s} p,${s} li{line-height:inherit;font-size:inherit}`);
  for (const level of LEVELS) {
    const heading = declarations({ ...(styles.headings[level] ?? {}) });
    if (heading) rules.push(`${s} h${level}{${heading}}`);
  }
  const link = declarations({ color: styles.link.color });
  if (link) rules.push(`${s} a{${link}}`);
  const button = declarations({ family: styles.button.family, weight: styles.button.weight, size: styles.button.size, transform: styles.button.transform, letterSpacing: styles.button.letterSpacing });
  if (button) rules.push(`${s} [data-site-button]{${button}}`);
  const small = [styles.small.body ? `${s}{font-size:${styles.small.body}}` : "", ...LEVELS.map((level) => (styles.small.headings[level] ? `${s} h${level}{font-size:${styles.small.headings[level]}}` : ""))].filter(Boolean);
  if (small.length) rules.push(`@media (max-width:921px){${small.join("")}}`);
  return rules.join("\n");
}

/** The frame's base: the site's body font (only until the theme's own css says otherwise) instead of a fixed Arial. */
export const frameBaseFont = (styles: SiteLookStyles | null) => withFallback(styles?.body.family);
