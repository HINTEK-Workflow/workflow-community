import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/kfid/errors";
import { currentPrincipal } from "@/lib/integrations/principal";
import { createPost, getPost, setPostBackground, updatePost } from "@/lib/meta/server";
import { scheduleForApproval } from "@/lib/schedule/server";
import { acceptedAssignmentDraft, ASSIGNMENT_DRAFT_INSTRUCTIONS, assignmentDraftInput, assignmentDraftSchema, assignmentHashtags, briefText, filmLink, type AssignmentDraft, type AssignmentInstruction, type FilmRef } from "./model";
import { assignmentTime, autoPublishDecision, type AutoPublishInput } from "./auto-publish";
import { assignmentStore, autoPublishRule, settingStore } from "./store";

/**
 * Innehållsuppdrag (2026-11-25) on the server: create_content_brief makes ONE draft under Inlägg for the instruction and
 * lets Workflow AI write its text the same way as the content series' AI drafts (lib/schedule/series-server.ts, draftSeriesItem): the
 * built-in agent Utkast till inläggsserier must be on, and runStructuredAgent checks the server's provider, the company's AI switch,
 * EU, the rate and the credits. Without AI, or when the text breaks the rules, the draft is the instruction itself, clearly marked.
 * A film from the film page gives the post the film's picture and a link to the film's own page (?via=kanal).
 * The draft then goes into Schemalagt at the recommended time WAITING FOR APPROVAL (lib/schedule/server.ts, scheduleForApproval) –
 * the built-in scheduler publishes it after the admin's Godkänn. Only the company's own rule (AutoPublishSetting, off by default)
 * can approve it automatically, and that is logged with the key. The same externalRef gives the same draft.
 */
type Actor = { userId: string; organizationId: string };
export const ASSIGNMENT_SOURCE = "api";

async function audit(actor: Actor, action: string, detail: string) {
  await prisma.administrationEvent.create({ data: { actorId: actor.userId, organizationId: actor.organizationId, action, detail: detail.slice(0, 500) } });
}

async function existing(organizationId: string, externalRef: string) {
  const found = await prisma.socialPost.findFirst({ where: { organizationId, source: ASSIGNMENT_SOURCE, sourceRef: externalRef }, select: { id: true } });
  return found ? getPost(organizationId, found.id) : null;
}

/** The films of the film page (empty without the landing page). */
export async function filmList(): Promise<FilmRef[]> {
  const { serverExtensions } = await import("@/lib/extensions/server");
  return (await serverExtensions.landingFilmList?.()) ?? [];
}

/** Workflow AI's text for the instruction, or the reason it was not written. */
async function aiText(actor: Actor, postId: string, instruction: AssignmentInstruction, film: FilmRef | null): Promise<{ draft: AssignmentDraft | null; reason: string | null }> {
  const { assertSystemAgentOn, withExtraInstruction } = await import("@/lib/agents/system-agents-server");
  let extra = "";
  try {
    extra = await assertSystemAgentOn(actor.organizationId, "post-series");
  } catch (error) {
    return { draft: null, reason: error instanceof Error ? error.message : "Agenten är avstängd." };
  }
  const { runStructuredAgent } = await import("@/lib/ai/agent-run");
  const outcome = await runStructuredAgent<AssignmentDraft>({
    organizationId: actor.organizationId, actorId: actor.userId, agentId: "workflow-writer", taskKind: "WRITING", surface: "content-assignment",
    subject: { type: "SOCIAL_POST", id: postId }, requestKey: `assignment-draft:${postId}:${randomUUID()}`,
    instructions: withExtraInstruction(ASSIGNMENT_DRAFT_INSTRUCTIONS, extra), input: assignmentDraftInput(instruction, film), schema: assignmentDraftSchema, schemaName: "hintek_assignment_post",
    // As the content series: the model gets the instruction only, no company data from Workflow.
    shared: () => true, maxOutputTokens: 900,
  }).catch(() => ({ used: false as const, reason: "Workflow AI kunde inte skriva utkastet." }));
  return outcome.used ? { draft: outcome.output, reason: null } : { draft: null, reason: outcome.reason };
}

/** Automatic approvals of the channel since the start of the Swedish day and of the week (Monday). */
async function autoCounts(organizationId: string, platform: string) {
  const store = assignmentStore();
  const now = new Date();
  const day = new Date(now); day.setUTCHours(now.getUTCHours() - 24);
  const week = new Date(now); week.setUTCDate(now.getUTCDate() - 7);
  const [dayCount, weekCount] = await Promise.all([
    store.count({ where: { organizationId, platform, autoApprovedAt: { gte: day } } }),
    store.count({ where: { organizationId, platform, autoApprovedAt: { gte: week } } }),
  ]);
  return { day: dayCount, week: weekCount };
}

