import { z } from "zod";

/**
 * Utskick som block (2026-10-03: "html-baserad med formulärseditorns egenskaper, för snyggare utskick"): a
 * newsletter is a list of blocks – heading, text, button, image, notice, divider, space – rendered to e-mail HTML
 * that works in common mail programs (tables and inline styles, no scripts, no external fonts) and to plain text.
 * Pure: used by the editor's live preview and by the server that sends.
 */
export const MAILING_BLOCK_TYPES = ["heading", "text", "button", "image", "notice", "divider", "spacer"] as const;
export type MailingBlockType = (typeof MAILING_BLOCK_TYPES)[number];

const id = z.string().min(1).max(40);
const text = (max: number) => z.string().max(max);
// Links and images: only web addresses and mail links; never javascript: or data: in a mail.
const url = z.string().trim().max(2000).refine((value) => value === "" || /^(https?:\/\/|mailto:)/i.test(value), "Adressen måste börja med https:// eller mailto:.");

export const mailingBlockSchema = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("heading"), text: text(200), size: z.enum(["large", "medium"]).default("large") }),
  z.object({ id, type: z.literal("text"), text: text(8000) }),
  z.object({ id, type: z.literal("button"), label: text(80), url }),
  z.object({ id, type: z.literal("image"), src: url, alt: text(200), link: url.default("") }),
  z.object({ id, type: z.literal("notice"), text: text(2000), tone: z.enum(["info", "warning"]).default("info") }),
  z.object({ id, type: z.literal("divider") }),
  z.object({ id, type: z.literal("spacer") }),
]);
export type MailingBlock = z.infer<typeof mailingBlockSchema>;
export const mailingDocumentSchema = z.object({ version: z.literal(1), blocks: z.array(mailingBlockSchema).max(60) });
export type MailingDocument = z.infer<typeof mailingDocumentSchema>;

export const MAILING_BLOCK_LABELS: Record<MailingBlockType, string> = {
  heading: "Rubrik", text: "Text", button: "Knapp", image: "Bild", notice: "Notisruta", divider: "Avdelare", spacer: "Mellanrum",
};

export function newMailingBlock(type: MailingBlockType, blockId: string): MailingBlock {
  switch (type) {
    case "heading": return { id: blockId, type, text: "Rubrik", size: "large" };
    case "text": return { id: blockId, type, text: "Skriv texten här. En tom rad ger ett nytt stycke, **fet stil** med två stjärnor och webbadresser blir länkar." };
    case "button": return { id: blockId, type, label: "Läs mer", url: "https://" };
    case "image": return { id: blockId, type, src: "", alt: "", link: "" };
    case "notice": return { id: blockId, type, text: "Viktigt att veta.", tone: "info" };
    case "divider": return { id: blockId, type };
    case "spacer": return { id: blockId, type };
  }
}

export const starterMailing = (): MailingDocument => ({ version: 1, blocks: [
  { id: "b1", type: "heading", text: "Nytt i Workflow", size: "large" },
  { id: "b2", type: "text", text: "Hej!\n\nHär är det senaste från oss." },
] });

/** A stored body is a block document (JSON) or, for mailings sent before 2026-10-03, plain text. */
export function parseMailingBody(body: string): MailingDocument {
  if (body.trimStart().startsWith("{")) {
    try { return mailingDocumentSchema.parse(JSON.parse(body)); } catch { /* fall through to text */ }
  }
  return { version: 1, blocks: [{ id: "legacy", type: "text", text: body }] };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
const safeUrl = (value: string) => (/^(https?:\/\/|mailto:)/i.test(value.trim()) ? escapeHtml(value.trim()) : "");
/** Text with **bold**, web addresses as links and line breaks. */
function inline(value: string) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/https?:\/\/[^\s<]+/g, (address) => `<a href="${address}" style="color:#135bec;text-decoration:underline;">${address}</a>`)
    .replace(/\n/g, "<br>");
}
const plain = (value: string) => value.replace(/\*\*(.+?)\*\*/g, "$1");

const COLORS = { ink: "#172033", body: "#384458", muted: "#6b7280", brand: "#113351", accent: "#135bec", line: "#e5eaf2", page: "#f3f7ff" };

