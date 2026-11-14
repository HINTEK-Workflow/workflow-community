import { createHash, randomBytes } from "node:crypto";
import { newsletterMailSchema, type NewsletterMail } from "@/lib/mail/post-newsletter-mail";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { openCompanyKey, sealCompanyKey } from "@/lib/integrations/company-keys";
import { ApiError } from "@/lib/kfid/errors";
import { read } from "@/lib/kfid/storage";
import { workflowReportFont } from "@/lib/workflow/report-server";
import {
  debugToken, deleteObject, exchangeUserToken, facebookPhoto, facebookPhotoStory, fetchTransport, GRAPH_VERSION, graphIsLocal, INSTAGRAM_SCOPES, isGraphId, listPages, MetaError, missingScopes,
  type GraphTransport, type TokenInfo,
} from "./graph";
import sharp from "sharp";
import { brandColour, IMAGE_HEIGHT, IMAGE_WIDTH, renderPostImage, type PostBrand, type PostFormat, type PostImageInput } from "./image";
import { facebookLoginInstagram, waitForContainer, type InstagramPublisher } from "./instagram";
import { BODY_MAX, CAPTION_STORE_MAX, draftFromWebsitePage, facebookCaption, HEADING_MAX, instagramCaption, isLogoSize, isLogoVariant, isTemplate, LINK_MAX, linkedInCommentary, normalizeHashtags, postProblem, safeLink, type PostText } from "./text";

/**
 * Facebook och Instagram (2026-11-10) on the server: a company's own Meta app, the page and Instagram account it posts to, and
 * the company's posts (Inlägg). Everything is the company's own: every function takes the company the API checked, and every
 * row read or written is that company's.
 *
 * - The app secret and the tokens are sealed with the company's own data key (lib/integrations/company-keys.ts) and never
 *   returned; the view says only whether they are stored.
 * - Nothing is ever posted automatically. Publicera and Testpublicering are an admin's press, and both are refused until the
 *   company's admin has switched publishing on (publishingApproved, off by default).
 * - A token is never assumed to keep working: Meta's answer about it (debug_token) is read when the card is opened (at most
 *   every six hours) and on Kontrollera, and a token error while posting marks the connection invalid with a plain message.
 * - Instagram fetches the picture itself, from a short-lived address of its own per post (one hour, only the picture, no
 *   session); a server that cannot be reached from the internet says so and lets Facebook be tested alone.
 * - The audit is the company's own and names what was done – never a text of the post, never a key.
 */
export type Actor = { userId: string; organizationId: string };
const KEY = { secret: "meta-app-secret", user: "meta-user-token", page: "meta-page-token" } as const;
const CHECK_EVERY_MS = 6 * 60 * 60_000;
const SOON_MS = 7 * 24 * 60 * 60_000;
const IMAGE_KEY_MS = 60 * 60_000;

// The tests (and nothing else) give their own transport and a quicker wait for Instagram.
let transportOverride: GraphTransport | null = null;
export const metaTiming = { attempts: 15, delayMs: 2000 };
export function setMetaTransportForTests(transport: GraphTransport | null) { transportOverride = transport; }
const transport = () => transportOverride ?? fetchTransport;
const instagram = (): InstagramPublisher => facebookLoginInstagram(transport());

const row = (organizationId: string) => prisma.metaConnection.findUnique({ where: { organizationId } });
type Row = NonNullable<Awaited<ReturnType<typeof row>>>;

async function openKey(organizationId: string, keyId: string, stored: string | null) {
  if (!stored) return null;
  try { return await openCompanyKey(organizationId, keyId, stored); } catch { return null; }
}

async function audit(actor: Actor, action: string, detail: string) {
  await prisma.administrationEvent.create({ data: { actorId: actor.userId, organizationId: actor.organizationId, action, detail: detail.slice(0, 500) } });
}

/** Schemalägg (2026-11-11): a changed post waits for a new approval, a removed one's schedule is cancelled (lib/schedule/server.ts). */
const scheduleChanged = (organizationId: string, postId: string, removed = false) =>
  // Never stops the change itself: the job compares the approved content again before it publishes.
  import("@/lib/schedule/server").then((schedule) => schedule.postChanged(organizationId, postId, removed)).catch(() => undefined);

/** Meta's failures as the API's: a short Swedish text and a status the page understands (never 401, which signs out). */
function asApiError(error: unknown): unknown {
  if (error instanceof MetaError) return new ApiError(error.status === 401 ? 409 : error.status, error.message);
  return error;
}
const meta = async <T>(work: () => Promise<T>) => { try { return await work(); } catch (error) { throw asApiError(error); } };

// ---------- the connection ----------

export type MetaPageChoice = { id: string; name: string; instagram: { id: string; username: string | null } | null };
export type MetaStatus = "missing" | "unchecked" | "choose" | "ok" | "action" | "invalid";
export type MetaView = {
  appId: string | null; appSecretStored: boolean; userTokenStored: boolean; keysUnreadable: boolean;
  page: { id: string; name: string } | null; instagram: { id: string; username: string | null } | null; pages: MetaPageChoice[];
  status: MetaStatus; statusMessage: string | null; missingScopes: string[]; scopes: string[];
  userTokenExpiresAt: string | null; dataAccessExpiresAt: string | null; checkedAt: string | null;
  publishingApproved: boolean; publishingApprovedAt: string | null;
  /** Whether Instagram can fetch the pictures from this server (a public https address, or the local stand-in). */
  instagramReachable: boolean;
  graphVersion: string;
};

const choicesOf = (value: Prisma.JsonValue | null | undefined): MetaPageChoice[] => (Array.isArray(value) ? value : []).flatMap((item) => {
  const entry = item as { id?: unknown; name?: unknown; instagram?: { id?: unknown; username?: unknown } | null };
  if (typeof entry?.id !== "string") return [];
  return [{ id: entry.id, name: typeof entry.name === "string" ? entry.name : entry.id, instagram: entry.instagram && typeof entry.instagram.id === "string" ? { id: entry.instagram.id, username: typeof entry.instagram.username === "string" ? entry.instagram.username : null } : null }];
});

/** Whether Instagram can reach this server's picture addresses. */
export function instagramReachable(appUrl = env.APP_URL) {
  if (graphIsLocal()) return true;
  try {
    const url = new URL(appUrl);
    return url.protocol === "https:" && !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(url.hostname) && url.hostname.includes(".");
  } catch { return false; }
}

