import type { TaskNotification } from "@/lib/workflow/task-notifications";
import { swedishDayKey } from "@/lib/swedish-time";
import { quoteLabel } from "./model";
import type { QuoteDecision } from "./customer-link";

/**
 * Offert per e-post, steg E: when a customer accepts or declines a quote through the link, the person who sent it, the
 * person who wrote it and the company's admins get a notice in the bell (and the workspace toast), unread until they
 * open the quote. Same pattern as "Tilldelad dig" (lib/workflow/task-assignment-notice.ts), no schema of its own: the
 * unread notice is a NoticeDelivery row with the channel "QUOTE" and the key `QUOTE:<quoteId>|<decision>`. The e-mail
 * and push marks are separate rows (EMAIL/PUSH), so the notice job sends it once at most, to those who chose "Svar på
 * offerter". The bell shows it only to someone who may read quotes in a Cloud company. Pure: keys, recipients, items.
 */
export const QUOTE_NOTICE_CHANNEL = "QUOTE";
export const QUOTE_NOTICE_PREFIX = "QUOTE:";
export const QUOTE_NOTICE_LIMIT = 50;

export const quoteNoticeKey = (quoteId: string, decision: QuoteDecision) => `${QUOTE_NOTICE_PREFIX}${quoteId}|${decision}`;
export const quoteNoticeKeyPrefix = (quoteId: string) => `${QUOTE_NOTICE_PREFIX}${quoteId}|`;

export function parseQuoteNoticeKey(key: string): { quoteId: string; decision: QuoteDecision } | null {
  if (!key.startsWith(QUOTE_NOTICE_PREFIX)) return null;
  const [quoteId, decision, ...rest] = key.slice(QUOTE_NOTICE_PREFIX.length).split("|");
  return quoteId && (decision === "ACCEPTED" || decision === "DECLINED") && !rest.length ? { quoteId, decision } : null;
}

/** The sender, the author and the admins – each once; only active members of the company are passed as admins. */
export function quoteNoticeRecipients(input: { sentById: string | null | undefined; createdById: string | null | undefined; adminIds: readonly string[]; activeMemberIds: ReadonlySet<string> }): string[] {
  const ids = [input.sentById, input.createdById, ...input.adminIds].filter((id): id is string => Boolean(id) && input.activeMemberIds.has(id!));
  return [...new Set(ids)];
}

export type QuoteNoticeRow = {
  key: string;
  createdAt: Date;
  quote: { id: string; number: number; version: number; title: string; response: { decision: QuoteDecision; signerName: string; createdAt: Date } | null } | null;
};

const oneLine = (value: string, max: number) => value.replace(/[\r\n*[\]()]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);

/** The bell's "Offert besvarad" items, newest first; a notice whose quote or answer is gone is not shown. */
export function quoteAnswerNotifications(rows: readonly QuoteNoticeRow[]): TaskNotification[] {
  const newest = [...rows].sort((a, b) => (b.quote?.response?.createdAt.getTime() ?? 0) - (a.quote?.response?.createdAt.getTime() ?? 0) || a.key.localeCompare(b.key));
  return newest.flatMap((row): TaskNotification[] => {
    const parsed = parseQuoteNoticeKey(row.key);
    const quote = row.quote;
    if (!parsed || !quote || quote.id !== parsed.quoteId || !quote.response || quote.response.decision !== parsed.decision) return [];
    const name = oneLine(quote.response.signerName, 80);
    const label = quoteLabel(quote);
    return [{
      id: `${QUOTE_NOTICE_PREFIX}${quote.id}:${parsed.decision}`, title: quote.title, kind: "QUOTE", decision: parsed.decision,
      detail: parsed.decision === "ACCEPTED" ? `Kunden${name ? ` (${name})` : ""} har accepterat offert ${label}.` : `Kunden${name ? ` (${name})` : ""} har avböjt offert ${label}.`,
      href: `/?view=quote&quoteId=${encodeURIComponent(quote.id)}`,
      dueDate: swedishDayKey(quote.response.createdAt), deadline: null, needsAction: false,
    }];
  });
}

/** The toast while the person is in the app. */
export const quoteAnswerToastText = (item: Pick<TaskNotification, "title" | "decision">) =>
  item.decision === "ACCEPTED" ? `Kunden har accepterat offerten ”${item.title}”.` : `Kunden har avböjt offerten ”${item.title}”.`;
