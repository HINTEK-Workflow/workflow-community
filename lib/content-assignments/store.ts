import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { assignmentView, type AssignmentView } from "./model";
import { ruleOf, type AutoPublishRule } from "./auto-publish";

/**
 * The ContentAssignment and AutoPublishSetting rows (prisma/migrations/20261125120000_content_assignment). Reached through narrow
 * delegates so the code also builds before the Prisma client is regenerated; until then (no delegate) the posts have no assignment,
 * the rule reads as off and creating an assignment is refused with a plain reason. After `prisma generate` the delegates are the
 * generated ones.
 */
type Row = {
  postId: string; organizationId: string; instruction: unknown; textSource: string; reason: string | null; platform: string; scheduledId: string | null;
  autoApprovedAt: Date | null; autoApprovedKey: string | null; createdById: string | null; createdAt: Date; updatedAt: Date;
};
type Where = { postId_organizationId: { postId: string; organizationId: string } };
type Delegate = {
  create(args: { data: { postId: string; organizationId: string; instruction: object; textSource: string; reason: string | null; platform: string; createdById: string | null } }): Promise<Row>;
  update(args: { where: Where; data: Partial<Pick<Row, "textSource" | "reason" | "scheduledId" | "autoApprovedAt" | "autoApprovedKey">> }): Promise<Row>;
  findMany(args: { where: { organizationId: string; postId?: { in: string[] }; scheduledId?: { in: string[] } } }): Promise<Row[]>;
  count(args: { where: { organizationId: string; platform: string; autoApprovedAt: { gte: Date } } }): Promise<number>;
};
type SettingRow = { organizationId: string; enabled: boolean; channels: string[]; keyIds: string[]; caps: unknown; stoppedAt: Date | null; updatedById: string | null; updatedAt: Date };
type SettingDelegate = {
  findUnique(args: { where: { organizationId: string } }): Promise<SettingRow | null>;
  upsert(args: { where: { organizationId: string }; create: Omit<SettingRow, "updatedAt">; update: Partial<Omit<SettingRow, "organizationId" | "updatedAt">> }): Promise<SettingRow>;
};
const client = prisma as unknown as { contentAssignment?: Delegate; autoPublishSetting?: SettingDelegate };

export const assignmentsAvailable = () => Boolean(client.contentAssignment);

export function assignmentStore(): Delegate {
  if (!client.contentAssignment) throw new ApiError(503, "Innehållsuppdrag kräver att databasen är uppdaterad (migreringen content_assignment).");
  return client.contentAssignment;
}

export function settingStore(): SettingDelegate {
  if (!client.autoPublishSetting) throw new ApiError(503, "Inställningen kräver att databasen är uppdaterad (migreringen content_assignment).");
  return client.autoPublishSetting;
}

/** The company's assignments for these posts, by post id (empty before the migration). */
export async function assignmentsFor(organizationId: string, postIds: string[]): Promise<Map<string, AssignmentView>> {
  if (!client.contentAssignment || !postIds.length) return new Map();
  const rows = await client.contentAssignment.findMany({ where: { organizationId, postId: { in: postIds } } });
  return new Map(rows.map((row) => [row.postId, assignmentView(row)]));
}

/** The items in Schemalagt that were approved automatically, by item id: which key and when (shown in the list). */
export async function autoApprovalsFor(organizationId: string, scheduledIds: string[]): Promise<Map<string, { key: string; at: string }>> {
  if (!client.contentAssignment || !scheduledIds.length) return new Map();
  const rows = await client.contentAssignment.findMany({ where: { organizationId, scheduledId: { in: scheduledIds } } });
  return new Map(rows.filter((row) => row.scheduledId && row.autoApprovedAt).map((row) => [row.scheduledId as string, { key: row.autoApprovedKey ?? "API-nyckel", at: (row.autoApprovedAt as Date).toISOString() }]));
}

/** The company's rule; off before the migration and until an admin turns it on. */
export async function autoPublishRule(organizationId: string): Promise<AutoPublishRule> {
  if (!client.autoPublishSetting) return ruleOf(null);
  return ruleOf(await client.autoPublishSetting.findUnique({ where: { organizationId } }));
}