export async function metaView(organizationId: string): Promise<MetaView> {
  const found = await row(organizationId);
  const [secret, user, page] = found ? await Promise.all([openKey(organizationId, KEY.secret, found.appSecretCipher), openKey(organizationId, KEY.user, found.userTokenCipher), openKey(organizationId, KEY.page, found.pageTokenCipher)]) : [null, null, null];
  const unreadable = Boolean(found && ((found.appSecretCipher && !secret) || (found.userTokenCipher && !user) || (found.pageTokenCipher && !page)));
  const status: MetaStatus = !found || !found.appId || !found.appSecretCipher || !found.userTokenCipher ? "missing" : unreadable ? "invalid" : (found.status as MetaStatus);
  return {
    appId: found?.appId ?? null, appSecretStored: Boolean(found?.appSecretCipher), userTokenStored: Boolean(found?.userTokenCipher), keysUnreadable: unreadable,
    page: found?.pageId ? { id: found.pageId, name: found.pageName ?? found.pageId } : null,
    instagram: found?.instagramId ? { id: found.instagramId, username: found.instagramUsername } : null,
    pages: choicesOf(found?.pages),
    status, statusMessage: unreadable ? "Nycklarna kan inte läsas längre. Klistra in appens hemlighet och en ny token igen." : found?.statusMessage ?? null,
    missingScopes: found ? missingScopes(found.scopes) : [], scopes: found?.scopes ?? [],
    userTokenExpiresAt: found?.userTokenExpiresAt?.toISOString() ?? null, dataAccessExpiresAt: found?.dataAccessExpiresAt?.toISOString() ?? null, checkedAt: found?.checkedAt?.toISOString() ?? null,
    publishingApproved: Boolean(found?.publishingApproved), publishingApprovedAt: found?.publishingApprovedAt?.toISOString() ?? null,
    instagramReachable: instagramReachable(), graphVersion: GRAPH_VERSION,
  };
}

/** The status from Meta's answer about the token: ok, action (permissions missing, data access soon out) or invalid. Pure. */
export function statusFromToken(info: TokenInfo, now = Date.now()): { status: MetaStatus; message: string | null } {
  if (!info.valid) return { status: "invalid", message: "Token gäller inte längre. Hämta en ny token i Graph API Explorer och klistra in den här." };
  const missing = missingScopes(info.scopes);
  if (missing.length) {
    const onlyInstagram = missing.every((scope) => (INSTAGRAM_SCOPES as readonly string[]).includes(scope));
    return { status: "action", message: `Token saknar behörighet: ${missing.join(", ")}.${onlyInstagram ? " Facebook fungerar, men inte Instagram." : ""} Hämta en ny token med alla sex.` };
  }
  if (info.expiresAt && info.expiresAt.getTime() <= now) return { status: "invalid", message: "Token har gått ut. Hämta en ny token i Graph API Explorer och klistra in den här." };
  if (info.dataAccessExpiresAt && info.dataAccessExpiresAt.getTime() - now < SOON_MS) return { status: "action", message: "Metas dataåtkomst går ut inom en vecka. Hämta en ny token i Graph API Explorer och klistra in den här." };
  if (info.expiresAt && info.expiresAt.getTime() - now < SOON_MS) return { status: "action", message: "Token går ut inom en vecka. Hämta en ny token i Graph API Explorer och klistra in den här." };
  return { status: "ok", message: null };
}

const APP_ID = /^\d{5,20}$/;
const APP_SECRET = /^[A-Za-z0-9]{16,64}$/;
const TOKEN = /^[A-Za-z0-9_\-|.]{20,1000}$/;

async function app(organizationId: string, found: Row | null, given?: { appId?: string; appSecret?: string }) {
  const appId = given?.appId ?? found?.appId ?? null;
  const appSecret = given?.appSecret ?? await openKey(organizationId, KEY.secret, found?.appSecretCipher ?? null);
  if (!appId || !appSecret) throw new ApiError(400, "Fyll i appens id och appens hemlighet först.");
  return { appId, appSecret };
}

const pageChoice = (page: { id: string; name: string; instagram: MetaPageChoice["instagram"] }): MetaPageChoice => ({ id: page.id, name: page.name, instagram: page.instagram });

/**
 * Saves the app's id and secret and – with a user token from Graph API Explorer – connects: the token is exchanged for a long-lived
 * one, Meta says what it may do, and the pages it reaches are read. One page is chosen at once; several are offered.
 * `appSecret: null` removes the secret (and with it the connection's use).
 */
