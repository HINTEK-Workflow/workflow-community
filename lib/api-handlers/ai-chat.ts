import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ApiError,
  body,
  checkOrigin,
  context,
  failure,
} from "@/lib/kfid/server";
import { getWorkflowAgent } from "@/lib/ai/agent-registry";
import { quoteAiRun } from "@/lib/ai/cost-policy";
import { routeAiModel } from "@/lib/ai/model-catalog";
import { aiProviderStatus } from "@/lib/ai/provider-status";
import {
  compensateFailedAiRun,
  markAiRunStarted,
  reserveAiRun,
  settleAiRun,
} from "@/lib/ai/run-ledger";
import {
  assistantTaskLimits,
  estimateAssistantInputTokens,
} from "@/lib/ai/task-router";
import { actionAnswer, isPageQuestion, type RulePlan } from "@/lib/ai/assistant-rules";
import { answerForPage, answerWithoutAi, answerWithRules, helpSearchAnswer, planAnswer, searchSources, workContext } from "@/lib/ai/assistant-engine";
import { AliasMap } from "@/lib/ai/alias";
import { aiRunPricing } from "@/lib/ai/credit-settings-server";
import { readMemories } from "@/lib/ai/memory";
import {
  assistantSources,
  compactHistory,
  executeWorkflowAssistant,
} from "@/lib/ai/workflow-assistant";
import { AI_RATE_LIMIT_REASON, allowAiCall } from "@/lib/ai/rate-limit";
import { AI_COMPANY_LIMIT_REASON, allowCompanyAiCall } from "@/lib/ai/company-limit";
import { ASSISTANT_MAX_TOOL_CALLS, assistantToolDefinitions, createAssistantToolRunner, isOwnWorkQuestion, preloadedTask, TOOL_OUTPUT_MAX_CHARS } from "@/lib/ai/assistant-tools";
import { ASSISTANT_WORK_MAX_TOOL_CALLS, CHAT_MODES, CHAT_PROPOSAL_DEFINITIONS, chatProposalToolNames, isAutoKind, isWorkRequest, type ChatProposalTool } from "@/lib/ai/chat-proposals";
import { companyAgents } from "@/lib/agents/system-agents-server";
import { allowedProposalTools, focusInstruction, SYSTEM_AGENTS } from "@/lib/agents/system-agents";
import { applyProposal } from "@/lib/api-handlers/ai-proposals";
import { autoAppliesAtOnce } from "@/lib/agents/tool-policy";
import { createChatProposer } from "@/lib/ai/chat-proposals-server";
import { runTool } from "@/lib/tools/registry";
import { WORKFLOW_KNOWLEDGE_VERSION } from "@/lib/ai/knowledge/workflow-knowledge";
import { readCachedResult, resultCacheKey, storeCachedResult } from "@/lib/ai/result-cache";
import { configuredAssistantProvider, euRefusal } from "@/lib/ai/assistant-provider";
import { companyKeyErrorReason } from "@/lib/ai/company-key-server";
import type { AssistantLive } from "@/lib/ai/workflow-assistant";
import { aiMay, getAiSharingPolicy, sharesWork, sourceAllowed } from "@/lib/ai/sharing-policy";
import { readLimitedUpload } from "@/lib/security/limited-body";
import { CHAT_IMAGE_MAX_BYTES, CHAT_REQUEST_MAX_BYTES, IMAGE_TOO_LARGE, IMAGE_WRONG_TYPE, imageMessageNote } from "@/lib/ai/chat-media";
import { IMAGES_OFF } from "@/lib/ai/azure-settings";
import { prepareChatImage } from "@/lib/ai/chat-image";
import { attachmentImage, chatMediaStatus } from "@/lib/ai/chat-media-server";
import { executeFormAssistant, FORM_AI_DEFINITION, FORM_AI_MAX_OUTPUT_TOKENS, FORM_AI_MAX_TOOL_CALLS, FORM_AI_OWN_PROTOCOL_REQUIRED, FORM_AI_SURFACE, FORM_AI_TOOL, formAiInstructions, formModeSchema } from "@/lib/ai/form-ai";
import { createFormProposer, formAiDraftFor, readFormAiSkill } from "@/lib/ai/form-ai-server";
import { requireFormAdmin } from "@/lib/kfid/form-server";

export const dynamic = "force-dynamic";

