import { z } from "zod";
import type { TaskNotification } from "@/lib/workflow/task-notifications";

/**
 * Nyheter (2026-11-21): the company's own internal news under Mer › Nyheter. Every active member reads what is published; the
 * company's admin writes, edits, pins and removes; an agent mission publishes with its owner's rights through
 * `publishCompanyNews` (lib/news/server.ts). A published post is told in the bell of every other member for NEWS_NOTICE_DAYS, and the
 * latest posts can stand on a board (the measure "Senaste nyheterna" of the card Händelser). Pure: limits, the input, the texts, the
 * order and the bell's items, so the server, the page, the demo and the tests read the same.
 */
export const NEWS_TITLE_MAX = 120;
export const NEWS_BODY_MAX = 5000;
/** One page of the list (bounded reads); older posts come with Visa fler. */
export const NEWS_PAGE = 20;
export const NEWS_PAGE_MAX = 50;
/** At most this many drafts are listed for the admin. */
export const NEWS_DRAFTS_MAX = 50;
/** A published post is a notice in the bell for this many days. */
export const NEWS_NOTICE_DAYS = 7;
/** At most this many news notices are read for one person. */
export const NEWS_NOTICE_LIMIT = 20;
/** The bell's id of a post's notice (also its read mark, lib/workflow/notice-channels.ts noticeKey). */
export const NEWS_NOTICE_PREFIX = "NEWS:";
/** How many posts the board's measure shows. */
export const NEWS_BOARD_LIMIT = 10;

export const NEWS_STATUSES = ["draft", "published"] as const;
export type NewsStatus = (typeof NEWS_STATUSES)[number];
export const NEWS_SOURCES = ["manual", "agent"] as const;
export type NewsSource = (typeof NEWS_SOURCES)[number];

export const NEWS_VIEW = "/?view=news";
/** The app's link to one post; what publishCompanyNews returns and the bell opens. */
export const newsHref = (id: string) => `${NEWS_VIEW}&post=${encodeURIComponent(id)}`;

export const NEWS_STATUS_LABEL: Record<NewsStatus, string> = { draft: "Utkast", published: "Publicerad" };
export const NEWS_FILTERS = [{ key: "published", label: "Publicerade" }, { key: "draft", label: "Utkast" }] as const;
export type NewsFilter = (typeof NEWS_FILTERS)[number]["key"];
export const parseNewsFilter = (value: string | null | undefined): NewsFilter => (value === "draft" ? "draft" : "published");

export const NEWS_WRITE_REFUSAL = "Bara företagets administratör kan skriva nyheter.";
export const NEWS_MISSING = "Nyheten finns inte.";

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

/** A post's text as stored: line breaks kept (\r\n as \n), at most three empty lines in a row, no space at the ends. */
export function cleanNewsBody(value: string) {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

/** What a person or an agent saves: a title and a text. */
export const newsTextSchema = z.object({
  title: z.string().transform(oneLine).pipe(z.string().min(1, "Skriv en rubrik.").max(NEWS_TITLE_MAX, `Rubriken får vara högst ${NEWS_TITLE_MAX} tecken.`)),
  body: z.string().max(NEWS_BODY_MAX * 2).transform(cleanNewsBody).pipe(z.string().max(NEWS_BODY_MAX, `Texten får vara högst ${NEWS_BODY_MAX} tecken.`)).default(""),
});
export type NewsText = z.infer<typeof newsTextSchema>;

/** The admin's save from the page: the text, whether it is pinned, and whether it is published or stays a draft. */
export const newsSaveSchema = newsTextSchema.extend({ pinned: z.boolean().default(false), status: z.enum(NEWS_STATUSES).default("draft") });
export type NewsSave = z.infer<typeof newsSaveSchema>;

/** What another part of Workflow (an agent mission) hands publishCompanyNews. */
export const newsPublishSchema = newsTextSchema.extend({
  status: z.enum(NEWS_STATUSES).default("published"),
  source: z.enum(NEWS_SOURCES).default("agent"),
  sourceRef: z.string().trim().min(1, "Nyckeln saknas.").max(200),
  mission: z.object({ id: z.string().trim().max(60).optional(), name: z.string().transform(oneLine).pipe(z.string().min(1).max(80)) }).optional(),
  pinned: z.boolean().default(false),
});
export type NewsPublishInput = z.input<typeof newsPublishSchema>;

/** Who wrote it, as the list and the post say it: the person, or the agent mission. */
export function newsAuthorLabel(post: { source: string; agentName?: string | null; authorName?: string | null }) {
  if (post.source === "agent") return `Agent: ${oneLine(post.agentName ?? "") || "Agentuppdrag"}`;
  return oneLine(post.authorName ?? "") || "En kollega";
}

/** The short text under the title in the list and on a board: the start of the text, on one line. */
export function newsExcerpt(body: string, max = 180) {
  const text = oneLine(body);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** A post as the page and the API receive it. */
export type NewsPostView = {
  id: string;
  title: string;
  body: string;
  excerpt: string;
  status: NewsStatus;
  pinned: boolean;
  source: NewsSource;
  author: string;
  /** The person behind it: the writer, or the agent mission's owner. */
  authorUserId: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  href: string;
};

export type NewsRow = {
  id: string; title: string; body: string; status: string; pinned: boolean; source: string; agentName: string | null; authorUserId: string;
  publishedAt: Date | null; createdAt: Date; updatedAt: Date;
};

export function newsView(row: NewsRow, authorName: string | null | undefined): NewsPostView {
  return {
    id: row.id, title: row.title, body: row.body, excerpt: newsExcerpt(row.body), status: row.status === "published" ? "published" : "draft", pinned: row.pinned,
    source: row.source === "agent" ? "agent" : "manual", author: newsAuthorLabel({ source: row.source, agentName: row.agentName, authorName }), authorUserId: row.authorUserId,
    publishedAt: row.publishedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), href: newsHref(row.id),
  };
}

/** The list's order: pinned first, then newest published first (a draft by its last change). */
export function compareNews(a: Pick<NewsPostView, "pinned" | "publishedAt" | "updatedAt" | "id">, b: Pick<NewsPostView, "pinned" | "publishedAt" | "updatedAt" | "id">) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return (b.publishedAt ?? b.updatedAt).localeCompare(a.publishedAt ?? a.updatedAt) || b.id.localeCompare(a.id);
}

