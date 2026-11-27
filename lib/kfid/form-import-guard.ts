/**
 * Safety checks for an imported form file (the AI skill package, 2026-11-24): a file made by hand or by an external AI
 * is read as untrusted data. Before the schema reads it, the raw JSON is walked once and refused when it is nested too
 * deeply, has too many values, carries a key that could reach an object's prototype, or holds HTML or script in a text.
 * After the schema has read it, every key the schema did not keep is reported, so a misspelt or invented setting is
 * never dropped in silence. Every refusal is a Swedish sentence that says where in the file the problem is.
 */

/** Deeper than any real form (package › form › document › section › table › column › bands › band is about 12). */
export const FORM_FILE_MAX_DEPTH = 24;
/** Values in one file: twenty full forms stay far below it. */
export const FORM_FILE_MAX_VALUES = 200_000;
/** The longest text any field accepts (a text block); a longer one is refused before the schema reads the file. */
export const FORM_FILE_MAX_TEXT = 10_000;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
// A tag (<b>, </div>, <img src=…>), a comment or a processing instruction, a script address, or an inline event handler.
// A formula is not checked: it is read by the restricted formula engine and uses < and > as comparisons.
const MARKUP = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>|<!--|<\?|<!\[CDATA\[|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html|\bon[a-z]{3,}\s*=\s*["'`]/i;
const CODE_KEYS = new Set(["formula"]);

export class FormFileError extends Error {}

const NAMES: Record<string, string> = { forms: "formulär", columns: "kolumn", items: "punkt", limits: "gränsvärde", bands: "nivå", fixedRows: "fast rad", options: "alternativ" };

/** Where in the file a value is, as a person reads it: "formulär 1 › avsnitt 2 › block 3 › label". */
export function formFilePlace(path: readonly PropertyKey[]): string {
  const parts: string[] = [];
  let depthInBlocks = 0;
  for (let index = 0; index < path.length; index++) {
    const part = path[index];
    const next = path[index + 1];
    if (part === "document") continue;
    if (part === "meta") { parts.push("grunduppgifter"); continue; }
    if (typeof next === "number") {
      const name = part === "blocks" ? (depthInBlocks++ === 0 ? "avsnitt" : "block") : NAMES[String(part)] ?? String(part);
      parts.push(`${name} ${next + 1}`);
      index++;
      continue;
    }
    parts.push(String(part));
  }
  return parts.join(" › ") || "filen";
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The checks before the schema: depth, size, prototype keys and markup. Throws FormFileError; returns nothing. Walks
 * iteratively, so a deeply nested file cannot exhaust the stack.
 */
export function inspectFormFile(input: unknown) {
  if (!isPlainObject(input)) throw new FormFileError("Filen är inte en formulärfil från Workflow.");
  const stack: { value: unknown; path: PropertyKey[] }[] = [{ value: input, path: [] }];
  let count = 0;
  while (stack.length) {
    const { value, path } = stack.pop()!;
    if (++count > FORM_FILE_MAX_VALUES) throw new FormFileError("Filen innehåller för mycket. Dela upp den i flera filer.");
    if (path.length > FORM_FILE_MAX_DEPTH) throw new FormFileError(`Filen är för djupt nästlad vid ${formFilePlace(path.slice(0, 8))}.`);
    if (typeof value === "string") {
      if (value.length > FORM_FILE_MAX_TEXT) throw new FormFileError(`En text är för lång vid ${formFilePlace(path)}: högst ${FORM_FILE_MAX_TEXT.toLocaleString("sv-SE")} tecken.`);
      if (!CODE_KEYS.has(String(path.at(-1))) && MARKUP.test(value)) throw new FormFileError(`Texten vid ${formFilePlace(path)} innehåller HTML eller skript. Ett formulär får bara innehålla vanlig text.`);
      continue;
    }
    if (Array.isArray(value)) { value.forEach((item, index) => stack.push({ value: item, path: [...path, index] })); continue; }
    if (isPlainObject(value)) {
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new FormFileError("Filen är inte en formulärfil från Workflow.");
      for (const key of Object.keys(value)) {
        if (FORBIDDEN_KEYS.has(key)) throw new FormFileError(`Filen innehåller det otillåtna fältnamnet ”${key}” vid ${formFilePlace(path)}.`);
        if (key.length > 100) throw new FormFileError(`Ett fältnamn är för långt vid ${formFilePlace(path)}.`);
        stack.push({ value: value[key], path: [...path, key] });
      }
      continue;
    }
    if (typeof value === "number" && !Number.isFinite(value)) throw new FormFileError(`Ett tal är ogiltigt vid ${formFilePlace(path)}.`);
  }
}

/**
 * The keys of `input` that the schema's result `parsed` does not have: settings that do not exist (a typo, an invented
 * option, a field of another block type). The first one is reported.
 */
export function unknownFormFileKey(input: unknown, parsed: unknown, path: PropertyKey[] = []): PropertyKey[] | null {
  if (Array.isArray(input) && Array.isArray(parsed)) {
    for (let index = 0; index < input.length; index++) { const found = unknownFormFileKey(input[index], parsed[index], [...path, index]); if (found) return found; }
    return null;
  }
  if (isPlainObject(input) && isPlainObject(parsed)) {
    for (const key of Object.keys(input)) {
      if (!Object.prototype.hasOwnProperty.call(parsed, key)) return [...path, key];
      const found = unknownFormFileKey(input[key], parsed[key], [...path, key]);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Every key of `input` that the schema's result `parsed` does not have (at most `limit`), each as its path. Used for a
 * signed file from a newer version (2026-11-24), whose unknown settings are removed and listed instead of refused.
 */
export function unknownFormFileKeys(input: unknown, parsed: unknown, limit = 500): PropertyKey[][] {
  const found: PropertyKey[][] = [];
  const stack: { input: unknown; parsed: unknown; path: PropertyKey[] }[] = [{ input, parsed, path: [] }];
  while (stack.length && found.length < limit) {
    const item = stack.pop()!;
    if (Array.isArray(item.input) && Array.isArray(item.parsed)) {
      for (let index = item.input.length - 1; index >= 0; index--) stack.push({ input: item.input[index], parsed: item.parsed[index], path: [...item.path, index] });
    } else if (isPlainObject(item.input) && isPlainObject(item.parsed)) {
      const keys = Object.keys(item.input);
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index];
        if (!Object.prototype.hasOwnProperty.call(item.parsed, key)) found.push([...item.path, key]);
        else stack.push({ input: item.input[key], parsed: item.parsed[key], path: [...item.path, key] });
      }
    }
  }
  return found;
}

/** A removed setting's place as a person reads it: "formulär 1 › avsnitt 1 › block 2 › hint". */
export const removedSettingPlace = (path: readonly PropertyKey[]) => {
  const where = formFilePlace(path.slice(0, -1));
  const key = String(path.at(-1)).slice(0, 60);
  return where === "filen" ? key : `${where} › ${key}`;
};

/** Throws a readable error when the file has a key the format does not know. */
export function rejectUnknownFormFileKeys(input: unknown, parsed: unknown) {
  const found = unknownFormFileKey(input, parsed);
  if (!found) return;
  const key = String(found.at(-1));
  const where = formFilePlace(found.slice(0, -1));
  throw new FormFileError(`Formulärfilen innehåller fältet ”${key.slice(0, 60)}” ${where === "filen" ? "" : `vid ${where} `}som formatet inte känner till. Ta bort det eller rätta stavningen.`);
}
