// PLC-apparater (2026-11-07): an uploaded SVG drawn as part of the page, so its named parts can be animated – read here into a plain
// tree with an allowlist instead of being handed to the browser as markup. Only drawing elements and drawing attributes pass; every
// reference must point inside the picture (#id); no script, event handler, style sheet, link, embedded document or outside address can
// survive, because nothing that is not on the lists is ever written. Ids are kept so the animation (animation.ts) can name the parts;
// the drawing prefixes them per device so two pictures never share an id. Pure: the server checks with it, the browser draws with it.
//
// Photo layers (2026-11-09, "det är originalen som skall förbättras … alla symboler skall vara animerade"): a photograph has no
// parts, so a picture may hold <image> elements whose href is an embedded PNG or WebP (data:…;base64), each in its own named group –
// the body of a pushbutton as one layer, its cap as another – and the animation moves the groups. Only embedded raster data passes:
// never an address, never an SVG inside the SVG, never more than MAX_LAYER_BYTES a layer.

export type SvgNode = { tag: string; attrs: Record<string, string>; children: SvgNode[] } | { text: string };

const ELEMENTS = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "linearGradient", "radialGradient", "stop", "clipPath", "title", "image"]);
/** Elements whose whole content is dropped (never drawn, never read). */
const DROPPED = new Set(["script", "style", "foreignObject", "iframe", "embed", "object", "use", "a", "metadata", "animate", "animateTransform", "animateMotion", "set", "filter", "mask", "pattern", "symbol", "marker", "switch", "font", "font-face", "audio", "video", "canvas", "handler", "listener"]);

/** A photo layer's data: the type and how its base64 begins (PNG's signature, WebP's RIFF). */
export const LAYER_TYPES = { png: "iVBORw0KGgo", webp: "UklGR" } as const;
export type LayerType = keyof typeof LAYER_TYPES;
/** What one layer may hold when decoded, the same as a whole PNG picture. */
export const MAX_LAYER_BYTES = 400 * 1024;
/** What a whole picture's text may be: a drawing of its own stays far below; photo layers reach it (device-designs.ts caps them further). */
export const MAX_SOURCE_LENGTH = 1_400_000;
const LAYER_HREF = /^data:image\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
const base64Bytes = (data: string) => Math.floor((data.length * 3) / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);

/** Reads an <image> href: an embedded PNG or WebP within the size, as the data address to keep, or null. */
export function readLayerHref(value: string): { href: string; type: LayerType; bytes: number } | null {
  const match = LAYER_HREF.exec(value.replace(/\s+/g, ""));
  if (!match) return null;
  const type = match[1] as LayerType, data = match[2]!;
  if (!data.startsWith(LAYER_TYPES[type])) return null;
  const bytes = base64Bytes(data);
  if (bytes > MAX_LAYER_BYTES) return null;
  return { href: `data:image/${type};base64,${data}`, type, bytes };
}
const ATTRIBUTES = new Set([
  "id", "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr", "width", "height", "points", "viewBox", "preserveAspectRatio",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset", "stroke-miterlimit",
  "opacity", "transform", "gradientUnits", "gradientTransform", "spreadMethod", "offset", "stop-color", "stop-opacity", "clip-path", "clip-rule", "clipPathUnits",
  "font-size", "font-weight", "font-family", "font-style", "text-anchor", "dominant-baseline", "letter-spacing", "visibility", "display", "href", "xlink:href",
]);
/** What a style attribute may hold; it is turned into plain attributes. */
const STYLE_PROPS = new Set(["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-miterlimit", "opacity", "stop-color", "stop-opacity", "font-size", "font-weight", "font-family", "font-style", "text-anchor", "visibility", "display"]);
const ID = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
const decode = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
  if (name[0] === "#") { const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10); return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ""; }
  return ENTITIES[name.toLowerCase()] ?? "";
});