/** What the admin may still publish: a title is needed; the server checks the same. */
export const newsPublishProblem = (draft: { title: string }) => (oneLine(draft.title) ? null : "Skriv en rubrik först.");

/** The bell's line for a post (title, who, when) and the toast. */
export function newsNotifications(rows: readonly { id: string; title: string; body: string; source: string; agentName: string | null; authorUserId: string; publishedAt: Date | null; authorName?: string | null }[], options: { userId: string; now: Date }): TaskNotification[] {
  const since = options.now.getTime() - NEWS_NOTICE_DAYS * 86_400_000;
  return rows.flatMap((row): TaskNotification[] => {
    // Never one's own post: the writer (or the owner of the agent mission) knows about it already.
    if (!row.publishedAt || row.publishedAt.getTime() < since || row.authorUserId === options.userId) return [];
    const author = newsAuthorLabel(row);
    return [{
      id: `${NEWS_NOTICE_PREFIX}${row.id}`, kind: "NEWS", label: "Nyhet", title: newsExcerpt(row.title, NEWS_TITLE_MAX) || "Nyhet", detail: newsExcerpt(row.body, 140) || `${author} har publicerat en nyhet.`,
      href: newsHref(row.id), dueDate: "", deadline: null, needsAction: false, assignedBy: author, assignedAt: row.publishedAt.toISOString(),
    }];
  }).sort((a, b) => (b.assignedAt ?? "").localeCompare(a.assignedAt ?? "") || a.id.localeCompare(b.id));
}

/** The toast while the person is in the app; its button is "Visa nyheten". */
export const newsToastText = (item: Pick<TaskNotification, "title" | "assignedBy">) => `Ny nyhet${item.assignedBy ? ` från ${item.assignedBy}` : ""}: ${item.title}`;
export const NEWS_TOAST_ACTION = "Visa nyheten";

/** The board's measure: the latest published posts as events, the start of the text as the line under; never a person's name. */
export function newsEvents(rows: readonly { title: string; body: string; pinned: boolean; publishedAt: Date | string | null }[]) {
  return {
    kind: "events" as const,
    items: rows.flatMap((row) => row.publishedAt ? [{ at: typeof row.publishedAt === "string" ? row.publishedAt : row.publishedAt.toISOString(), title: row.title, level: "info" as const, ...(newsExcerpt(row.body, 120) ? { detail: newsExcerpt(row.body, 120) } : {}) }] : []).slice(0, NEWS_BOARD_LIMIT),
  };
}

/** The audit line (Administrationshistorik): the title, never the text. */
export function newsAuditDetail(action: "published" | "draft" | "updated" | "unpublished" | "deleted" | "pinned" | "unpinned", post: { title: string; source?: string; agentName?: string | null }) {
  const title = `"${newsExcerpt(post.title, 80)}"`;
  const by = post.source === "agent" ? `Agentuppdraget ${oneLine(post.agentName ?? "") || "utan namn"} ` : "";
  switch (action) {
    case "published": return by ? `${by}publicerade nyheten ${title}.` : `Publicerade nyheten ${title}.`;
    case "draft": return by ? `${by}sparade nyheten ${title} som utkast.` : `Sparade nyheten ${title} som utkast.`;
    case "updated": return `Ändrade nyheten ${title}.`;
    case "unpublished": return `Gjorde nyheten ${title} till ett utkast igen.`;
    case "deleted": return `Tog bort nyheten ${title}.`;
    case "pinned": return `Fäste nyheten ${title} överst.`;
    case "unpinned": return `Lossade nyheten ${title}.`;
  }
}