function blockHtml(block: MailingBlock) {
  switch (block.type) {
    case "heading": return block.text.trim() ? `<h${block.size === "large" ? 1 : 2} style="margin:0 0 12px;font-size:${block.size === "large" ? 26 : 19}px;line-height:1.25;color:${COLORS.ink};">${escapeHtml(block.text)}</h${block.size === "large" ? 1 : 2}>` : "";
    case "text": return block.text.trim().split(/\n\s*\n/).map((part) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:${COLORS.body};">${inline(part.trim())}</p>`).join("");
    case "button": return block.label.trim() && safeUrl(block.url) && block.url.trim() !== "https://" ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;"><tr><td style="border-radius:999px;background:${COLORS.accent};"><a href="${safeUrl(block.url)}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(block.label)}</a></td></tr></table>` : "";
    case "image": {
      if (!safeUrl(block.src)) return "";
      const image = `<img src="${safeUrl(block.src)}" alt="${escapeHtml(block.alt)}" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:0;border-radius:12px;">`;
      return `<div style="margin:6px 0 18px;">${safeUrl(block.link) ? `<a href="${safeUrl(block.link)}">${image}</a>` : image}</div>`;
    }
    case "notice": return block.text.trim() ? `<div style="margin:6px 0 18px;padding:14px 16px;border-radius:12px;font-size:14px;line-height:1.6;${block.tone === "warning" ? "background:#fff7ed;border:1px solid #fed7aa;color:#7c2d12;" : "background:#eef4ff;border:1px solid #dbeafe;color:#1e3a5f;"}">${inline(block.text.trim())}</div>` : "";
    case "divider": return `<hr style="margin:20px 0;border:0;border-top:1px solid ${COLORS.line};">`;
    case "spacer": return `<div style="height:24px;line-height:24px;">&nbsp;</div>`;
  }
}

function blockText(block: MailingBlock) {
  switch (block.type) {
    case "heading": return block.text.trim().toUpperCase();
    case "text": return plain(block.text.trim());
    case "button": return block.label.trim() && block.url.trim() !== "https://" ? `${block.label.trim()}: ${block.url.trim()}` : "";
    case "image": return block.alt.trim() ? `[Bild: ${block.alt.trim()}]` : "";
    case "notice": return plain(block.text.trim());
    case "divider": return "----";
    case "spacer": return "";
  }
}

/** The whole mail: the installation's name above, the blocks, and the footer (with the way to say no for a newsletter). */
export function renderMailing(document: MailingDocument, input: { name: string; footer: string; unsubscribe: string | null }) {
  const body = document.blocks.map(blockHtml).join("");
  const footer = `${escapeHtml(input.footer)}${input.unsubscribe ? ` <a href="${escapeHtml(input.unsubscribe)}" style="color:${COLORS.muted};">Avböj fler nyhetsbrev</a>.` : ""}`;
  const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:${COLORS.page};">
<div style="background:${COLORS.page};padding:32px 12px;font-family:'Segoe UI',Arial,sans-serif;color:${COLORS.ink};">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #dbe4f0;border-radius:20px;">
    <tr><td style="padding:22px 28px 6px;font-size:13px;font-weight:700;letter-spacing:0.04em;color:${COLORS.brand};">${escapeHtml(input.name)}</td></tr>
    <tr><td style="padding:12px 28px 10px;">${body}</td></tr>
    <tr><td style="padding:16px 28px 26px;font-size:12px;line-height:1.6;color:${COLORS.muted};border-top:1px solid ${COLORS.line};">${footer}</td></tr>
  </table>
</div></body></html>`;
  const text = `${document.blocks.map(blockText).filter(Boolean).join("\n\n")}\n\n${input.footer}${input.unsubscribe ? `\nAvböj fler nyhetsbrev: ${input.unsubscribe}` : ""}\n`;
  return { html, text };
}

/** What the editor must have before a mailing can be sent. */
export function mailingProblems(document: MailingDocument) {
  const problems: string[] = [];
  if (!document.blocks.some((block) => (block.type === "text" || block.type === "heading" || block.type === "notice") && block.text.trim())) problems.push("Lägg till en rubrik eller text.");
  for (const block of document.blocks) {
    if (block.type === "button" && (!block.label.trim() || !/^(https?:\/\/.+|mailto:.+)/i.test(block.url.trim()))) problems.push("En knapp saknar text eller adress.");
    if (block.type === "image" && !block.src.trim()) problems.push("En bild saknar fil.");
  }
  return [...new Set(problems)];
}