export async function saveMetaConnection(actor: Actor, input: { appId?: string; appSecret?: string | null; userToken?: string }) {
  const { organizationId } = actor;
  const found = await row(organizationId);
  const appId = input.appId?.trim();
  if (appId !== undefined && appId && !APP_ID.test(appId)) throw new ApiError(400, "Appens id är bara siffror. Kopiera det från appens sida hos Meta.");
  const appSecret = typeof input.appSecret === "string" ? input.appSecret.trim() : input.appSecret;
  if (appSecret && !APP_SECRET.test(appSecret)) throw new ApiError(400, "Appens hemlighet ser inte rätt ut. Kopiera den från Appinställningar → Grundläggande.");
  const userToken = input.userToken?.trim();
  if (userToken !== undefined && !TOKEN.test(userToken)) throw new ApiError(400, "Token ser inte rätt ut. Kopiera hela token från Graph API Explorer.");

  const data: Prisma.MetaConnectionUncheckedUpdateInput = { updatedById: actor.userId };
  const changes: string[] = [];
  if (appId !== undefined && appId !== (found?.appId ?? "")) { data.appId = appId || null; changes.push("appens id"); }
  if (appSecret === null) { data.appSecretCipher = null; data.status = "unchecked"; data.statusMessage = null; changes.push("appens hemlighet togs bort"); }
  else if (appSecret) { data.appSecretCipher = await sealCompanyKey(organizationId, KEY.secret, appSecret); changes.push("appens hemlighet byttes"); }

  if (userToken) {
    const keys = await app(organizationId, found, { appId: appId || undefined, appSecret: appSecret || undefined });
    const long = await meta(() => exchangeUserToken(transport(), keys, userToken));
    const info = await meta(() => debugToken(transport(), keys, long.token));
    if (!info.valid) throw new ApiError(400, "Meta godtar inte token. Hämta en ny token i Graph API Explorer.");
    if (info.appId && info.appId !== keys.appId) throw new ApiError(400, "Token hör till en annan app än appens id ovan.");
    const pages = await meta(() => listPages(transport(), long.token));
    const status = statusFromToken({ ...info, expiresAt: info.expiresAt ?? long.expiresAt });
    Object.assign(data, {
      userTokenCipher: await sealCompanyKey(organizationId, KEY.user, long.token),
      userTokenExpiresAt: info.expiresAt ?? long.expiresAt, dataAccessExpiresAt: info.dataAccessExpiresAt, scopes: info.scopes, checkedAt: new Date(),
      pages: pages.map(pageChoice) as unknown as Prisma.InputJsonValue,
      pageId: null, pageName: null, pageTokenCipher: null, instagramId: null, instagramUsername: null,
      status: pages.length ? (pages.length > 1 ? "choose" : status.status) : "action",
      statusMessage: pages.length ? (pages.length > 1 ? "Välj vilken Facebooksida inläggen ska till." : status.message) : "Token når ingen Facebooksida. Välj sidan när du hämtar token i Graph API Explorer.",
    } satisfies Prisma.MetaConnectionUncheckedUpdateInput);
    // A new token is a new consent: publishing is switched off until the admin switches it on again.
    data.publishingApproved = false;
    changes.push("ny token");
    if (pages.length === 1) {
      const [page] = pages;
      Object.assign(data, { pageId: page.id, pageName: page.name, pageTokenCipher: await sealCompanyKey(organizationId, KEY.page, page.token), instagramId: page.instagram?.id ?? null, instagramUsername: page.instagram?.username ?? null });
    }
  }
  if (found) await prisma.metaConnection.update({ where: { id: found.id }, data });
  else await prisma.metaConnection.create({ data: { ...(data as Prisma.MetaConnectionUncheckedCreateInput), organizationId } });
  if (changes.length) await audit(actor, "meta_connection", `Kopplingen till Facebook och Instagram ändrades: ${changes.join(", ")}.`);
  return metaView(organizationId);
}

/** Chooses the page (and its Instagram account) among those the token reaches. */
export async function chooseMetaPage(actor: Actor, pageId: string) {
  const { organizationId } = actor;
  if (!isGraphId(pageId)) throw new ApiError(400, "Ogiltig sida.");
  const found = await row(organizationId);
  const userToken = await openKey(organizationId, KEY.user, found?.userTokenCipher ?? null);
  if (!found || !userToken) throw new ApiError(409, "Klistra in en token först.");
  const pages = await meta(() => listPages(transport(), userToken));
  const page = pages.find((item) => item.id === pageId);
  if (!page) throw new ApiError(404, "Sidan nås inte med den här token.");
  const status = statusFromToken({ valid: true, appId: null, userId: null, type: null, expiresAt: found.userTokenExpiresAt, dataAccessExpiresAt: found.dataAccessExpiresAt, scopes: found.scopes });
  await prisma.metaConnection.update({ where: { id: found.id }, data: {
    pageId: page.id, pageName: page.name, pageTokenCipher: await sealCompanyKey(organizationId, KEY.page, page.token),
    instagramId: page.instagram?.id ?? null, instagramUsername: page.instagram?.username ?? null, pages: pages.map(pageChoice) as unknown as Prisma.InputJsonValue,
    status: status.status, statusMessage: status.message, publishingApproved: found.pageId === page.id ? found.publishingApproved : false, updatedById: actor.userId,
  } });
  await audit(actor, "meta_connection", `Facebooksidan för inlägg valdes (id ${page.id}).`);
  return metaView(organizationId);
}

/** Marks the connection invalid after a token error (the card then says what to do). */
async function invalidate(organizationId: string, message: string) {
  await prisma.metaConnection.updateMany({ where: { organizationId }, data: { status: "invalid", statusMessage: message, checkedAt: new Date() } });
}

/**
 * Asks Meta about the page token (or the user token while no page is chosen) and updates the status. `ifOlderThan` makes it a
 * check on opening: only when the last one is older.
 */
export async function checkMeta(organizationId: string, options: { ifStale?: boolean } = {}): Promise<{ ok: boolean; message: string }> {
  const found = await row(organizationId);
  if (!found?.appId || !found.appSecretCipher || !found.userTokenCipher) return { ok: false, message: "Fyll i appens id, hemlighet och en token först." };
  if (options.ifStale && found.checkedAt && Date.now() - found.checkedAt.getTime() < CHECK_EVERY_MS) return { ok: found.status === "ok", message: found.statusMessage ?? "" };
  const secret = await openKey(organizationId, KEY.secret, found.appSecretCipher);
  const token = await openKey(organizationId, found.pageTokenCipher ? KEY.page : KEY.user, found.pageTokenCipher ?? found.userTokenCipher);
  if (!secret || !token) return { ok: false, message: "Nycklarna kan inte läsas längre. Klistra in dem igen." };
  try {
    const info = await debugToken(transport(), { appId: found.appId, appSecret: secret }, token);
    // A page token from a long-lived user token never expires by itself; the user token's day is still the one to watch.
    const result = statusFromToken({ ...info, expiresAt: info.expiresAt ?? found.userTokenExpiresAt });
    const status = found.pageId || result.status === "invalid" ? result.status : "choose";
    const message = status === "choose" ? "Välj vilken Facebooksida inläggen ska till." : result.message;
    await prisma.metaConnection.update({ where: { id: found.id }, data: { status, statusMessage: message, scopes: info.scopes, dataAccessExpiresAt: info.dataAccessExpiresAt ?? found.dataAccessExpiresAt, checkedAt: new Date() } });
    return { ok: status === "ok", message: message ?? "Kopplingen fungerar." };
  } catch (error) {
    if (error instanceof MetaError && error.kind === "token") { await invalidate(organizationId, error.message); return { ok: false, message: error.message }; }
    return { ok: false, message: error instanceof MetaError ? error.message : "Kopplingen kunde inte kontrolleras." };
  }
}