/** A value is safe when it has no way out: only a reference inside the picture, no script, no expression, no escape. */
function safeValue(name: string, value: string): string | null {
  const text = value.trim();
  if (text.length > 20_000 || /[<>\\]|javascript:|expression|@import|data:/i.test(text)) return null;
  if (name === "href" || name === "xlink:href") return /^#[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(text) ? text : null;
  if (/url\(/i.test(text) && !/^url\(\s*['"]?#[A-Za-z_][A-Za-z0-9_.-]{0,63}['"]?\s*\)$/i.test(text)) return null;
  if (name === "id") return ID.test(text) ? text : null;
  return text;
}

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!(?:DOCTYPE|ENTITY)[^>]*>|<\/\s*([A-Za-z][\w:.-]*)\s*>|<([A-Za-z][\w:.-]*)((?:\s+[A-Za-z_:][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/gy;
const ATTRIBUTE = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export type SafeSvg = {
  ok: true; root: SvgNode & { tag: string }; ids: string[]; dropped: string[];
  /** The photo layers kept, and what they hold together when decoded. */
  layers: number; layerBytes: number;
};

/**
 * Reads an SVG text into the allowed tree, or says why it cannot be read. What is not allowed is left out (an element with its content,
 * an attribute); what cannot be read at all – broken markup, a DOCTYPE or ENTITY – refuses the whole picture.
 */
export function parseSafeSvg(source: string): SafeSvg | { ok: false; reason: string } {
  if (source.length > MAX_SOURCE_LENGTH) return { ok: false, reason: "Bilden är för stor." };
  const stack: { tag: string; attrs: Record<string, string>; children: SvgNode[]; skip: boolean }[] = [];
  let root: (SvgNode & { tag: string }) | null = null;
  const ids: string[] = [];
  const dropped = new Set<string>();
  let layers = 0, layerBytes = 0;
  TOKEN.lastIndex = 0;
  let index = 0;
  while (index < source.length) {
    TOKEN.lastIndex = index;
    const match = TOKEN.exec(source);
    if (!match || match.index !== index) return { ok: false, reason: "SVG-bilden går inte att läsa." };
    index = TOKEN.lastIndex;
    const [whole, closing, opening, attrText, selfClosing, text] = match;
    if (/^<!(?:DOCTYPE|ENTITY)/i.test(whole)) return { ok: false, reason: "SVG-bilden innehåller DOCTYPE eller ENTITY, som inte är tillåtet." };
    if (whole.startsWith("<!--") || whole.startsWith("<?") || whole.startsWith("<![CDATA[")) continue;
    const top = stack[stack.length - 1];
    if (text !== undefined) {
      if (top && !top.skip && (top.tag === "text" || top.tag === "tspan" || top.tag === "title") && text.trim()) top.children.push({ text: decode(text) });
      continue;
    }
    if (closing !== undefined) {
      if (!top || top.tag !== closing) return { ok: false, reason: "SVG-bilden har en tagg som inte stängs rätt." };
      stack.pop();
      if (!top.skip) {
        const node = { tag: top.tag, attrs: top.attrs, children: top.children };
        const parent = stack[stack.length - 1];
        if (parent) { if (!parent.skip) parent.children.push(node); } else root = node;
      }
      continue;
    }
    const tag = opening!;
    const local = tag.replace(/^svg:/, "");
    let skip = Boolean(top?.skip) || !ELEMENTS.has(local);
    if (!ELEMENTS.has(local) && !top?.skip) dropped.add(DROPPED.has(local) ? local : local);
    const attrs: Record<string, string> = {};
    if (!skip) {
      for (const [, name, double, single] of (attrText ?? "").matchAll(ATTRIBUTE)) {
        const value = decode(double ?? single ?? "");
        if (name === "style") {
          for (const declaration of value.split(";")) {
            const [prop, ...rest] = declaration.split(":");
            const key = prop?.trim().toLowerCase() ?? "";
            const checked = STYLE_PROPS.has(key) ? safeValue(key, rest.join(":")) : null;
            if (checked !== null && checked !== "") attrs[key] = checked;
          }
          continue;
        }
        if (!ATTRIBUTES.has(name)) { if (/^on/i.test(name)) dropped.add("händelser"); continue; }
        if ((name === "href" || name === "xlink:href") && local === "image") {
          // A photo layer: only embedded raster data, read here and never through safeValue (which rightly refuses every other data:).
          const layer = readLayerHref(value);
          if (layer) { attrs.href = layer.href; layers += 1; layerBytes += layer.bytes; } else dropped.add("image");
          continue;
        }
        if ((name === "href" || name === "xlink:href") && local !== "linearGradient" && local !== "radialGradient") continue;
        const checked = safeValue(name, value);
        if (checked === null) { dropped.add(name); continue; }
        attrs[name === "xlink:href" ? "href" : name] = checked;
      }
      // An <image> without an embedded layer shows nothing and is left out whole, so no half-read element is ever drawn.
      if (local === "image" && !attrs.href) { skip = true; dropped.add("image"); }
      if (!skip && attrs.id) ids.push(attrs.id);
    }
    const node = { tag: local, attrs, children: [] as SvgNode[], skip };
    if (selfClosing) {
      if (!skip) { const leaf = { tag: local, attrs, children: [] }; if (top) top.children.push(leaf); else root = leaf; }
      continue;
    }
    stack.push(node);
    if (!top && local !== "svg") return { ok: false, reason: "Filen är inte en SVG-bild." };
  }
  if (stack.length) return { ok: false, reason: "SVG-bilden har en tagg som inte stängs rätt." };
  if (!root || root.tag !== "svg") return { ok: false, reason: "Filen är inte en SVG-bild." };
  return { ok: true, root, ids, dropped: [...dropped], layers, layerBytes };
}

/** The picture's own size: its viewBox, else its width and height, else a square. */
export function svgBox(root: SvgNode & { tag: string }): [number, number, number, number] {
  if ("attrs" in root) {
    const box = (root.attrs.viewBox ?? "").trim().split(/[\s,]+/).map(Number);
    if (box.length === 4 && box.every(Number.isFinite) && box[2]! > 0 && box[3]! > 0) return box as [number, number, number, number];
    const width = Number.parseFloat(root.attrs.width ?? ""), height = Number.parseFloat(root.attrs.height ?? "");
    if (width > 0 && height > 0) return [0, 0, width, height];
  }
  return [0, 0, 100, 100];
}
