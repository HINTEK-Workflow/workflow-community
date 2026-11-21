import { prisma } from "@/lib/db";
import { swedishDayKey } from "@/lib/swedish-time";
import type { TaskNotification } from "@/lib/workflow/task-notifications";

/**
 * Nya felrapporter i klockan (2026-11-13): when someone sends Rapportera fel eller förslag (the commercial part makes the
 * issue), the product owner is told in the bell the same way as about the servers – a notice of the installation's superadmin,
 * never a company's. Only the number, the kind and the issue's address are kept; the person's text stays in the issue.
 * Without the commercial part nothing writes these rows, so there are never any notices.
 */
export const ISSUE_REPORT_ACTION = "issue_report";
/** Not a company: the rows belong to the installation, so no company's log ever shows them. */
export const ISSUE_REPORT_ORGANIZATION = "system:issue-reports";
/** How long a report stays in the bell (read or not). */
export const ISSUE_REPORT_DAYS = 14;
type Kind = "fel" | "forbattring" | "rapport";

export const issueReportDetail = (input: { number: number; kind: Kind; url: string }) => `#${input.number} ${input.kind} ${input.url}`;

export function parseIssueReport(detail: string): { number: number; kind: Kind; url: string } | null {
  const match = /^#(\d{1,9}) (fel|forbattring|rapport) (https:\/\/github\.com\/[A-Za-z0-9._\-/]{1,250})$/.exec(detail);
  return match ? { number: Number(match[1]), kind: match[2] as Kind, url: match[3] } : null;
}

const TITLE: Record<Kind, string> = { fel: "Ny felrapport", forbattring: "Nytt förslag", rapport: "Ny rapport" };

export function issueReportNotice(event: { id: string; detail: string; createdAt: Date }): TaskNotification | null {
  const report = parseIssueReport(event.detail);
  if (!report) return null;
  return {
    id: `ISSUE_REPORT:${event.id}`, title: `${TITLE[report.kind]} #${report.number}`, kind: "ISSUE_REPORT",
    detail: "Öppna ärendet på GitHub.", href: report.url, dueDate: swedishDayKey(event.createdAt), deadline: null, needsAction: false,
  };
}

/** The reports of the last ISSUE_REPORT_DAYS days, newest first, for the superadmin's bell. */
export async function issueReportNotices(now = new Date()): Promise<TaskNotification[]> {
  try {
    const events = await prisma.administrationEvent.findMany({
      where: { organizationId: ISSUE_REPORT_ORGANIZATION, action: ISSUE_REPORT_ACTION, createdAt: { gte: new Date(now.getTime() - ISSUE_REPORT_DAYS * 86_400_000) } },
      orderBy: { createdAt: "desc" }, take: 50, select: { id: true, detail: true, createdAt: true },
    });
    return events.map(issueReportNotice).filter((item): item is TaskNotification => Boolean(item));
  } catch { return []; }
}