export async function removeMetaConnection(actor: Actor) {
  const removed = await prisma.metaConnection.deleteMany({ where: { organizationId: actor.organizationId } });
  if (removed.count) await audit(actor, "meta_connection", "Kopplingen till Facebook och Instagram togs bort. Inläggen i Workflow finns kvar.");
  return metaView(actor.organizationId);
}

/** Publicering på/av: the guard every post passes. On only with a chosen page and a token that works. */
export async function setMetaPublishing(actor: Actor, on: boolean) {
  const found = await row(actor.organizationId);
  if (!found) throw new ApiError(409, "Koppla Facebook och Instagram först.");
  if (on && (!found.pageId || !found.pageTokenCipher || found.status === "invalid" || found.status === "choose")) throw new ApiError(409, "Kopplingen måste fungera och en sida vara vald innan publicering kan slås på.");
  if (found.publishingApproved === on) return metaView(actor.organizationId);
  await prisma.metaConnection.update({ where: { id: found.id }, data: on
    ? { publishingApproved: true, publishingApprovedAt: new Date(), publishingApprovedById: actor.userId }
    : { publishingApproved: false } });
  await audit(actor, "meta_publishing", on ? "Publicering till Facebook och Instagram slogs på." : "Publicering till Facebook och Instagram stängdes av.");
  return metaView(actor.organizationId);
}

/** For the Kopplingar list: is something connected, and does it work. */
export async function metaStatusLine(organizationId: string) {
  const view = await metaView(organizationId);
  return { status: view.status, page: view.page?.name ?? null, instagram: view.instagram?.username ?? null, publishingApproved: view.publishingApproved, message: view.statusMessage };
}

// ---------- posts ----------

const postSelect = {
  id: true, source: true, sourceRef: true, status: true, heading: true, body: true, caption: true, hashtags: true, link: true, template: true, toFacebook: true, toInstagram: true, toLinkedIn: true, toNewsletter: true, newsletterMail: true,
  toStory: true, storyFacebookId: true, storyInstagramId: true, logoVariant: true, logoSize: true,
  backgroundSource: true, facebookPostId: true, instagramMediaId: true, linkedInPostId: true, publishedAt: true, lastError: true, testedAt: true, testResult: true, createdAt: true, updatedAt: true,
} satisfies Prisma.SocialPostSelect;
type PostRow = Prisma.SocialPostGetPayload<{ select: typeof postSelect }>;
const postOut = (post: PostRow) => ({
  ...post, publishedAt: post.publishedAt?.toISOString() ?? null, testedAt: post.testedAt?.toISOString() ?? null,
  createdAt: post.createdAt.toISOString(), updatedAt: post.updatedAt.toISOString(),
});
export type PostView = ReturnType<typeof postOut>;

export async function listPosts(organizationId: string) {
  const posts = await prisma.socialPost.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 100, select: postSelect });
  return posts.map(postOut);
}

async function postOf(organizationId: string, id: string) {
  const post = await prisma.socialPost.findFirst({ where: { id, organizationId }, select: postSelect });
  if (!post) throw new ApiError(404, "Inlägget finns inte.");
  return post;
}
export const getPost = async (organizationId: string, id: string) => postOut(await postOf(organizationId, id));

export type PostInput = Partial<PostText> & { template?: string; toFacebook?: boolean; toInstagram?: boolean; toLinkedIn?: boolean; toNewsletter?: boolean;
  /** Även som story (2026-11-13): also a story on the chosen Facebook page and/or Instagram account. */
  toStory?: boolean;
  /** Logga (2026-11-13): the logo's variant (auto, main, onDark, onLight, black) and size (small, medium, large). */
  logoVariant?: string; logoSize?: string;
  /** The newsletter's own fields (lib/mail/post-newsletter-mail.ts); null: everything follows the post again. */
  newsletterMail?: NewsletterMail | null };

function cleanInput(input: PostInput) {
  const data: Prisma.SocialPostUncheckedUpdateInput = {};
  if (input.heading !== undefined) data.heading = input.heading.slice(0, HEADING_MAX);
  if (input.body !== undefined) data.body = input.body.slice(0, BODY_MAX);
  if (input.caption !== undefined) data.caption = input.caption.slice(0, CAPTION_STORE_MAX);
  if (input.hashtags !== undefined) data.hashtags = normalizeHashtags(input.hashtags);
  if (input.link !== undefined) {
    const link = input.link?.trim() || null;
    if (link && (!safeLink(link) || link.length > LINK_MAX)) throw new ApiError(400, "Länken ska börja med https://.");
    data.link = link;
  }
  if (input.template !== undefined) { if (!isTemplate(input.template)) throw new ApiError(400, "Okänd mall."); data.template = input.template; }
  if (input.toFacebook !== undefined) data.toFacebook = input.toFacebook;
  if (input.toInstagram !== undefined) data.toInstagram = input.toInstagram;
  if (input.toLinkedIn !== undefined) data.toLinkedIn = input.toLinkedIn;
  if (input.toNewsletter !== undefined) data.toNewsletter = input.toNewsletter;
  if (input.toStory !== undefined) data.toStory = input.toStory;
  if (input.logoVariant !== undefined) { if (!isLogoVariant(input.logoVariant)) throw new ApiError(400, "Okänd logga."); data.logoVariant = input.logoVariant; }
  if (input.logoSize !== undefined) { if (!isLogoSize(input.logoSize)) throw new ApiError(400, "Okänd storlek på loggan."); data.logoSize = input.logoSize; }
  if (input.newsletterMail !== undefined) {
    if (input.newsletterMail === null) data.newsletterMail = Prisma.DbNull;
    else {
      const parsed = newsletterMailSchema.safeParse(input.newsletterMail);
      if (!parsed.success) throw new ApiError(400, "Nyhetsbrevets fält är för långa.");
      const link = parsed.data.link?.trim();
      if (link && !safeLink(link)) throw new ApiError(400, "Nyhetsbrevets länk ska börja med https://.");
      data.newsletterMail = parsed.data as Prisma.InputJsonValue;
    }
  }
  return data;
}

/** Även som nyhetsbrev (2026-11-12): only a person with Utskick may tick it (lib/mail/post-newsletter.ts); anyone may untick it. */
async function checkNewsletterTick(actor: Actor, input: PostInput) {
  if (input.toNewsletter !== true && (input.newsletterMail === undefined || input.newsletterMail === null)) return;
  const { requireNewsletterRight } = await import("@/lib/mail/post-newsletter");
  await requireNewsletterRight(actor.userId);
}