const idSchema = z.string().min(1).max(100);
/** The progress line's step, sent by "Fråga Workflow AI" on a tip (2026-10-01): kinds and steps only, never names. */
const pageSchema = z.object({
  kind: z.enum(["WORK_ORDER", "RISK_ASSESSMENT", "FORM", "PROJECT"]),
  step: z.string().max(60).nullable(),
  hint: z.string().max(400).nullable(),
  steps: z.array(z.object({ label: z.string().max(60), state: z.enum(["done", "current", "upcoming", "skipped"]) })).max(8),
  tip: z.string().max(500).nullable(),
  label: z.string().max(120).optional(),
  taskId: idSchema.optional(),
  missing: z.array(z.string().max(200)).max(10).optional(),
  /** "tip": asked from a tip's "Fråga Workflow AI"; "page": the page the person is on while typing a question. */
  source: z.enum(["tip", "page", "summary"]).optional(),
  /** Sammanställ resultat: the rules' summary, which the AI turns into a finished text (2026-10-01). */
  draft: z.string().max(4000).optional(),
}).strict();
const requestSchema = z.union([
  // The older two-step flow: the question was saved first, and this answers it.
  z.object({ messageId: idSchema }).strict(),
  // One round trip (2026-10-01: "långsam"): the question is saved and answered in the same request.
  // Bilder (2026-11-21): a photo already on a work order goes by its id; a new photo goes as the form's file (readChatRequest).
  // mode (2026-11-21): Manuellt proposes, Auto saves at once what Ångra takes back (lib/ai/chat-proposals.ts AUTO_KINDS).
  // form (2026-11-25): Formulär med Workflow AI – the question is about a form for Skapa formulär (lib/ai/form-ai.ts).
  z.object({ content: z.string().trim().min(1).max(8_000), conversationId: idSchema.optional(), page: pageSchema.optional(), imageAttachmentId: idSchema.optional(), mode: z.enum(CHAT_MODES).optional(), form: formModeSchema.optional() }).strict(),
]);

/**
 * The chat's request: JSON as before, or – with a new photo (2026-11-21) – a form with the same JSON in `payload` and the photo in
 * `image`, read with a ceiling. The photo is prepared on the server (EXIF gone, at most 1600 px) and kept only in this request.
 */
async function readChatRequest(request: Request) {
  if (!/^\s*multipart\/form-data\b/i.test(request.headers.get("content-type") ?? "")) return { input: requestSchema.parse(await body(request)), image: null };
  const form = await readLimitedUpload(request, CHAT_REQUEST_MAX_BYTES, { tooLarge: IMAGE_TOO_LARGE, notAForm: "Bilden kunde inte skickas. Försök igen." });
  let payload: unknown;
  try { payload = JSON.parse(String(form.get("payload") ?? "")); } catch { throw new ApiError(400, "Ogiltig JSON."); }
  const input = requestSchema.parse(payload);
  if ("messageId" in input) throw new ApiError(400, "En bild skickas med en ny fråga.");
  const file = form.get("image");
  if (!(file instanceof File)) throw new ApiError(400, IMAGE_WRONG_TYPE);
  if (file.size > CHAT_IMAGE_MAX_BYTES) throw new ApiError(413, IMAGE_TOO_LARGE);
  return { input, image: { image: await prepareChatImage(new Uint8Array(await file.arrayBuffer())), name: file.name || "foto" } };
}

/** The model used for answers from the rules (no AI provider, no credits). */
const RULES_MODEL = "Workflow – direkt svar";

function titleFromMessage(content: string) {
  const firstLine = content.split(/\r?\n/, 1)[0].replace(/\s+/g, " ").trim();
  return firstLine.length > 64 ? `${firstLine.slice(0, 61)}…` : firstLine;
}

const messageSelect = {
  id: true, content: true, conversationId: true, createdAt: true,
  conversation: { select: { title: true, messages: { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: 12, select: { id: true, role: true, content: true } } } },
};

/**
 * Workflow AI (2026-09-30): rule-first. The question is answered with Workflow's own tools when it can be (the
 * person's own lists, reminders, time, planning, projects, customers, search) – immediately, without credits and
 * without anything leaving Workflow. Only questions that need interpretation, summarising or analysis go to the AI
 * model, which the server picks at the level of the task (the company's admin chooses the AI-profil, 2026-10-24) and which
 * charges the company's credits. With ?stream=1 the answer streams to the chat (see POST below).
 */