export async function createContentAssignment(actor: Actor, instruction: AssignmentInstruction, externalRef: string | undefined, options: { autoPublish?: boolean } = {}) {
  if (externalRef) {
    const found = await existing(actor.organizationId, externalRef);
    if (found) return { existing: true, post: found };
  }
  const store = assignmentStore();
  let film: FilmRef | null = null;
  if (instruction.filmSlug) {
    film = (await filmList()).find((entry) => entry.slug === instruction.filmSlug) ?? null;
    if (!film) throw new ApiError(400, "Filmen finns inte på filmsidan. Hämta filmerna med list_films.");
  }
  const channels = { toFacebook: instruction.platform === "facebook", toInstagram: instruction.platform === "instagram", toLinkedIn: instruction.platform === "linkedin" };
  // Instagram shows no links in the text; the film's page then goes in the Instagram line for the admin to place (e.g. in the bio).
  const link = instruction.platform === "instagram" ? null : film ? filmLink(film, instruction.platform) : instruction.link ?? null;
  let post;
  try {
    post = await createPost(actor, { ...briefText(instruction), hashtags: assignmentHashtags(instruction), link, ...channels, campaignLinks: true, aiGenerated: false }, externalRef ? { source: ASSIGNMENT_SOURCE, sourceRef: externalRef } : undefined);
  } catch (error) {
    if (externalRef && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const found = await existing(actor.organizationId, externalRef);
      if (found) return { existing: true, post: found };
    }
    throw error;
  }
  await store.create({ data: { postId: post.id, organizationId: actor.organizationId, instruction: instruction as object, textSource: "brief", reason: null, platform: instruction.platform, createdById: actor.userId } });
  const where = { postId_organizationId: { postId: post.id, organizationId: actor.organizationId } };
  const reasons: string[] = [];

  const { draft, reason } = await aiText(actor, post.id, instruction, film);
  const accepted = acceptedAssignmentDraft(draft, instruction, film);
  if (reason) reasons.push(reason);
  else if (accepted.problems.length) reasons.push(`AI-texten hade ${accepted.problems.join(", ")}. Uppdraget visas som utkast i stället.`);
  if (accepted.source === "ai") await updatePost(actor, post.id, { ...accepted.text, aiGenerated: true });
  if (film?.poster) await setPostBackground(actor, post.id, { url: film.poster }).catch(() => reasons.push("Filmens bild kunde inte hämtas; välj en bild själv."));

  // Schemalagt at the recommended time, waiting for Godkänn – or approved by the company's own rule.
  const time = assignmentTime(instruction.publishAt);
  let scheduled: Awaited<ReturnType<typeof scheduleForApproval>> | null = null;
  let auto: { key: string } | null = null;
  if ("reason" in time) reasons.push(time.reason);
  else {
    const principal = currentPrincipal();
    const decision = autoPublishDecision({
      rule: await autoPublishRule(actor.organizationId), requested: options.autoPublish === true, platform: instruction.platform,
      principal: principal ? { kind: principal.kind, keyId: principal.keyId, scopes: principal.scopes } : null,
      counts: options.autoPublish ? await autoCounts(actor.organizationId, instruction.platform) : { day: 0, week: 0 },
    });
    if (decision.auto) auto = { key: principal?.keyName ?? "API-nyckel" };
    else if (options.autoPublish) reasons.push(decision.reason);
    scheduled = await scheduleForApproval(actor, post.id, time.at, auto ? { keyName: auto.key } : null);
    if ("reason" in scheduled) { reasons.push(scheduled.reason); auto = null; }
  }
  await store.update({ where, data: {
    textSource: accepted.source, reason: reasons.join(" ") || null,
    scheduledId: scheduled && "id" in scheduled ? scheduled.id : null,
    ...(auto ? { autoApprovedAt: new Date(), autoApprovedKey: auto.key.slice(0, 120) } : {}),
  } });
  await audit(actor, "content_assignment", `Ett innehållsuppdrag via API blev ett utkast till inlägg (id ${post.id}); ${accepted.source === "ai" ? "Workflow AI skrev texten" : "uppdraget visas som utkast"}${scheduled && "id" in scheduled ? (scheduled.status === "scheduled" ? ", godkänt automatiskt" : ", väntar på godkännande i Schemalagt") : ""}.`);
  return { existing: false, post: await getPost(actor.organizationId, post.id) };
}

// ---------- the company's rule (Inlägg → Uppdrag via API) ----------

export async function getAutoPublish(organizationId: string) {
  const rule = await autoPublishRule(organizationId);
  const keys = await prisma.integrationKey.findMany({ where: { organizationId, kind: { in: ["API", "MCP"] }, revokedAt: null }, orderBy: { createdAt: "desc" }, take: 25, select: { id: true, name: true, scopes: true, expiresAt: true } });
  return { rule, keys: keys.map((key) => ({ id: key.id, name: key.name, canAutopublish: key.scopes.includes("posts:autopublish"), expiresAt: key.expiresAt?.toISOString() ?? null })) };
}

export async function saveAutoPublish(actor: Actor, input: AutoPublishInput) {
  const known = new Set((await prisma.integrationKey.findMany({ where: { organizationId: actor.organizationId, id: { in: input.keyIds }, revokedAt: null }, select: { id: true } })).map((key) => key.id));
  const keyIds = input.keyIds.filter((id) => known.has(id));
  const data = { enabled: input.enabled, channels: [...new Set(input.channels)], keyIds, caps: input.caps as object, stoppedAt: null, updatedById: actor.userId };
  await settingStore().upsert({ where: { organizationId: actor.organizationId }, create: { organizationId: actor.organizationId, ...data }, update: data });
  await audit(actor, "autopublish_setting", `Publicera uppdrag via API utan godkännande: ${input.enabled ? `på för ${data.channels.join(", ") || "inga kanaler"} och ${keyIds.length} nycklar` : "av"}.`);
  return getAutoPublish(actor.organizationId);
}

/** Stoppknappen: off at once; the admin turns it on again with Spara. Items already approved stay in Schemalagt (Avbryt there). */
export async function stopAutoPublish(actor: Actor) {
  await settingStore().upsert({ where: { organizationId: actor.organizationId }, create: { organizationId: actor.organizationId, enabled: false, channels: [], keyIds: [], caps: {}, stoppedAt: new Date(), updatedById: actor.userId }, update: { enabled: false, stoppedAt: new Date(), updatedById: actor.userId } });
  await audit(actor, "autopublish_stop", "Stoppade automatiskt godkännande av innehållsuppdrag via API.");
  return getAutoPublish(actor.organizationId);
}