export async function createPost(actor: Actor, input: PostInput) {
  await checkNewsletterTick(actor, input);
  const data = cleanInput({ heading: "", body: "", caption: "", ...input });
  const post = await prisma.socialPost.create({ data: { ...(data as Prisma.SocialPostUncheckedCreateInput), organizationId: actor.organizationId, source: "manual", createdById: actor.userId, updatedById: actor.userId }, select: postSelect });
  await audit(actor, "meta_post", `Skapade ett utkast till inlägg (id ${post.id}).`);
  return postOut(post);
}

export async function updatePost(actor: Actor, id: string, input: PostInput) {
  const post = await postOf(actor.organizationId, id);
  if (post.status === "published" || post.status === "publishing") throw new ApiError(409, "Ett publicerat inlägg kan inte ändras. Gör ett nytt.");
  await checkNewsletterTick(actor, input);
  const updated = await prisma.socialPost.update({ where: { id: post.id, organizationId: actor.organizationId }, data: { ...cleanInput(input), updatedById: actor.userId }, select: postSelect });
  await scheduleChanged(actor.organizationId, post.id);
  return postOut(updated);
}

/** Removes the post from Workflow (never from Facebook or Instagram). */
export async function deletePost(actor: Actor, id: string) {
  const post = await postOf(actor.organizationId, id);
  if (post.status === "publishing") throw new ApiError(409, "Inlägget publiceras just nu.");
  await prisma.socialPost.deleteMany({ where: { id: post.id, organizationId: actor.organizationId } });
  await scheduleChanged(actor.organizationId, post.id, true);
  await audit(actor, "meta_post", `Tog bort inlägget (id ${post.id}) från Workflow.`);
  return { ok: true };
}

/**
 * A draft made by Workflow itself (a published website page, a new version): never published, at most one per source and
 * reference. Null when it already exists.
 */
