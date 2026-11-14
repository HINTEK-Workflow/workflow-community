import { renderMailing, type MailingBlock, type MailingDocument } from "@/lib/mail/mailing-document";
import { noticeStateText } from "@/lib/workflow/notice-channels";
import type { TaskNotification } from "@/lib/workflow/task-notifications";

/**
 * What a person is sent for the notices they chose (2026-10-07): one e-mail with the new reminders (the first
 * twenty, the rest counted) and one short web push, never one message per notice. Pure: the same text for the job, the
 * tests and the preview. A notice names its company when the person belongs to several.
 */
export const DIGEST_MAX_ITEMS = 20;

export type DigestItem = { organizationName: string; item: TaskNotification };

/**
 * Text that is safe inside the mail's simple formatting: one line, no brackets, parentheses or emphasis marks, and no
 * web address that the mail would turn into a link of its own (a notice's title is written by someone in the company).
 */
export const noticeText = (value: string, max = 120) => value.replace(/[\r\n]+/g, " ").replace(/[*[\]()]/g, " ").replace(/\b(?:https?|mailto):\/*/gi, "").replace(/\s{2,}/g, " ").trim().slice(0, max);

export const digestSubject = (total: number, name: string) => total === 1 ? `1 ny påminnelse i ${name}` : `${total} nya påminnelser i ${name}`;

export function buildNoticeDigest(input: { items: DigestItem[]; today: string; name: string; appUrl: string; recipientName?: string | null }) {
  const total = input.items.length;
  const shown = input.items.slice(0, DIGEST_MAX_ITEMS);
  const first = noticeText(input.recipientName?.trim().split(/\s+/)[0] ?? "", 40);
  const line = ({ item }: DigestItem) => {
    const state = noticeStateText(item, input.today);
    return `- [${noticeText(item.title) || "Påminnelse"}](${new URL(item.href, input.appUrl).toString()})${state ? ` – ${state}` : ""}`;
  };
  const groups = new Map<string, DigestItem[]>();
  for (const entry of shown) groups.set(entry.organizationName, [...(groups.get(entry.organizationName) ?? []), entry]);
  const blocks: MailingBlock[] = [
    { id: "n-head", type: "heading", text: total === 1 ? "En ny påminnelse" : `${total} nya påminnelser`, size: "large" },
    { id: "n-intro", type: "text", text: `Hej${first ? ` ${first}` : ""}!\n\nDet här är nytt bland dina påminnelser i ${input.name}.` },
  ];
  [...groups].forEach(([organizationName, entries], index) => {
    if (groups.size > 1) blocks.push({ id: `n-org${index}`, type: "heading", text: noticeText(organizationName), size: "medium" });
    blocks.push({ id: `n-list${index}`, type: "text", text: entries.map(line).join("\n") });
  });
  if (total > shown.length) blocks.push({ id: "n-more", type: "text", text: `… och ${total - shown.length} till. Alla finns under Notiser i ${input.name}.` });
  blocks.push({ id: "n-button", type: "button", label: "Öppna Notiser", url: new URL("/?view=notifications", input.appUrl).toString() });
  const document: MailingDocument = { version: 1, blocks };
  const footer = `Du får det här för att det kräver åtgärd eller för att du har valt e-postnotiser. Du ändrar eller stänger av det under Mina inställningar i ${input.name}.`;
  const { html, text } = renderMailing(document, { name: input.name, footer, unsubscribe: null, webVersion: null });
  const subject = digestSubject(total, input.name);
  return { subject, document, html, text: `${subject}\n\n${text}` };
}

/** What the service worker shows: a short title and text and where a tap leads (a path in the app, never an outside address). */
export type PushNotice = { title: string; body: string; url: string; tag: string };

export function buildPushNotice(items: DigestItem[], today: string, name: string): PushNotice {
  if (items.length === 1) {
    const { item } = items[0];
    const state = noticeStateText(item, today);
    return { title: name, body: `${noticeText(item.title, 90) || "Påminnelse"}${state ? ` – ${state}` : ""}`, url: item.href, tag: `notice:${item.id}` };
  }
  const titles = items.slice(0, 2).map(({ item }) => noticeText(item.title, 40)).filter(Boolean).join(", ");
  return { title: name, body: `${items.length} nya påminnelser${titles ? `: ${titles}${items.length > 2 ? " med flera" : ""}` : ""}`, url: "/?view=notifications", tag: "notices" };
}
