/**
 * The programme's running text (2026-10-06, the document view): plain text with a few marks, so the same text
 * reads as a document on screen and in the PDF and stays readable as it is stored.
 *
 * - "## Rubrik" is a heading inside the section,
 * - "- punkt" a bullet list, "1. punkt" a numbered list,
 * - "| a | b |" rows a table (the first row is the header; a "|---|" row is skipped),
 * - every other line is its own paragraph; an empty line is only a pause.
 */
export type TextBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] };

const BULLET = /^\s*[-•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
const HEADING = /^\s*#{2,3}\s+/;
const TABLE = /^\s*\|/;
const SEPARATOR = /^\s*\|?\s*:?-{2,}/;

const cells = (line: string) => {
  const parts = line.trim().split("|").map((cell) => cell.trim());
  if (parts[0] === "") parts.shift();
  if (parts.at(-1) === "") parts.pop();
  return parts;
};

export function parseProgramText(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const last = blocks.at(-1);
    if (!line.trim()) {
      // A pause ends a list or a table; the next one starts afresh.
      if (last && last.type !== "paragraph" && last.type !== "heading") blocks.push({ type: "paragraph", text: "" });
      continue;
    }
    if (HEADING.test(line)) { blocks.push({ type: "heading", text: line.replace(HEADING, "").trim() }); continue; }
    if (TABLE.test(line)) {
      if (SEPARATOR.test(line.replace(/^\s*\|/, "")) && last?.type === "table") continue;
      const row = cells(line);
      if (last?.type === "table") last.rows.push(row);
      else blocks.push({ type: "table", header: row, rows: [] });
      continue;
    }
    const ordered = NUMBERED.test(line);
    if (ordered || BULLET.test(line)) {
      const item = line.replace(ordered ? NUMBERED : BULLET, "").trim();
      if (last?.type === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ type: "list", ordered, items: [item] });
      continue;
    }
    blocks.push({ type: "paragraph", text: line.trim() });
  }
  // Tables get the same number of cells on every row.
  return blocks.filter((block) => block.type !== "paragraph" || block.text).map((block) => {
    if (block.type !== "table") return block;
    const width = Math.max(block.header.length, ...block.rows.map((row) => row.length));
    const pad = (row: string[]) => [...row, ...Array(width - row.length).fill("")];
    return { ...block, header: pad(block.header), rows: block.rows.map(pad) };
  });
}

/** What the editor's buttons insert. */
export const TEXT_SNIPPETS = {
  heading: "## Rubrik",
  bullets: "- Punkt\n- Punkt",
  numbered: "1. Steg\n2. Steg",
  table: "| Kolumn | Kolumn | Kolumn |\n|---|---|---|\n| Text | Text | Text |",
} as const;

/** What the editor's ribbon can do with the lines under the cursor (2026-10-07, the Word-like ribbon). */
export type LineFormat = "heading" | "paragraph" | "bullets" | "numbered";
const MARK = /^\s*(#{2,3}\s+|[-•]\s+|\d+[.)]\s+)/;
const plain = (line: string) => line.replace(MARK, "");

/**
 * Formats the lines the selection touches: "## " for a heading, "- " for a bullet, "1. 2. …" for numbered steps, and no
 * mark for a paragraph. Pressing the same button again on lines that already have it makes them paragraphs, as in a word
 * processor. On an empty line the matching snippet is inserted instead. Returns the new text and the selection.
 */
export function formatProgramLines(text: string, start: number, end: number, format: LineFormat): { text: string; start: number; end: number } {
  const from = start <= 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
  const stop = (() => { const at = text.indexOf("\n", Math.max(end, from)); return at < 0 ? text.length : at; })();
  const lines = text.slice(from, stop).split("\n");
  if (lines.every((line) => !line.trim())) {
    if (format === "paragraph") return { text, start, end };
    const snippet = TEXT_SNIPPETS[format];
    return { text: `${text.slice(0, from)}${snippet}${text.slice(stop)}`, start: from, end: from + snippet.length };
  }
  const filled = lines.filter((line) => line.trim());
  const has = format === "heading" ? filled.every((line) => HEADING.test(line)) : format === "bullets" ? filled.every((line) => BULLET.test(line))
    : format === "numbered" ? filled.every((line) => NUMBERED.test(line)) : false;
  let step = 0;
  const next = lines.map((line) => {
    if (!line.trim()) return line;
    const body = plain(line).trim();
    if (has || format === "paragraph") return body;
    return format === "heading" ? `## ${body}` : format === "bullets" ? `- ${body}` : `${++step}. ${body}`;
  }).join("\n");
  return { text: `${text.slice(0, from)}${next}${text.slice(stop)}`, start: from, end: from + next.length };
}

/** A snippet (e.g. a table) on its own line after the cursor's line; the snippet is selected. */
export function insertProgramSnippet(text: string, at: number, snippet: string): { text: string; start: number; end: number } {
  const stop = (() => { const index = text.indexOf("\n", at); return index < 0 ? text.length : index; })();
  const before = text.slice(0, stop);
  const lead = before && !before.endsWith("\n") ? "\n" : "";
  const startAt = stop + lead.length;
  // What follows the cursor's line starts with its own line break, so the snippet stays on lines of its own.
  return { text: `${before}${lead}${snippet}${text.slice(stop)}`, start: startAt, end: startAt + snippet.length };
}