export async function createSystemDraft(organizationId: string, source: "website" | "release", sourceRef: string, text: PostText, createdById: string | null = null) {
  const ref = sourceRef.slice(0, 200);
  if (await prisma.socialPost.findFirst({ where: { organizationId, source, sourceRef: ref }, select: { id: true } })) return null;
  try {
    const post = await prisma.socialPost.create({ data: { ...(cleanInput(text) as Prisma.SocialPostUncheckedCreateInput), organizationId, source, sourceRef: ref, createdById, updatedById: createdById }, select: postSelect });
    return postOut(post);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
}

/** Dela även på Facebook och Instagram: a draft of the page that was just published (Min webbsida). */
export async function draftFromWebsite(actor: Actor, page: { id: number; title: string; modified: string; link: string | null; markup: string },
  /** The admin's choice in the checklist (2026-11-10): the texts from the ticked blocks and a picture of the page as background. */
  choice?: { heading: string; body: string; caption: string; background?: string | null }) {
  const link = page.link && safeLink(page.link) ? page.link : null;
  const text = choice ? { heading: choice.heading, body: choice.body, caption: choice.caption, link } : draftFromWebsitePage({ title: page.title, markup: page.markup, link: page.link });
  const post = await createSystemDraft(actor.organizationId, "website", `${page.id}:${page.modified}`, text, actor.userId);
  if (!post) return null;
  await audit(actor, "meta_post", `Skapade ett utkast till inlägg av webbplatsens sida (id ${page.id}).`);
  // The background is a nicety: a picture that cannot be fetched leaves the template's own colour.
  if (choice?.background) return (await setPostBackground(actor, post.id, { url: choice.background }).catch(() => null)) ?? post;
  return post;
}

/**
 * A background picture for the post (Inlägg, 2026-11-10): a picture of the company's site or of a page (fetched by the server under
 * Min webbsida's rules, never by the browser) or an upload, stored as one 1080 × 1350 JPEG (4:5) with the post. null removes it.
 */
export async function setPostBackground(actor: Actor, id: string, source: { url: string } | { bytes: Uint8Array; type: string } | null) {
  const post = await postOf(actor.organizationId, id);
  if (post.status === "published" || post.status === "publishing") throw new ApiError(409, "Ett publicerat inlägg kan inte ändras. Gör ett nytt.");
  let data: { background: Uint8Array<ArrayBuffer> | null; backgroundSource: string | null } = { background: null, backgroundSource: null };
  if (source) {
    let bytes: Uint8Array;
    let label: string;
    if ("url" in source) {
      const { fetchImageForPost } = await import("@/lib/website/server");
      bytes = new Uint8Array((await fetchImageForPost(actor.organizationId, source.url)).bytes);
      label = source.url.slice(0, 500);
    } else {
      const { imageSignature, MEDIA_TYPES } = await import("@/lib/website/wp-client");
      if (!MEDIA_TYPES[source.type] || !imageSignature(source.bytes, source.type)) throw new ApiError(400, "Bara PNG, JPEG, WebP och GIF kan användas.");
      bytes = source.bytes;
      label = "uppladdad";
    }
    const normal = await sharp(Buffer.from(bytes), { limitInputPixels: 60_000_000 }).rotate().resize(IMAGE_WIDTH, IMAGE_HEIGHT, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer().catch(() => { throw new ApiError(400, "Bilden kunde inte läsas."); });
    data = { background: new Uint8Array(normal), backgroundSource: label };
  }
  const updated = await prisma.socialPost.update({ where: { id: post.id, organizationId: actor.organizationId }, data: { ...data, updatedById: actor.userId }, select: postSelect });
  await scheduleChanged(actor.organizationId, post.id);
  await audit(actor, "meta_post", source ? `Valde en bakgrundsbild till inlägget (id ${post.id}).` : `Tog bort bakgrundsbilden från inlägget (id ${post.id}).`);
  return postOut(updated);
}

const backgroundOf = async (organizationId: string, id: string) =>
  (await prisma.socialPost.findFirst({ where: { id, organizationId }, select: { background: true } }))?.background ?? null;

// ---------- the picture ----------

/** Which of the company's logos exist (Logga, 2026-11-13): the editor marks a missing variant. */
export async function logoAvailability(organizationId: string) {
  const settings = await prisma.workspaceSettings.findUnique({ where: { organizationId }, select: { logoPath: true, logoOnDarkPath: true, logoOnLightPath: true, logoBlackPath: true } });
  return { main: Boolean(settings?.logoPath), onDark: Boolean(settings?.logoOnDarkPath), onLight: Boolean(settings?.logoOnLightPath), black: Boolean(settings?.logoBlackPath) };
}

async function brandOf(organizationId: string): Promise<PostBrand> {
  const [settings, organization] = await Promise.all([
    prisma.workspaceSettings.findUnique({ where: { organizationId }, select: { companyName: true, logoPath: true, logoOnDarkPath: true, logoOnLightPath: true, logoBlackPath: true, themePrimary: true, reportPrimary: true } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
  ]);
  // The company's own files only (its settings row); one that cannot be read counts as missing.
  const file = (key: string | null | undefined) => (key ? read(key).then((bytes) => new Uint8Array(bytes)).catch(() => null) : Promise.resolve(null));
  const [logo, onDark, onLight, black] = await Promise.all([file(settings?.logoPath), file(settings?.logoOnDarkPath), file(settings?.logoOnLightPath), file(settings?.logoBlackPath)]);
  return { primary: brandColour(settings?.themePrimary, brandColour(settings?.reportPrimary)), companyName: settings?.companyName || organization?.name || "", logo, logos: { onDark, onLight, black } };
}

/** The picture; `postId` adds that post's background (the company's own post only); `format` story is the 9:16 story picture. */
export async function renderImage(organizationId: string, input: PostImageInput, postId?: string | null, format: PostFormat = "feed") {
  const [brand, fonts, background] = await Promise.all([brandOf(organizationId), workflowReportFont(), postId ? backgroundOf(organizationId, postId) : null]);
  return renderPostImage(input, brand, fonts, background, format);
}

export async function postImage(organizationId: string, id: string, format: PostFormat = "feed") {
  const post = await postOf(organizationId, id);
  return renderImage(organizationId, post, post.id, format);
}

const keyHash = (key: string) => createHash("sha256").update(key).digest("hex");
const IMAGE_KEY = /^[A-Za-z0-9_-]{43}$/;

/**
 * The picture behind a post's short-lived public address (Instagram fetches it), or null. No session; nothing else is shown.
 * Each picture has its own key (2026-11-13): the post's (4:5) and the story's (9:16), so both containers can exist at once.
 */
export async function publicPostImage(key: string) {
  if (!IMAGE_KEY.test(key)) return null;
  const hash = keyHash(key);
  const post = await prisma.socialPost.findFirst({ where: { OR: [{ imageKeyHash: hash }, { storyImageKeyHash: hash }] }, select: { id: true, organizationId: true, heading: true, body: true, template: true, logoVariant: true, logoSize: true, imageKeyHash: true, imageKeyExpiresAt: true, storyImageKeyExpiresAt: true } });
  if (!post) return null;
  const story = post.imageKeyHash !== hash;
  const expires = story ? post.storyImageKeyExpiresAt : post.imageKeyExpiresAt;
  if (!expires || expires.getTime() < Date.now()) return null;
  return renderImage(post.organizationId, post, post.id, story ? "story" : "feed");
}

async function issueImageAddress(organizationId: string, postId: string, format: PostFormat = "feed") {
  const key = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + IMAGE_KEY_MS);
  await prisma.socialPost.update({ where: { id: postId, organizationId }, data: format === "story" ? { storyImageKeyHash: keyHash(key), storyImageKeyExpiresAt: expires } : { imageKeyHash: keyHash(key), imageKeyExpiresAt: expires } });
  return `${new URL(env.APP_URL).origin}/api/meta/image/${key}`;
}
const dropImageAddress = (organizationId: string, postId: string, format: PostFormat = "feed") => prisma.socialPost.updateMany({ where: { id: postId, organizationId },
  data: format === "story" ? { storyImageKeyHash: null, storyImageKeyExpiresAt: null } : { imageKeyHash: null, imageKeyExpiresAt: null } });

// ---------- publishing ----------

type Outcome = { ok: boolean; id?: string | null; message: string };
export type PublishResult = { post: PostView; facebook: Outcome | null; instagram: Outcome | null;
  /** Även som story (2026-11-13): the stories, each reported (and retried) on its own. */
  facebookStory: Outcome | null; instagramStory: Outcome | null;
  linkedin: Outcome | null; newsletter: Outcome | null; message: string };

const outcomeOf = (error: unknown): Outcome => ({ ok: false, message: error instanceof MetaError ? error.message : error instanceof ApiError ? error.message : "Något gick fel." });
/** The channels' names in the order they are published (the stories are channels of their own, 2026-11-13). */
const CHANNEL_NAME = { facebook: "Facebook", instagram: "Instagram", facebookStory: "Facebook (story)", instagramStory: "Instagram (story)", linkedin: "LinkedIn" } as const;
type ChannelKey = keyof typeof CHANNEL_NAME;
const CHANNEL_KEYS = Object.keys(CHANNEL_NAME) as ChannelKey[];
/** "Facebook: …" per channel that was tried; `failedOnly`: only those that failed (the post's lastError). */
const outcomeLines = (outcomes: Record<ChannelKey, Outcome | null>, failedOnly = false) =>
  CHANNEL_KEYS.flatMap((key) => {
    const outcome = outcomes[key];
    return outcome && (!failedOnly || !outcome.ok) ? [`${CHANNEL_NAME[key]}: ${outcome.message}`] : [];
  });
/** "A", "A och B", "A, B och C". */
const listed = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} och ${names[names.length - 1]}` : names[0] ?? "");

/**
 * Publicera (`live`) or Testpublicering (`test`), always an admin's press and only when publishing is switched on for the
 * company – for Facebook and Instagram under their connection, for LinkedIn (2026-11-11) under its own. A test posts a picture to
 * the page that nobody sees and removes it again, makes Instagram fetch and check the picture without publishing it and uploads
 * the picture to LinkedIn without a post – so the whole way is tried while nothing becomes public. A live post is claimed first
 * (draft → publishing), so two presses never post twice; a post where one channel failed is retried for that one only.
 *
 * Även som story (2026-11-13): with toStory, the post's picture in 9:16 also becomes a story on the chosen Facebook page and/or
 * Instagram account, after the feed posts – Instagram a STORIES container from the story picture's own address, Facebook an
 * unpublished upload made the page's story (photo_stories). Each story is a channel of its own: its id is kept, a failed one makes
 * the post "partial" and is retried alone. A test checks the story picture the same way as the post's, and publishes nothing.
 * A story has no caption and no link (Meta's API cannot add link stickers).
 */
export async function publishPost(actor: Actor, id: string, mode: "test" | "live", options: { newsletter?: boolean } = {}): Promise<PublishResult> {
  const { organizationId } = actor;
  const connection = await row(organizationId);
  const { linkedInPublishBlock, linkedInPublishingOn, publishToLinkedIn } = await import("@/lib/linkedin/server");
  // Nothing is looked at before the company has switched publishing on somewhere.
  if (!connection?.publishingApproved && !(await linkedInPublishingOn(organizationId))) throw new ApiError(403, "Publicering är avstängd. Slå på den under Kopplingar → Webb och sociala medier.");
  const post = await postOf(organizationId, id);
  const usesMeta = post.toFacebook || post.toInstagram;
  if (usesMeta && !connection?.publishingApproved) throw new ApiError(403, "Publicering till Facebook och Instagram är avstängd. Slå på den under Kopplingar → Webb och sociala medier, eller välj bort Facebook och Instagram.");
  const pageToken = usesMeta ? await openKey(organizationId, KEY.page, connection!.pageTokenCipher) : null;
  if (usesMeta && (!connection!.pageId || !pageToken)) throw new ApiError(409, "Välj en Facebooksida under Kopplingar först.");
  if (usesMeta && connection!.status === "invalid") throw new ApiError(409, connection!.statusMessage ?? "Kopplingen fungerar inte. Hämta en ny token.");
  if (post.toLinkedIn) { const block = await linkedInPublishBlock(organizationId); if (block) throw new ApiError(block.status, block.message); }
  const problem = postProblem(post);
  if (problem) throw new ApiError(400, problem);
  // Även som nyhetsbrev: Publicera by someone without Utskick is refused before anything is posted (the schedule's own
  // publisher sends the newsletter there, lib/schedule/channels.ts, so it passes newsletter: false).
  const withNewsletter = mode === "live" && post.toNewsletter && options.newsletter !== false;
  if (withNewsletter) { const { requireNewsletterRight } = await import("@/lib/mail/post-newsletter"); await requireNewsletterRight(actor.userId); }
  if (mode === "live" && (post.status === "published" || post.status === "publishing")) throw new ApiError(409, post.status === "published" ? "Inlägget är redan publicerat." : "Inlägget publiceras just nu.");
  const toFacebook = post.toFacebook && (mode === "test" || !post.facebookPostId);
  const toInstagram = post.toInstagram && (mode === "test" || !post.instagramMediaId);
  const toLinkedIn = post.toLinkedIn && (mode === "test" || !post.linkedInPostId);
  const toFacebookStory = post.toStory && post.toFacebook && (mode === "test" || !post.storyFacebookId);
  const toInstagramStory = post.toStory && post.toInstagram && (mode === "test" || !post.storyInstagramId);
  if ((toInstagram || toInstagramStory) && !connection!.instagramId) throw new ApiError(409, "Sidan har inget Instagramkonto kopplat. Ta bort Instagram från inlägget eller koppla kontot till sidan hos Meta.");
  if ((toInstagram || toInstagramStory) && !instagramReachable()) throw new ApiError(409, "Instagram hämtar bilden från Workflows adress, och den här servern nås inte från internet. Testa bara med Facebook här.");

  if (mode === "live") {
    const claimed = await prisma.socialPost.updateMany({ where: { id: post.id, organizationId, status: { in: ["draft", "failed", "partial"] } }, data: { status: "publishing", lastError: null } });
    if (!claimed.count) throw new ApiError(409, "Inlägget publiceras redan.");
  }
  let facebook: Outcome | null = null;
  let instagramOutcome: Outcome | null = null;
  let facebookStory: Outcome | null = null;
  let instagramStory: Outcome | null = null;
  let linkedin: Outcome | null = null;
  let tokenBroken: MetaError | null = null;
  const catchMeta = (error: unknown) => { if (error instanceof MetaError && error.kind === "token") tokenBroken = error; return outcomeOf(error); };
  try {
    const bytes = await renderImage(organizationId, post, post.id);
    if (toFacebook) {
      const page = { id: connection!.pageId!, token: pageToken! };
      try {
        const photo = await facebookPhoto(transport(), page, { bytes, caption: facebookCaption(post), published: mode === "live" });
        if (mode === "test") { await deleteObject(transport(), photo.photoId, page.token).catch(() => undefined); facebook = { ok: true, message: "Facebook tog emot bilden (som inte visades och togs bort igen)." }; }
        else facebook = { ok: true, id: photo.postId ?? photo.photoId, message: "Publicerat på Facebook." };
      } catch (error) { facebook = catchMeta(error); }
    }
    if (toInstagram && !tokenBroken) {
      const account = { id: connection!.instagramId!, token: pageToken! };
      try {
        const publisher = instagram();
        if (mode === "live") {
          const remaining = await publisher.remainingToday(account);
          if (remaining === 0) throw new MetaError("Instagram tillåter inte fler inlägg från kontot i dag. Försök igen i morgon.", "rate", 429);
        }
        const imageUrl = await issueImageAddress(organizationId, post.id);
        try {
          const container = await publisher.createContainer(account, { imageUrl, caption: instagramCaption(post) });
          await waitForContainer(publisher, account, container, metaTiming);
          instagramOutcome = mode === "live"
            ? { ok: true, id: await publisher.publish(account, container), message: "Publicerat på Instagram." }
            : { ok: true, message: "Instagram hämtade och godkände bilden (inget publicerades)." };
        } finally { await dropImageAddress(organizationId, post.id).catch(() => undefined); }
      } catch (error) { instagramOutcome = catchMeta(error); }
    } else if (toInstagram) instagramOutcome = { ok: false, message: "Inte försökt: token gäller inte längre." };
    if (toFacebookStory || toInstagramStory) {
      const storyBytes = await renderImage(organizationId, post, post.id, "story");
      if (toFacebookStory && !tokenBroken) {
        const page = { id: connection!.pageId!, token: pageToken! };
        try {
          // Its own upload, never shown as a post: Meta refuses a picture already used in a published post.
          const photo = await facebookPhoto(transport(), page, { bytes: storyBytes, caption: "", published: false });
          if (mode === "test") { await deleteObject(transport(), photo.photoId, page.token).catch(() => undefined); facebookStory = { ok: true, message: "Facebook tog emot storybilden (som inte visades och togs bort igen)." }; }
          else facebookStory = { ok: true, id: await facebookPhotoStory(transport(), page, photo.photoId), message: "Publicerad som story på Facebook." };
        } catch (error) { facebookStory = catchMeta(error); }
      } else if (toFacebookStory) facebookStory = { ok: false, message: "Inte försökt: token gäller inte längre." };
      if (toInstagramStory && !tokenBroken) {
        const account = { id: connection!.instagramId!, token: pageToken! };
        try {
          const publisher = instagram();
          if (mode === "live") {
            const remaining = await publisher.remainingToday(account);
            if (remaining === 0) throw new MetaError("Instagram tillåter inte fler inlägg från kontot i dag. Försök igen i morgon.", "rate", 429);
          }
          const imageUrl = await issueImageAddress(organizationId, post.id, "story");
          try {
            const container = await publisher.createContainer(account, { imageUrl, caption: "", story: true });
            await waitForContainer(publisher, account, container, metaTiming);
            instagramStory = mode === "live"
              ? { ok: true, id: await publisher.publish(account, container), message: "Publicerad som story på Instagram." }
              : { ok: true, message: "Instagram hämtade och godkände storybilden (inget publicerades)." };
          } finally { await dropImageAddress(organizationId, post.id, "story").catch(() => undefined); }
        } catch (error) { instagramStory = catchMeta(error); }
      } else if (toInstagramStory) instagramStory = { ok: false, message: "Inte försökt: token gäller inte längre." };
    }
    if (toLinkedIn) linkedin = await publishToLinkedIn(organizationId, { commentary: linkedInCommentary(post), image: new Uint8Array(bytes), altText: [post.heading, post.body].filter((part) => part.trim()).join(". ") }, mode);
  } finally {
    if (tokenBroken) await invalidate(organizationId, (tokenBroken as MetaError).message);
    if (mode === "live") {
      const fbId = facebook?.ok ? facebook.id ?? null : post.facebookPostId;
      const igId = instagramOutcome?.ok ? instagramOutcome.id ?? null : post.instagramMediaId;
      const liId = linkedin?.ok ? linkedin.id ?? null : post.linkedInPostId;
      const fbStoryId = facebookStory?.ok ? facebookStory.id ?? null : post.storyFacebookId;
      const igStoryId = instagramStory?.ok ? instagramStory.id ?? null : post.storyInstagramId;
      const storiesDone = !post.toStory || ((!post.toFacebook || fbStoryId) && (!post.toInstagram || igStoryId));
      const done = (!post.toFacebook || fbId) && (!post.toInstagram || igId) && (!post.toLinkedIn || liId) && storiesDone;
      const any = fbId || igId || liId || fbStoryId || igStoryId;
      const errors = outcomeLines({ facebook, instagram: instagramOutcome, facebookStory, instagramStory, linkedin }, true).join(" ");
      await prisma.socialPost.updateMany({ where: { id: post.id, organizationId }, data: {
        status: done ? "published" : any ? "partial" : (facebook || instagramOutcome || facebookStory || instagramStory || linkedin) ? "failed" : "draft",
        facebookPostId: fbId, instagramMediaId: igId, linkedInPostId: liId, storyFacebookId: fbStoryId, storyInstagramId: igStoryId, lastError: errors || null,
        ...(done ? { publishedAt: new Date(), publishedById: actor.userId } : {}),
      } });
    }
  }
  // The newsletter goes on its own, whatever the channels did, and is reported beside them; at most once per post.
  let newsletter: Outcome | null = null;
  if (withNewsletter) {
    const { sendPostAsNewsletter } = await import("@/lib/mail/post-newsletter");
    newsletter = await sendPostAsNewsletter(actor, post, () => renderImage(organizationId, post, post.id)).catch(() => ({ ok: false, message: "Nyhetsbrevet kunde inte köas. Försök igen." }));
    await audit(actor, "meta_newsletter", `Inlägget (id ${post.id}) som nyhetsbrev: ${newsletter.ok ? "köat eller redan skickat" : "inte skickat"}.`);
  }
  const outcomes = { facebook, instagram: instagramOutcome, facebookStory, instagramStory, linkedin };
  const where = listed(CHANNEL_KEYS.filter((key) => outcomes[key]).map((key) => CHANNEL_NAME[key]));
  const okAll = Object.values(outcomes).every((outcome) => !outcome || outcome.ok);
  const message = mode === "test"
    ? (okAll ? `Testpubliceringen gick bra (${where}). Inget syns för andra.` : "Testpubliceringen gick inte hela vägen. Se vad som hände nedan.")
    : (okAll ? `Inlägget är publicerat på ${where}.` : "Inlägget kunde inte publiceras överallt. Se vad som hände nedan.") + (newsletter ? ` ${newsletter.message}` : "");
  if (mode === "test") await prisma.socialPost.updateMany({ where: { id: post.id, organizationId }, data: { testedAt: new Date(), testResult: outcomeLines(outcomes).join(" ").slice(0, 500) } });
  await audit(actor, mode === "live" ? "meta_publish" : "meta_test", `${mode === "live" ? "Publicerade" : "Testpublicerade"} inlägget (id ${post.id}) till ${where || "ingenstans"}: ${okAll ? "klart" : "delvis eller inte"}.`);
  if (linkedin) await audit(actor, mode === "live" ? "linkedin_publish" : "linkedin_test", `${mode === "live" ? "Publicerade" : "Testpublicerade"} inlägget (id ${post.id}) till LinkedIn: ${linkedin.ok ? "klart" : "inte"}.`);
  return { post: await getPost(organizationId, post.id), facebook, instagram: instagramOutcome, facebookStory, instagramStory, linkedin, newsletter, message };
}

/** For the tests: the hash a key is stored as. */
export const imageKeyHashForTests = keyHash;