async function answer(request: Request, live?: AssistantLive) {
  try {
    checkOrigin(request);
    const ctx = await context();
    const read = await readChatRequest(request);
    const input = read.input;
    if (ctx.organization.storageMode !== "HINTEK_CLOUD") throw new ApiError(409, "Assistenten kräver serverlagring.");
    // Formulär med Workflow AI (2026-11-25): checked before the question is saved – the person may edit forms (the forms
    // route's own rule, 2026-11-26), the company's AI is on with its proposals, and a photo goes only when the person has ticked that it is the company's
    // own protocol (the upphovsrätt rule). A photo from a work order never goes in form mode.
    const form = !("messageId" in input) && input.form ? input.form : null;
    if (form) {
      requireFormAdmin(ctx);
      if ("imageAttachmentId" in input && input.imageAttachmentId) throw new ApiError(400, "Bifoga bilden av protokollet direkt i formulärläget.");
      if (read.image && form.ownProtocol !== true) throw new ApiError(400, FORM_AI_OWN_PROTOCOL_REQUIRED);
      const early = await getAiSharingPolicy(ctx.organizationId);
      if (!early.enabled || !early.shareChatContent) throw new ApiError(409, "Workflow AI är av för företaget. Skapa formuläret med extern AI i stället.");
      if (!aiMay(early, "chatProposals")) throw new ApiError(409, "Företagets admin har stängt av förslag från Workflow AI.");
    }
    // Bilder (2026-11-21): a photo needs the AI model and a model that reads photos; checked before the question is saved, so
    // nothing is kept when it cannot be read. A photo already on a work order is read here, with the person's own rights.
    const attached = !("messageId" in input) && input.imageAttachmentId
      ? await attachmentImage(ctx, input.imageAttachmentId).then(({ image, name }) => ({ image, name }))
      : read.image;
    if (attached) {
      const early = await getAiSharingPolicy(ctx.organizationId);
      if (!early.enabled || !early.shareChatContent) throw new ApiError(409, "Workflow AI är av för företaget, så bilden kan inte läsas.");
      const media = await chatMediaStatus(ctx.organizationId);
      if (!media.images.ready) throw new ApiError(409, media.images.reason ?? IMAGES_OFF);
    }
    const message = "messageId" in input
      ? await prisma.aiMessage.findFirst({
        where: { id: input.messageId, organizationId: ctx.organizationId, authorId: ctx.user.id, role: "USER", conversation: { createdById: ctx.user.id, status: "ACTIVE" } },
        select: messageSelect,
      })
      : await prisma.$transaction(async (tx) => {
        const conversation = input.conversationId
          ? await tx.aiConversation.findFirst({ where: { id: input.conversationId, organizationId: ctx.organizationId, createdById: ctx.user.id, status: "ACTIVE" }, select: { id: true } })
          : await tx.aiConversation.create({ data: { organizationId: ctx.organizationId, createdById: ctx.user.id, title: titleFromMessage(input.content) }, select: { id: true } });
        if (!conversation) throw new ApiError(404, "AI-konversationen finns inte.");
        // The photo itself is never kept here; the message says one went with it, so the conversation reads right afterwards.
        const content = attached ? `${input.content}\n${imageMessageNote(attached.name)}`.slice(0, 8_100) : input.content;
        const created = await tx.aiMessage.create({ data: { conversationId: conversation.id, organizationId: ctx.organizationId, authorId: ctx.user.id, role: "USER", content }, select: { id: true } });
        await tx.aiConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
        return tx.aiMessage.findUniqueOrThrow({ where: { id: created.id }, select: messageSelect });
      });
    if (!message) throw new ApiError(404, "AI-meddelandet finns inte.");
    if (message.conversation.messages[0]?.id !== message.id)
      throw new ApiError(409, "Bara konversationens senaste meddelande kan skickas.");
    const conversation = { id: message.conversationId, title: message.conversation.title };
    const userMessage = { id: message.id, role: "USER" as const, content: message.content, citations: [], model: null, createdAt: message.createdAt };

    const requestKey = `assistant:${message.id}`;
    const existing = await prisma.aiRun.findUnique({
      where: {
        organizationId_requestKey: {
          organizationId: ctx.organizationId,
          requestKey,
        },
      },
      include: { assistantMessage: true },
    });
    if (existing?.status === "COMPLETED" && existing.assistantMessage) {
      return NextResponse.json({
        runId: existing.id,
        conversation,
        userMessage,
        message: existing.assistantMessage,
        chargedCredits: existing.chargedCredits,
        mode: "AI",
        reused: true,
      });
    }
    if (existing)
      throw new ApiError(409, "AI-körningen är redan startad eller avslutad. Spara en ny fråga för att försöka igen.");

    // 1. Rules: the same tools as the API and MCP, in the person's own session.
    // In form mode the page's step is not part of the question: only the form is.
    const page = form ? undefined : "page" in input ? input.page : undefined;
    // A question from a tip's "Fråga Workflow AI" is about the current step: the AI model when it is on, else the rules.
    // From a tip the question is about the step (AI when it is on). Typed on a page (2026-10-01: "den förstår inte att
    // jag är på kontrollsidan"), a question about the page – how to fill it in, what is missing, the next step – is
    // answered from the page's own rules for free; any other question is planned as usual, with the page as context.
    const fromTip = page && page.source !== "page" && !attached;
    // A question with a photo always goes to the model: the rules cannot look at it.
    const aboutPage = Boolean(page && !fromTip && !attached && isPageQuestion(message.content));
    if (page && aboutPage) {
      const direct = answerForPage(page, "");
      const saved = await prisma.$transaction(async (tx) => {
        const created = await tx.aiMessage.create({ data: { conversationId: message.conversationId, organizationId: ctx.organizationId, role: "ASSISTANT", content: direct.answer.slice(0, 12_000), citations: direct.citations as never, model: RULES_MODEL } });
        await tx.aiConversation.update({ where: { id: message.conversationId }, data: { lastMessageAt: created.createdAt } });
        return created;
      });
      return NextResponse.json({ conversation, userMessage, message: saved, chargedCredits: 0, mode: "RULES", reused: false });
    }
    // A form is always written by the model; the rules have nothing to answer it with.
    let plan: RulePlan = fromTip || attached || form ? { kind: "ai" as const, reason: "interpretation" as const, searchQuery: null } : planAnswer(message.content);
    // Hur gör jag (2026-11-21): the help search answers at once when the rules find it surely; otherwise the model answers with
    // search_help among its tools, and without the model the search's best hits are the answer.
    let helpFallback: { answer: string; citations: unknown[] } | null = null;
    if (plan.kind === "tool" && plan.tool === "search_help") {
      const help = await helpSearchAnswer(plan);
      if (!help.confident) { helpFallback = help.direct; plan = { kind: "ai", reason: "open-question", searchQuery: null }; }
    }
    // Förslag från chatten (2026-10-09, AI-beslut 1): "skapa / lägg till / planera …" goes to Workflow AI, which
    // takes part with a proposal, when the company's AI is on and its admin allows proposals; otherwise the rules' link.
    const actionPlan = plan.kind === "action" ? plan : null;
    if (actionPlan) {
      const early = await getAiSharingPolicy(ctx.organizationId);
      if (early.enabled && early.shareChatContent && chatProposalToolNames(early).length) plan = { kind: "ai", reason: "interpretation", searchQuery: null };
    }
    const searchQuery = plan.kind === "ai" ? plan.searchQuery : null;
    // Without the AI model a work request still gets the rules' answer: where in Workflow it is done.
    // In form mode the way without Workflow AI is the external AI, beside the import in Skapa formulär.
    const withoutAi = async (reason: string) => form ? { answer: `Formuläret kan inte tas fram med Workflow AI just nu. ${reason} Du kan skapa det med extern AI under Skapa formulär.`, citations: [] }
      : actionPlan ? actionAnswer(actionPlan.what) : helpFallback ?? answerWithoutAi(searchQuery, reason, message.content);
    const saveDirect = async (content: string, citations: unknown[]) => {
      const saved = await prisma.$transaction(async (tx) => {
        const created = await tx.aiMessage.create({ data: { conversationId: message.conversationId, organizationId: ctx.organizationId, role: "ASSISTANT", content: content.slice(0, 12_000), citations: citations as never, model: RULES_MODEL } });
        await tx.aiConversation.update({ where: { id: message.conversationId }, data: { lastMessageAt: created.createdAt } });
        return created;
      });
      return NextResponse.json({ conversation, userMessage, message: saved, chargedCredits: 0, mode: "RULES", reused: false });
    };
    if (plan.kind !== "ai") {
      // Hjälp names the proposals only when the company's AI and its admin's switch allow them (the same test as above).
      const helpPolicy = plan.kind === "help" ? await getAiSharingPolicy(ctx.organizationId) : null;
      const direct = await answerWithRules(plan, { proposals: Boolean(helpPolicy?.enabled && helpPolicy.shareChatContent && chatProposalToolNames(helpPolicy).length) });
      return saveDirect(direct.answer, direct.citations);
    }

    // 2. AI: only when it is switched on for the company, allowed by its sharing choices and paid by its credits.
    const provider = await aiProviderStatus(ctx.organizationId);
    const agent = getWorkflowAgent("workflow-assistant");
    const sharingPolicy = await getAiSharingPolicy(ctx.organizationId);
    // The company's AI-profil and EU choice (2026-10-24): a profile that is not ready refuses AI, never another provider.
    const euStop = sharingPolicy.enabled ? await euRefusal(ctx.organizationId) : null;
    const aiReady = !euStop && sharingPolicy.enabled && sharingPolicy.shareChatContent && provider.enabled && provider.configured && agent?.lifecycle === "ENABLED";
    const shareSources = sharingPolicy.shareCustomers || sharingPolicy.shareDocuments || sharesWork(sharingPolicy);
    if (!aiReady) {
      // Without AI the best the rules can do: the one clear match's details, or a search for the question's words.
      // What Workflow has not switched on comes first: the company's admin cannot fix that (MOB-05, 2026-10-18).
      const reason = euStop ? euStop : !provider.enabled || !provider.configured
        ? "AI-modellen är inte påslagen på servern ännu."
        : "Företagets admin har inte slagit på Workflow AI för tolkning och sammanfattningar (under Inställningar → Arbetssätt → Workflow AI).";
      const direct = page && fromTip ? answerForPage(page, `AI-modellen kan resonera kring steget när den är påslagen. ${reason}`) : await withoutAi(reason);
      return saveDirect(direct.answer, direct.citations);
    }

    // Where the answer was asked for, so tokens and cost can be measured per place (plan 2026-10-01, fas 0).
    const isSummary = page?.source === "summary" && Boolean(page.draft);
    const surface = form ? FORM_AI_SURFACE : attached ? "chat-image" : isSummary ? "summary" : fromTip ? "tip" : page ? "chat-page" : "chat";
    // Skriv med AI on unchanged material: the text already written is given back, without a new call or credits.
    const cacheKey = isSummary ? resultCacheKey({ organizationId: ctx.organizationId, agentId: "workflow-assistant", model: routeAiModel("SIMPLE_CHAT").model, material: `${page?.label ?? ""}\n${page?.draft ?? ""}` }) : null;
    const cached = cacheKey ? readCachedResult(cacheKey) : null;
    if (cached) {
      const saved = await prisma.$transaction(async (tx) => {
        const created = await tx.aiMessage.create({ data: { conversationId: message.conversationId, organizationId: ctx.organizationId, role: "ASSISTANT", content: cached.answer, citations: [], model: cached.model } });
        await tx.aiConversation.update({ where: { id: message.conversationId }, data: { lastMessageAt: created.createdAt } });
        return created;
      });
      return NextResponse.json({ conversation, userMessage, message: saved, chargedCredits: 0, mode: "AI", reused: true });
    }
    // A protection in the background: many AI answers in a minute get the best direct answer instead.
    if (!allowAiCall(ctx.user.id)) {
      const direct = page && fromTip ? answerForPage(page, AI_RATE_LIMIT_REASON) : await withoutAi(AI_RATE_LIMIT_REASON);
      return saveDirect(direct.answer, direct.citations);
    }
    if (!(await allowCompanyAiCall(ctx.organizationId))) {
      const direct = page && fromTip ? answerForPage(page, AI_COMPANY_LIMIT_REASON) : await withoutAi(AI_COMPANY_LIMIT_REASON);
      return saveDirect(direct.answer, direct.citations);
    }

    // The server decides how much AI is needed: with Workflow sources a search answer (low effort), without a plain
    // answer (no extra reasoning). The person never picks a model.
    // Read tools for the answer (fas 1): only for a typed question, and only the ones the company's choices allow. A
    // summary is written from its draft and a tip's question is about the step, so neither gets tools.
    const alias = new AliasMap();
    // Förslag från chatten (AI-beslut 1 och 4) and up to five calls for a work request (AI-beslut 2), each under the
    // admin's own switch. The proposal tools only save a proposal; the person applies it with the ordinary tool.
    // De inbyggda agenterna (2026-11-21): an agent the company switched off takes its proposal tools away; its focus goes with the
    // company's memory, after the rules, as data.
    const agents = await companyAgents(ctx.organizationId, ctx.user.id);
    const proposalNames = (isSummary || fromTip || form ? [] : allowedProposalTools(chatProposalToolNames(sharingPolicy), (agentId) => agents.get(agentId) ?? null)) as ChatProposalTool[];
    // Form mode: one tool only, propose_form – no read tools, so nothing of the company's work can be fetched into the answer.
    const toolDefinitions = form ? [FORM_AI_DEFINITION] : isSummary || fromTip ? [] : [...assistantToolDefinitions(sharingPolicy), ...proposalNames.map((name) => CHAT_PROPOSAL_DEFINITIONS[name])];
    const focus = SYSTEM_AGENTS.filter((agent) => agent.kind === "proposal" && agents.get(agent.id)?.on && agents.get(agent.id)?.focus).map((agent) => `${agent.name}: ${focusInstruction(agents.get(agent.id)!.focus)}`).join("\n");
    const autoMode = "mode" in input && input.mode === "auto";
    const maxCalls = isWorkRequest(message.content) && aiMay(sharingPolicy, "moreToolCalls") ? ASSISTANT_WORK_MAX_TOOL_CALLS : ASSISTANT_MAX_TOOL_CALLS;
    const proposerOptions = { ctx, policy: sharingPolicy, conversationId: message.conversationId, runId: null as string | null, openTaskId: page?.taskId ?? null };
    // The draft the form question is about (the one open in the builder, or the one this conversation made), and the package's rules.
    const [formDraft, formSkill] = form ? await Promise.all([formAiDraftFor(ctx, { templateId: form.templateId, conversationId: message.conversationId }), readFormAiSkill()]) : [null, null];
    const formOptions = { ctx, conversationId: message.conversationId, runId: null as string | null, draft: formDraft ? { templateId: formDraft.templateId, draftRevision: formDraft.draftRevision } : null };
    const proposer = form ? createFormProposer(formOptions) : proposalNames.length ? createChatProposer(proposerOptions) : null;
    const allowedProposals: readonly string[] = form ? [FORM_AI_TOOL] : proposalNames;
    const toolRunner = toolDefinitions.length ? createAssistantToolRunner({ policy: sharingPolicy, alias, run: runTool, maxCalls: form ? FORM_AI_MAX_TOOL_CALLS : maxCalls, ...(form ? { readTools: false } : {}), ...(proposer ? { proposer: { allowed: allowedProposals, handle: proposer.handle } } : {}) }) : null;
    // Everything the answer is built on is read side by side (2026-10-05: these reads ran one after another
    // before the model was even asked): the search, the memories, the work overview and the task the person has open.
    // A summary is written from its draft alone: no memory, no work overview and no earlier messages are sent.
    // Alias för grunduppgifter (2026-10-01): one map (above) for everything this answer sends; the answer is
    // restored. The work overview goes with a question about the person's own work as a whole – cheaper than several
    // tool calls; any other question leaves it out and fetches what it needs with the tools.
    const openTaskId = toolRunner && page?.taskId && toolDefinitions.some((tool) => tool.name === "get_task") ? page.taskId : null;
    // Form mode sends nothing of this: no search, no memory, no work overview (only what the person sends, and the open draft).
    const [found, memory, work, openTask] = await Promise.all([
      shareSources && searchQuery && !form ? searchSources(searchQuery) : Promise.resolve([]),
      isSummary || form ? Promise.resolve({ company: "", user: "" }) : readMemories(ctx.organizationId, ctx.user.id),
      sharesWork(sharingPolicy) && !isSummary && !fromTip && !form && isOwnWorkQuestion(message.content) ? workContext(alias) : Promise.resolve(undefined),
      openTaskId && toolRunner ? toolRunner.preload("get_task", { taskId: openTaskId }) : Promise.resolve(null),
    ]);
    const sources = assistantSources(found.filter((item) => sourceAllowed(sharingPolicy, item.resourceType)).map((item) => ({ ...item })));
    const currentTask = preloadedTask(openTask);
    // Form mode has its tool, so it answers at the chat's own level (the model whose card says Bilder, lib/ai/chat-media-server.ts);
    // one of its turns may hold the whole form.
    const taskKind = sources.length || toolRunner ? "WORKFLOW_SEARCH" as const : "SIMPLE_CHAT" as const;
    const policy = routeAiModel(taskKind);
    const limits = form ? { ...assistantTaskLimits(taskKind), maxOutputTokens: FORM_AI_MAX_OUTPUT_TOKENS } : assistantTaskLimits(taskKind);
    const completeHistory = [...message.conversation.messages].reverse().map((item) => ({
      role: item.role,
      content: item.content,
    }));
    // Older messages go in as their first line only (fewer tokens); the latest ones whole.
    const history = compactHistory(sharingPolicy.shareConversationHistory && !isSummary
      ? completeHistory
      : completeHistory.slice(-1));
    const estimatedInputTokens = estimateAssistantInputTokens([
      memory.company, memory.user,
      ...history.map((item) => item.content),
      ...sources.flatMap((source) => [source.title, source.description]),
      work ? JSON.stringify(work) : "", page ? JSON.stringify(page) : "", openTask ?? "",
      toolDefinitions.length ? JSON.stringify(toolDefinitions) : "",
      // Form mode's instructions are the package's whole reference, and the open draft goes with every turn.
      formSkill ? formAiInstructions(formSkill) : "", formDraft ? JSON.stringify(formDraft) : "",
    ].join("\n")) + (attached?.image.tokens ?? 0);
    // With tools an answer takes up to one turn per call and a last one, and every turn sends the question and the
    // earlier results again: the run reserves for all of them (what is not used is released at the settlement).
    const turns = toolRunner ? toolRunner.maxCalls + 1 : 1;
    // In form mode the form the model wrote in one turn is input to the next.
    const toolOutputTokens = toolRunner ? toolRunner.maxCalls * (Math.ceil(TOOL_OUTPUT_MAX_CHARS / 3) + (form ? FORM_AI_MAX_OUTPUT_TOKENS : 0)) : 0;
    const inputTokenLimit = Math.min(200_000, turns * (Math.max(limits.minimumInputTokens, estimatedInputTokens * 2) + toolOutputTokens));
    const maxOutputTokens = limits.maxOutputTokens * turns;
    // The product owner sets the least an AI answer costs (2026-10-01); the run stores it.
    const { minimumCredits, fx, free, creditValueOre, policy: pricing } = await aiRunPricing(taskKind, ctx.organizationId);
    const quote = quoteAiRun({
      taskKind,
      policy: pricing,
      inputTokenLimit,
      maxOutputTokens,
      usdSekRateMicros: fx.usdSekRateMicros,
      minimumCredits,
      free,
      creditValueOre,
    });
    // A read: no wallet yet means a zero balance (2026-10-08); the reservation creates the wallet when credits are spent.
    const wallet = (await prisma.creditWallet.findUnique({ where: { organizationId: ctx.organizationId }, select: { balance: true } })) ?? { balance: 0 };
    // Without enough credits the person still gets the best direct answer, with the reason (2026-10-01: an error
    // message instead of an answer made the chat feel broken).
    if (wallet.balance < quote.reservedCredits) {
      const reason = `Företaget har för få AI-krediter för AI-modellen (minst ${quote.reservedCredits} krävs, ${wallet.balance} finns).`;
      const direct = page && fromTip ? answerForPage(page, reason) : await withoutAi(reason);
      return saveDirect(direct.answer, direct.citations);
    }

    const reserved = await reserveAiRun({
      organizationId: ctx.organizationId,
      subject: { type: "WORKFLOW_ASSISTANT", id: message.conversationId },
      actorId: ctx.user.id,
      agentId: "workflow-assistant",
      minimumCredits,
      free,
      creditValueOre,
      taskKind,
      policy: pricing,
      requestKey,
      surface,
      estimatedInputTokens,
      inputTokenLimit,
      maxOutputTokens,
      usdSekRateMicros: fx.usdSekRateMicros,
      fxSource: fx.source,
      fxEffectiveDate: fx.effectiveDate,
    });
    await markAiRunStarted(ctx.organizationId, reserved.run.id, ctx.user.id);
    proposerOptions.runId = reserved.run.id;
    formOptions.runId = reserved.run.id;
    // Proposals made before an answer failed are never offered: the person sees no answer to apply them from.
    const expireProposals = async () => { if (proposer?.created.length) await prisma.aiProposal.updateMany({ where: { id: { in: proposer.created.map((item) => item.id) }, organizationId: ctx.organizationId, status: "PENDING" }, data: { status: "EXPIRED" } }); };

    let providerResult;
    try {
      providerResult = form && formSkill && toolRunner ? await executeFormAssistant(await configuredAssistantProvider(ctx.organizationId), {
        ...(live ? { live } : {}),
        skill: formSkill,
        model: policy.model,
        reasoningEffort: policy.reasoningEffort,
        maxOutputTokens: limits.maxOutputTokens,
        organizationId: ctx.organizationId,
        actorId: ctx.user.id,
        history,
        draft: formDraft ? { templateId: formDraft.templateId, meta: formDraft.meta, document: formDraft.document } : null,
        alias,
        ...(attached ? { images: [attached.image.dataUrl] } : {}),
        tools: { definitions: toolDefinitions, maxToolCalls: toolRunner.maxCalls, callTool: toolRunner.callTool },
      }) : await executeWorkflowAssistant(await configuredAssistantProvider(ctx.organizationId), {
        ...(live ? { live } : {}),
        model: policy.model,
        reasoningEffort: policy.reasoningEffort,
        maxOutputTokens: limits.maxOutputTokens,
        organizationId: ctx.organizationId,
        actorId: ctx.user.id,
        history,
        sources,
        memory: { company: [memory.company, focus, autoMode ? "Läget är Auto: det personen ber om sparas direkt när du föreslår det (med Ångra). Säg kort vad som sparades. Det som inte kan ångras förblir ett förslag med Använd." : ""].filter(Boolean).join("\n"), user: memory.user },
        workContext: work,
        currentTask,
        pageContext: page,
        alias,
        ...(attached ? { images: [attached.image.dataUrl] } : {}),
        ...(toolRunner ? { tools: { definitions: toolDefinitions, maxToolCalls: toolRunner.maxCalls, callTool: toolRunner.callTool, citations: toolRunner.citations } } : {}),
      });
      // Which tools the answer used and which knowledge pack it had (AI-planen 2.1, 2026-10-09), in the run's own log:
      // names, outcome and the version, never what was asked or found. Written for every answer, also without tool calls.
      await prisma.aiRunEvent.create({ data: { runId: reserved.run.id, organizationId: ctx.organizationId, actorId: ctx.user.id, action: "tools_called", data: { tools: toolRunner?.calls ?? [], knowledge: WORKFLOW_KNOWLEDGE_VERSION } } });
    } catch (error) {
      // Why it failed, without any content: the error kind and our own short reason (2026-10-02: the cause was invisible).
      console.error("Workflow AI provider failed", error instanceof Error ? `${error.name}: ${error.message.slice(0, 160)}` : "Unknown");
      await expireProposals();
      // Avbrott (2026-10-24): the person stopped the answer or closed the chat. Nothing is settled – the reservation is
      // returned like after any provider error, and nothing of the half answer is saved.
      const aborted = Boolean(live?.signal?.aborted) || (error instanceof Error && /Abort/.test(error.name));
      await compensateFailedAiRun({
        organizationId: ctx.organizationId,
        runId: reserved.run.id,
        actorId: ctx.user.id,
        failureCode: aborted ? "CLIENT_ABORTED" : "PROVIDER_FAILED",
      });
      if (aborted) throw new ApiError(409, "Svaret avbröts. Reservationen har återförts.");
      // The company's own AI key said no (2026-11-27): its own reason, never a quiet move to Workflow's key.
      const ownKey = companyKeyErrorReason(error);
      if (ownKey) throw new ApiError(502, ownKey);
      throw new ApiError(502, "AI-leverantören kunde inte slutföra svaret. Reservationen har återförts.");
    }

    let settled;
    try {
      settled = await settleAiRun({
        organizationId: ctx.organizationId,
        runId: reserved.run.id,
        actorId: ctx.user.id,
        providerResponseId: providerResult.providerResponseId,
        usage: providerResult.usage,
        assistantMessage: {
          conversationId: message.conversationId,
          content: providerResult.answer,
          citations: providerResult.citations,
          // The model that answered (on Azure the model behind the deployment), as the run records it.
          model: pricing.model,
        },
      });
    } catch {
      await expireProposals();
      await compensateFailedAiRun({
        organizationId: ctx.organizationId,
        runId: reserved.run.id,
        actorId: ctx.user.id,
        failureCode: "SETTLEMENT_FAILED",
      });
      throw new ApiError(502, "AI-svaret kunde inte sparas säkert. Reservationen har återförts.");
    }

    if (cacheKey) storeCachedResult(cacheKey, providerResult.answer, policy.model);
    // The settled run's own message (saved atomically with the settlement), so the panel can show it without a reload.
    const assistantMessage = await prisma.aiMessage.findUnique({ where: { runId: settled.run.id }, select: { id: true, role: true, content: true, citations: true, model: true, createdAt: true } });
    // The answer's proposals belong to its message, so the conversation shows them again when it is opened.
    let proposals: { id: string; kind: string; status: string; payload: unknown; result?: unknown }[] = proposer?.created ?? [];
    if (proposals.length && assistantMessage) await prisma.aiProposal.updateMany({ where: { id: { in: proposals.map((item) => item.id) }, organizationId: ctx.organizationId }, data: { proposedByMessageId: assistantMessage.id } });
    // Auto (2026-11-21): what Ångra takes back is saved now, with the same tool, permission and history as Använd; a refusal
    // leaves the proposal with Använd and its reason.
    if (autoMode && proposals.length) {
      proposals = await Promise.all(proposals.map(async (item) => {
        // A catalog action is saved at once only when Ångra can take it back; otherwise it waits for Använd, also in Auto.
        // A customer's details always wait for Använd (säkerhetsgranskningen 2026-11-24, F-03).
        if (!isAutoKind(item.kind) && !(item.kind === "ACTION" && autoAppliesAtOnce(String((item.payload as { tool?: unknown } | null)?.tool ?? "")))) return item;
        const row = await prisma.aiProposal.findFirst({ where: { id: item.id, organizationId: ctx.organizationId, createdById: ctx.user.id } });
        if (!row) return item;
        try {
          const applied = (await applyProposal(ctx, row, { auto: true })).proposal as { status: string; result: unknown };
          return { ...item, status: applied.status, result: applied.result };
        } catch (error) {
          return { ...item, result: { autoError: error instanceof Error ? error.message : "Det gick inte att spara direkt." } };
        }
      }));
    }
    return NextResponse.json({
      runId: settled.run.id,
      conversation,
      userMessage,
      message: { ...(assistantMessage ?? { id: settled.run.id, role: "ASSISTANT", content: providerResult.answer, citations: providerResult.citations, model: pricing.model, createdAt: new Date() }), proposals },
      chargedCredits: settled.run.chargedCredits,
      // What is left, shown in the panel instead of only what the answer cost (2026-10-01).
      balance: (await prisma.creditWallet.findUnique({ where: { organizationId: ctx.organizationId }, select: { balance: true } }))?.balance ?? null,
      mode: "AI",
      reused: false,
    });
  } catch (error) {
    return failure(error);
  }
}

/**
 * Strömning till chatten (2026-10-24, svar 6): with ?stream=1 the answer is sent as it is written, as lines of JSON
 * (application/x-ndjson): {"type":"delta","text"} for each piece of the answer (real names already restored), {"type":"reset"} when
 * the model turned to a tool after all, and last {"type":"done","status","body"} with exactly what the plain call answers. The
 * checks, the reservation, the tool calls (run by the server) and the settlement are the same code as without streaming. When the
 * person closes the chat or presses Stoppa, the request's signal stops the provider and the reservation is returned.
 */
export async function POST(request: Request) {
  if (new URL(request.url).searchParams.get("stream") !== "1") return answer(request);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: Record<string, unknown>) => {
        if (!open) return;
        try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { open = false; }
      };
      const response = await answer(request, { onText: (text) => send({ type: "delta", text }), onReset: () => send({ type: "reset" }), signal: request.signal });
      let body: unknown;
      try { body = await response.json(); } catch { body = { error: "Svaret kunde inte läsas." }; }
      send({ type: "done", status: response.status, body });
      if (open) { open = false; try { controller.close(); } catch { /* the person already left */ } }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
