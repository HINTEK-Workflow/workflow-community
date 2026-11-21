import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { absoluteUrl, env } from "@/lib/env";
import { canAccessTest } from "@/lib/auth/access";
import { openCompanyKey, sealCompanyKey } from "@/lib/integrations/company-keys";
import { ApiError } from "@/lib/kfid/errors";
import { formatSwedish } from "@/lib/swedish-time";
import { moduleOnWhere } from "@/lib/workflow/modules";
import { addToPlaylist, deleteVideo, keptPrivate, setThumbnail, updateVideo as updateOnYouTube, YouTubeError, type VideoMetadata } from "./api";
import {
  PRIVACY_KEYS, publishProblem, textsProblem, youtubeWatchUrl, type VideoListStatus, type VideoPrivacy, type VideoStatus, type VideoView,
} from "./model";
import { readThumbnail, readVideoPiece, removeStored, storedVideoSize, storeThumbnail, storeVideoChunk, VideoStoreError } from "./storage";
import { MAX_UPLOAD_ATTEMPTS, nextUploadAttempt, runUpload } from "./upload";
import { markPrivateLocked, youTubeAccessToken, youTubeChannelId, youTubePublishBlock, youTubeTokenFailed, youTubeTransport } from "./server";

/**
 * Filmer (2026-11-20) on the server: the company's films, their files and cover pictures, Publicera and the upload to
 * YouTube, changes after publishing, and removing a film from YouTube or from Workflow. Every function takes the company the API
 * checked, and every row read or written is that company's.
 *
 * - The upload to YouTube runs on the server, never in the browser: Publicera checks everything at once, then the upload goes on
 *   by itself in this server process; the job schedule:publish (every five minutes) picks up a film whose upload stopped (a
 *   restarted server, a lost connection) and the films that were scheduled. A lock on the row (ten minutes, renewed after each
 *   piece) makes sure only one run sends a film.
 * - The upload runs as the admin who pressed Publicera or Schemalägg; it stops if that person is no longer an active admin, the
 *   module is off or publishing to YouTube is switched off.
 * - A failure is shown on the film with its reason and mailed once to the company's admins.
 * - The audit never holds a film's text.
 */
export type Actor = { userId: string; organizationId: string };

const LOCK_MS = 10 * 60_000;
/** Publicera in the page: the server process goes on until the film is up (hours for a large film on a slow line). */
const PRESS_BUDGET_MS = 6 * 60 * 60_000;
/** The job's run: a little under its five minutes, so two runs never overlap. */
export const JOB_BUDGET_MS = 4 * 60_000;
const SESSION_KEY = "youtube-upload-session";

async function audit(actor: Actor, action: string, detail: string) {
  await prisma.administrationEvent.create({ data: { actorId: actor.userId, organizationId: actor.organizationId, action, detail: detail.slice(0, 500) } });
}

const maxBytes = () => env.YOUTUBE_VIDEO_MAX_MB * 1024 * 1024;
export const videoLimits = () => ({ maxBytes: maxBytes() });

const videoRow = (organizationId: string, id: string) => prisma.youTubeVideo.findFirst({ where: { id, organizationId } });
type Row = NonNullable<Awaited<ReturnType<typeof videoRow>>>;

async function rowOf(organizationId: string, id: string): Promise<Row> {
  const found = await videoRow(organizationId, id);
  if (!found) throw new ApiError(404, "Filmen finns inte.");
  return found;
}

const num = (value: bigint | number | null | undefined) => (value === null || value === undefined ? null : Number(value));
const running = (video: Pick<Row, "uploadLockedUntil">, now = Date.now()) => Boolean(video.uploadLockedUntil && video.uploadLockedUntil.getTime() > now);

/** The films that have an active scheduled item (Schemalagd in the list). */
async function scheduledIds(organizationId: string, ids?: string[]) {
  const items = await prisma.scheduledPublish.findMany({ where: { organizationId, kind: "video", status: { in: ["scheduled", "needs_approval", "running"] }, ...(ids ? { targetId: { in: ids } } : {}) }, select: { targetId: true } });
  return new Set(items.map((item) => item.targetId));
}

export function viewOf(video: Row, scheduled: boolean): VideoView {
  const listStatus: VideoListStatus = video.status === "draft" && scheduled ? "scheduled" : (video.status as VideoStatus);
  const total = num(video.fileSize) ?? 0;
  return {
    id: video.id, status: video.status as VideoStatus, listStatus,
    title: video.title, description: video.description, tags: video.tags, categoryId: video.categoryId,
    privacy: ((PRIVACY_KEYS as readonly string[]).includes(video.privacy) ? video.privacy : "private") as VideoPrivacy, madeForKids: video.madeForKids,
    playlistId: video.playlistId, playlistName: video.playlistName,
    file: { name: video.fileName, type: video.fileType, size: num(video.fileSize), received: num(video.fileReceived) ?? 0, ready: Boolean(video.fileKey), upload: video.fileUpload },
    thumbnail: video.thumbnailKey ? { source: video.thumbnailSource, version: video.thumbnailUpdatedAt?.toISOString() ?? null } : null,
    youtube: video.youtubeId ? { id: video.youtubeId, url: youtubeWatchUrl(video.youtubeId), privacy: video.youtubePrivacy, lockedPrivate: keptPrivate(video.privacy, video.youtubePrivacy) } : null,
    upload: video.status === "uploading" || video.status === "failed" || video.uploadError ? {
      sent: num(video.uploadOffset) ?? 0, total, attempts: video.uploadAttempts, nextAt: video.uploadNextAt?.toISOString() ?? null, error: video.uploadError,
      startedAt: video.uploadStartedAt?.toISOString() ?? null, running: running(video),
    } : null,
    thumbnailPending: video.thumbnailPending, playlistPending: video.playlistPending,
    publishedAt: video.publishedAt?.toISOString() ?? null, createdAt: video.createdAt.toISOString(), updatedAt: video.updatedAt.toISOString(),
  };
}

export async function listVideos(organizationId: string): Promise<VideoView[]> {
  const rows = await prisma.youTubeVideo.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 200 });
  const scheduled = await scheduledIds(organizationId, rows.map((video) => video.id));
  return rows.map((video) => viewOf(video, scheduled.has(video.id)));
}

export async function getVideoView(organizationId: string, id: string): Promise<VideoView> {
  const video = await rowOf(organizationId, id);
  return viewOf(video, (await scheduledIds(organizationId, [id])).has(id));
}

/** The published films one may link to from a post (Inlägg): not those YouTube keeps private. */
export async function linkableVideos(organizationId: string) {
  const rows = await prisma.youTubeVideo.findMany({ where: { organizationId, youtubeId: { not: null }, status: "published", NOT: { youtubePrivacy: "private" } }, orderBy: { publishedAt: "desc" }, take: 50, select: { id: true, title: true, youtubeId: true } });
  return rows.map((row) => ({ id: row.id, title: row.title || "Utan titel", url: youtubeWatchUrl(row.youtubeId!) }));
}

// ---------- the draft ----------

export async function createVideo(actor: Actor) {
  const video = await prisma.youTubeVideo.create({ data: { organizationId: actor.organizationId, createdById: actor.userId, updatedById: actor.userId } });
  await audit(actor, "youtube_video", `Skapade ett utkast till en film (id ${video.id}).`);
  return viewOf(video, false);
}

export type VideoFields = { title?: string; description?: string; tags?: string[]; categoryId?: string | null; privacy?: VideoPrivacy; madeForKids?: boolean | null; playlistId?: string | null };

const metaOf = (video: Pick<Row, "title" | "description" | "tags" | "categoryId" | "privacy" | "madeForKids">): VideoMetadata => ({
  title: video.title, description: video.description, tags: video.tags, categoryId: video.categoryId, privacy: video.privacy, madeForKids: video.madeForKids === true,
});

/**
 * Spara: the texts and choices. On a published film the change also goes to YouTube at once (title, description, tags, category,
 * who may see it and the children's answer; 50 units). A film that is being uploaded cannot be changed.
 */
export async function updateVideo(actor: Actor, id: string, fields: VideoFields) {
  const video = await rowOf(actor.organizationId, id);
  if (video.status === "uploading") throw new ApiError(409, "Filmen laddas upp just nu. Vänta tills den är klar.");
  const next = {
    title: fields.title !== undefined ? fields.title.trim() : video.title,
    description: fields.description ?? video.description,
    tags: fields.tags ?? video.tags,
    categoryId: fields.categoryId !== undefined ? fields.categoryId : video.categoryId,
    privacy: fields.privacy ?? video.privacy,
    madeForKids: fields.madeForKids !== undefined ? fields.madeForKids : video.madeForKids,
  };
  if (fields.title !== undefined || fields.description !== undefined || fields.tags !== undefined) {
    const problem = textsProblem({ ...next, title: next.title || "x" });
    if (problem) throw new ApiError(400, problem);
  }
  if (next.categoryId && !/^\d{1,4}$/.test(next.categoryId)) throw new ApiError(400, "Okänd kategori.");
  const playlist = fields.playlistId === undefined ? undefined : fields.playlistId ? await playlistOf(actor.organizationId, fields.playlistId) : null;
  const data: Prisma.YouTubeVideoUncheckedUpdateInput = { ...next, updatedById: actor.userId,
    ...(playlist !== undefined ? { playlistId: playlist?.id ?? null, playlistName: playlist?.name ?? null } : {}) };
  if (video.youtubeId && video.status === "published") {
    const problem = textsProblem(next);
    if (problem) throw new ApiError(400, problem);
    if (next.madeForKids === null) throw new ApiError(400, "Svara på om filmen är gjord för barn.");
    const token = await tokenFor(actor.organizationId);
    try {
      const answer = await updateOnYouTube(youTubeTransport(), token, video.youtubeId, metaOf({ ...next, madeForKids: next.madeForKids }));
      data.youtubePrivacy = answer.privacy ?? next.privacy;
      if (keptPrivate(next.privacy, answer.privacy)) await markPrivateLocked(actor.organizationId, true);
    } catch (error) { throw await apiErrorOf(actor.organizationId, error); }
    // A newly chosen playlist is added on YouTube too.
    if (playlist && playlist.id !== video.playlistId) data.playlistPending = true;
  }
  const updated = await prisma.youTubeVideo.update({ where: { id: video.id }, data });
  if (video.youtubeId && video.status === "published") {
    await audit(actor, "youtube_video_update", `Ändrade filmen på YouTube (id ${video.id}).`);
    if (updated.playlistPending) await finishSteps(updated).catch(() => undefined);
  }
  await videoChanged(actor.organizationId, video.id);
  return getVideoView(actor.organizationId, video.id);
}

async function playlistOf(organizationId: string, playlistId: string) {
  const connection = await prisma.youTubeConnection.findUnique({ where: { organizationId }, select: { playlists: true } });
  const playlists = (Array.isArray(connection?.playlists) ? connection.playlists : []) as { id?: string; name?: string }[];
  const found = playlists.find((item) => item?.id === playlistId);
  if (!found?.id) throw new ApiError(404, "Spellistan finns inte på kanalen. Tryck Kontrollera under Kopplingar för att läsa in spellistorna igen.");
  return { id: found.id, name: String(found.name ?? found.id) };
}

// ---------- the file and the cover picture ----------

/** One piece of the film from the browser (8 MB at a time). When the last is in, the file replaces any earlier one. */
export async function storeVideoPiece(actor: Actor, id: string, piece: { upload: string; offset: number; total: number; bytes: Uint8Array; name: string }) {
  const video = await rowOf(actor.organizationId, id);
  if (video.youtubeId || video.status === "uploading") throw new ApiError(409, video.youtubeId ? "Filmen finns redan på YouTube. Filmfilen kan inte bytas där; gör en ny film i stället." : "Filmen laddas upp just nu.");
  let result;
  try { result = await storeVideoChunk(actor.organizationId, { ...piece, maxBytes: maxBytes() }); }
  catch (error) {
    if (error instanceof VideoStoreError) throw new ApiError(error.status, error.message);
    throw error;
  }
  if (!result.done) {
    await prisma.youTubeVideo.updateMany({ where: { id: video.id, organizationId: actor.organizationId }, data: { fileUpload: result.upload, fileReceived: BigInt(result.received) } });
    return { done: false as const, upload: result.upload, received: result.received };
  }
  const old = video.fileKey;
  await prisma.youTubeVideo.update({ where: { id: video.id }, data: {
    fileKey: result.key, fileType: result.type, fileSize: BigInt(result.size), fileReceived: BigInt(result.size), fileUpload: null,
    fileName: piece.name.replace(/[\\/\u0000-\u001f]/g, "").slice(0, 200) || `film.${result.kind}`,
    status: video.status === "failed" ? "draft" : video.status, uploadSessionCipher: null, uploadOffset: BigInt(0), uploadAttempts: 0, uploadError: null, updatedById: actor.userId,
  } });
  if (old && old !== result.key) await removeStored(actor.organizationId, old).catch(() => undefined);
  await audit(actor, "youtube_video", `Laddade upp filmfilen till filmen (id ${video.id}, ${Math.round(result.size / 1024 / 1024)} MB).`);
  await videoChanged(actor.organizationId, video.id);
  return { done: true as const, video: await getVideoView(actor.organizationId, video.id) };
}

/** The cover picture: an uploaded picture or a frame of the film chosen in the browser. On a published film it goes to YouTube too. */
export async function setVideoThumbnail(actor: Actor, id: string, input: { bytes: Uint8Array; source: "own" | "frame" } | null) {
  const video = await rowOf(actor.organizationId, id);
  if (video.status === "uploading") throw new ApiError(409, "Filmen laddas upp just nu. Vänta tills den är klar.");
  let stored: { key: string } | null = null;
  if (input) {
    try { stored = await storeThumbnail(actor.organizationId, input.bytes); }
    catch (error) { if (error instanceof VideoStoreError) throw new ApiError(error.status, error.message); throw error; }
  }
  const published = Boolean(video.youtubeId && video.status === "published");
  const updated = await prisma.youTubeVideo.update({ where: { id: video.id }, data: {
    thumbnailKey: stored?.key ?? null, thumbnailSource: input?.source ?? null, thumbnailUpdatedAt: new Date(), thumbnailPending: published && Boolean(stored), updatedById: actor.userId,
  } });
  if (video.thumbnailKey && video.thumbnailKey !== stored?.key) await removeStored(actor.organizationId, video.thumbnailKey).catch(() => undefined);
  if (published && stored) {
    const outcome = await finishSteps(updated);
    if (outcome) throw new ApiError(409, `Omslagsbilden sparades i Workflow men inte på YouTube: ${outcome}`);
  }
  await videoChanged(actor.organizationId, video.id);
  return getVideoView(actor.organizationId, video.id);
}

/** The cover picture from our own server (the page never loads a picture from YouTube). */
export async function videoThumbnail(organizationId: string, id: string) {
  const video = await rowOf(organizationId, id);
  return video.thumbnailKey ? readThumbnail(organizationId, video.thumbnailKey) : null;
}

// ---------- Publicera and the upload ----------

async function tokenFor(organizationId: string) {
  try { return await youTubeAccessToken(organizationId); }
  catch (error) { throw await apiErrorOf(organizationId, error); }
}

/** A YouTube error as the API's answer; a token error also marks the connection invalid. */
async function apiErrorOf(organizationId: string, error: unknown): Promise<unknown> {
  if (error instanceof YouTubeError) {
    if (error.kind === "token") await youTubeTokenFailed(organizationId, error.message);
    return new ApiError(error.status >= 500 ? 502 : error.status, error.message);
  }
  return error;
}

/** Why the film cannot be published or scheduled now, or null: the film's own readiness and the connection's. */
export async function videoPublishProblem(organizationId: string, video: Row): Promise<string | null> {
  if (video.status === "uploading") return "Filmen laddas upp redan.";
  if (video.youtubeId) return "Filmen finns redan på YouTube.";
  const own = publishProblem({ ...metaOf(video), madeForKids: video.madeForKids, fileReady: Boolean(video.fileKey) });
  if (own) return own;
  const size = await storedVideoSize(organizationId, video.fileKey!);
  if (size === null || size !== num(video.fileSize)) return "Filmfilen finns inte kvar i lagringen. Ladda upp den igen.";
  return youTubePublishBlock(organizationId);
}

/** Hands the film to the upload: as `actor`, from where any earlier attempt came. */
async function queue(actor: Actor, video: Row) {
  const changed = await prisma.youTubeVideo.updateMany({ where: { id: video.id, organizationId: actor.organizationId, status: { in: ["draft", "failed"] }, youtubeId: null }, data: {
    status: "uploading", uploadById: actor.userId, uploadStartedAt: new Date(), uploadAttempts: 0, uploadNextAt: new Date(), uploadError: null,
  } });
  if (!changed.count) throw new ApiError(409, "Filmen har ändrats. Ladda om sidan.");
}

const activeRuns = new Set<string>();
/** Starts the upload in this server process (when it is not already running here or elsewhere). */
function kick(videoId: string) {
  if (activeRuns.has(videoId)) return;
  activeRuns.add(videoId);
  void driveUpload(videoId, PRESS_BUDGET_MS).catch(() => undefined).finally(() => activeRuns.delete(videoId));
}

/** Publicera nu in Schemalagt (the app's own process): the film the schedule just handed over starts at once. */
export async function kickVideoUpload(organizationId: string, id: string) {
  const video = await videoRow(organizationId, id);
  if (video?.status === "uploading") kick(video.id);
}

/** Publicera: every check now (a refusal is the answer), then the upload goes on on the server. */
export async function startVideoPublish(actor: Actor, id: string) {
  const video = await rowOf(actor.organizationId, id);
  const problem = await videoPublishProblem(actor.organizationId, video);
  if (problem) throw new ApiError(409, problem);
  await queue(actor, video);
  // A press replaces the film's waiting schedule: it goes now.
  await prisma.scheduledPublish.updateMany({ where: { organizationId: actor.organizationId, kind: "video", targetId: video.id, status: { in: ["scheduled", "needs_approval"] } },
    data: { status: "cancelled", cancelledById: actor.userId, cancelledAt: new Date(), result: "Publicerades direkt." } });
  await audit(actor, "youtube_publish", `Började ladda upp filmen till YouTube (id ${video.id}, ${video.privacy}).`);
  kick(video.id);
  return getVideoView(actor.organizationId, video.id);
}

/** Försök igen: a failed upload goes on from where YouTube has the file. */
export async function retryVideoUpload(actor: Actor, id: string) {
  const video = await rowOf(actor.organizationId, id);
  if (video.status !== "failed") throw new ApiError(409, "Det finns inget att försöka igen.");
  const problem = await videoPublishProblem(actor.organizationId, { ...video, status: "draft" });
  if (problem) throw new ApiError(409, problem);
  await queue(actor, video);
  await audit(actor, "youtube_publish", `Försökte ladda upp filmen igen (id ${video.id}).`);
  kick(video.id);
  return getVideoView(actor.organizationId, video.id);
}

/** Avbryt uppladdningen: the film is a draft again; what YouTube got of it is never published and goes away by itself. */
export async function cancelVideoUpload(actor: Actor, id: string) {
  const video = await rowOf(actor.organizationId, id);
  if (video.status !== "uploading") throw new ApiError(409, "Filmen laddas inte upp just nu.");
  await prisma.youTubeVideo.updateMany({ where: { id: video.id, organizationId: actor.organizationId, status: "uploading" }, data: {
    status: "draft", uploadSessionCipher: null, uploadOffset: BigInt(0), uploadNextAt: null, uploadLockedUntil: null, uploadError: null,
  } });
  await audit(actor, "youtube_publish", `Avbröt uppladdningen av filmen (id ${video.id}).`);
  return getVideoView(actor.organizationId, video.id);
}

/** Whether the person who started the upload may still publish for the company: active, admin, the company active, Cloud and write access. */
async function uploaderRefusal(organizationId: string, userId: string | null, now: Date): Promise<string | null> {
  if (!userId) return "Ingen har startat uppladdningen.";
  const member = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { isActive: true, role: true, user: { select: { isActive: true, email: true } }, organization: { select: { isActive: true, storageMode: true } } },
  });
  if (!member?.isActive || !canAccessTest(member.user) || (member.role !== "OWNER" && member.role !== "ADMIN")) return "Den som startade uppladdningen är inte längre administratör i företaget. Publicera igen.";
  if (!member.organization.isActive) return "Företaget är pausat.";
  if (member.organization.storageMode !== "HINTEK_CLOUD") return "Företaget använder lokal lagring.";
  try {
    const { serverExtensions } = await import("@/lib/extensions/server");
    const access = await serverExtensions.cloudWriteAccess(organizationId, now);
    if (!access.allowed) return "Företaget har ingen giltig Cloud-rättighet för att skriva just nu.";
  } catch { return "Behörigheten kunde inte kontrolleras."; }
  return null;
}

/**
 * One run of a film's upload, at most `budgetMs`: the claim (only while uploading, due and not locked by another run), the checks,
 * the resumable upload, and the outcome. Returns what became of it.
 */
export async function driveUpload(videoId: string, budgetMs: number, now = new Date()): Promise<"done" | "paused" | "retry" | "failed" | "skipped"> {
  const claimed = await prisma.youTubeVideo.updateMany({
    where: { id: videoId, status: "uploading", OR: [{ uploadLockedUntil: null }, { uploadLockedUntil: { lt: now } }], AND: [{ OR: [{ uploadNextAt: null }, { uploadNextAt: { lte: now } }] }], organization: moduleOnWhere("web_posts") },
    data: { uploadLockedUntil: new Date(now.getTime() + LOCK_MS) },
  });
  if (!claimed.count) return "skipped";
  let video = (await prisma.youTubeVideo.findUnique({ where: { id: videoId } }))!;
  const { organizationId } = video;
  const deadline = Date.now() + budgetMs;
  const fail = async (message: string, attempts = video.uploadAttempts + 1) => {
    await prisma.youTubeVideo.updateMany({ where: { id: videoId, status: "uploading" }, data: { status: "failed", uploadError: message.slice(0, 500), uploadAttempts: attempts, uploadLockedUntil: null, uploadNextAt: null } });
    await notifyAdmins(organizationId, video, message).catch(() => undefined);
    return "failed" as const;
  };
  const refusal = (await uploaderRefusal(organizationId, video.uploadById, now)) ?? (await youTubePublishBlock(organizationId));
  if (refusal) return fail(refusal, video.uploadAttempts);
  if (!video.fileKey || video.fileSize === null) return fail("Filmfilen saknas. Ladda upp den igen.");
  const channel = await youTubeChannelId(organizationId);
  const session = video.uploadSessionCipher ? await openCompanyKey(organizationId, SESSION_KEY, video.uploadSessionCipher).catch(() => null) : null;
  const total = Number(video.fileSize);
  try {
    const result = await runUpload({
      transport: youTubeTransport(),
      token: () => youTubeAccessToken(organizationId),
      read: (start, length) => readVideoPiece(organizationId, video.fileKey!, start, length),
      save: async ({ session: next, offset }) => {
        await prisma.youTubeVideo.updateMany({ where: { id: videoId, status: "uploading" }, data: {
          uploadSessionCipher: next ? await sealCompanyKey(organizationId, SESSION_KEY, next) : null, uploadOffset: BigInt(offset), uploadLockedUntil: new Date(Date.now() + LOCK_MS),
        } });
      },
      stop: async () => {
        if (Date.now() > deadline) return true;
        const current = await prisma.youTubeVideo.findUnique({ where: { id: videoId }, select: { status: true } });
        return current?.status !== "uploading";
      },
    }, { session, offset: Number(video.uploadOffset), total, type: video.fileType ?? "video/mp4", meta: metaOf(video) });
    if (result.kind === "paused") {
      await prisma.youTubeVideo.updateMany({ where: { id: videoId }, data: { uploadLockedUntil: null, uploadNextAt: new Date() } });
      return "paused";
    }
    const locked = keptPrivate(video.privacy, result.video.privacy);
    const done = await prisma.youTubeVideo.updateMany({ where: { id: videoId, status: "uploading" }, data: {
      status: "published", youtubeId: result.video.id, youtubePrivacy: result.video.privacy ?? video.privacy, youtubeChannelId: result.video.channelId ?? channel,
      publishedAt: new Date(), uploadSessionCipher: null, uploadOffset: BigInt(total), uploadLockedUntil: null, uploadNextAt: null, uploadError: null,
      thumbnailPending: Boolean(video.thumbnailKey), playlistPending: Boolean(video.playlistId),
    } });
    if (!done.count) return "skipped";
    if (video.privacy !== "private") await markPrivateLocked(organizationId, locked);
    await audit({ userId: video.uploadById ?? "system:youtube", organizationId }, "youtube_publish", `Filmen är uppladdad till YouTube (id ${video.id}).`);
    video = (await prisma.youTubeVideo.findUnique({ where: { id: videoId } }))!;
    await finishSteps(video).catch(() => undefined);
    return "done";
  } catch (error) {
    if (error instanceof YouTubeError && error.kind === "token") { await youTubeTokenFailed(organizationId, error.message); return fail(error.message); }
    const attempts = video.uploadAttempts + 1;
    const next = nextUploadAttempt(attempts, error);
    const message = error instanceof YouTubeError || error instanceof ApiError || error instanceof VideoStoreError ? error.message : "Uppladdningen till YouTube avbröts.";
    if (!next) return fail(attempts >= MAX_UPLOAD_ATTEMPTS ? `${message} Uppladdningen har försökt ${attempts} gånger.` : message, attempts);
    await prisma.youTubeVideo.updateMany({ where: { id: videoId, status: "uploading" }, data: {
      uploadAttempts: attempts, uploadNextAt: next, uploadLockedUntil: null, uploadError: `${message} Försöker igen ${formatSwedish(next, { timeStyle: "short" })}.`.slice(0, 500),
    } });
    return "retry";
  }
}

/**
 * The steps after the upload: the cover picture (thumbnails.set) and the playlist (playlistItems.insert). Each is marked done when
 * it went through; a failure stays as a note on the film and is tried again by the job. The note, or null.
 */
async function finishSteps(video: Row): Promise<string | null> {
  if (!video.youtubeId || (!video.thumbnailPending && !video.playlistPending)) return null;
  const { organizationId } = video;
  const notes: string[] = [];
  const token = await youTubeAccessToken(organizationId);
  if (video.thumbnailPending && video.thumbnailKey) {
    const image = await readThumbnail(organizationId, video.thumbnailKey);
    try {
      if (image) await setThumbnail(youTubeTransport(), token, video.youtubeId, image);
      await prisma.youTubeVideo.updateMany({ where: { id: video.id }, data: { thumbnailPending: false } });
    } catch (error) {
      notes.push(`Omslagsbilden: ${error instanceof YouTubeError ? error.message : "kunde inte sättas."}`);
      if (error instanceof YouTubeError && !(error.kind === "network" || error.kind === "rate" || error.status >= 500)) await prisma.youTubeVideo.updateMany({ where: { id: video.id }, data: { thumbnailPending: false } });
    }
  } else if (video.thumbnailPending) await prisma.youTubeVideo.updateMany({ where: { id: video.id }, data: { thumbnailPending: false } });
  if (video.playlistPending && video.playlistId) {
    try {
      await addToPlaylist(youTubeTransport(), token, video.playlistId, video.youtubeId);
      await prisma.youTubeVideo.updateMany({ where: { id: video.id }, data: { playlistPending: false } });
    } catch (error) {
      notes.push(`Spellistan: ${error instanceof YouTubeError ? error.message : "filmen kunde inte läggas till."}`);
      if (error instanceof YouTubeError && !(error.kind === "network" || error.kind === "rate" || error.status >= 500)) await prisma.youTubeVideo.updateMany({ where: { id: video.id }, data: { playlistPending: false } });
    }
  } else if (video.playlistPending) await prisma.youTubeVideo.updateMany({ where: { id: video.id }, data: { playlistPending: false } });
  await prisma.youTubeVideo.updateMany({ where: { id: video.id }, data: { uploadError: notes.length ? notes.join(" ").slice(0, 500) : null } });
  return notes.length ? notes.join(" ") : null;
}

/** The job (schedule:publish, every five minutes): every film whose upload is due, one at a time within the budget, then the steps left. */
export async function runYouTubeUploads(now = new Date(), budgetMs = JOB_BUDGET_MS) {
  const end = Date.now() + budgetMs;
  const due = await prisma.youTubeVideo.findMany({
    where: { status: "uploading", OR: [{ uploadNextAt: null }, { uploadNextAt: { lte: now } }], AND: [{ OR: [{ uploadLockedUntil: null }, { uploadLockedUntil: { lt: now } }] }], organization: moduleOnWhere("web_posts") },
    orderBy: { uploadStartedAt: "asc" }, take: 20, select: { id: true },
  });
  const result = { due: due.length, done: 0, paused: 0, retried: 0, failed: 0, steps: 0 };
  for (const { id } of due) {
    const left = end - Date.now();
    if (left < 15_000) break;
    const outcome = await driveUpload(id, left, new Date()).catch(() => "retry" as const);
    if (outcome === "done") result.done += 1; else if (outcome === "paused") result.paused += 1; else if (outcome === "retry") result.retried += 1; else if (outcome === "failed") result.failed += 1;
  }
  const pending = await prisma.youTubeVideo.findMany({ where: { status: "published", OR: [{ thumbnailPending: true }, { playlistPending: true }], organization: moduleOnWhere("web_posts") }, take: 20 });
  for (const video of pending) { if (Date.now() > end) break; await finishSteps(video).catch(() => undefined); result.steps += 1; }
  return result;
}

// ---------- after publishing ----------

/** Ta bort från YouTube: the film goes from the channel (50 units); the film and its file stay in Workflow as a draft. */
export async function removeVideoFromYouTube(actor: Actor, id: string) {
  const video = await rowOf(actor.organizationId, id);
  if (!video.youtubeId) throw new ApiError(409, "Filmen finns inte på YouTube.");
  const token = await tokenFor(actor.organizationId);
  try { await deleteVideo(youTubeTransport(), token, video.youtubeId); }
  catch (error) { throw await apiErrorOf(actor.organizationId, error); }
  await prisma.youTubeVideo.update({ where: { id: video.id }, data: {
    status: "draft", youtubeId: null, youtubePrivacy: null, youtubeChannelId: null, publishedAt: null, thumbnailPending: false, playlistPending: false, uploadError: null, uploadOffset: BigInt(0), updatedById: actor.userId,
  } });
  await audit(actor, "youtube_video_remove", `Tog bort filmen från YouTube (id ${video.id}). Filmen finns kvar i Workflow.`);
  return getVideoView(actor.organizationId, video.id);
}

/** Ta bort ur Workflow: the film's row, its file and its cover picture go; on YouTube it stays as it is. Never while it uploads. */
export async function deleteVideoFromWorkflow(actor: Actor, id: string) {
  const video = await rowOf(actor.organizationId, id);
  if (video.status === "uploading") throw new ApiError(409, "Filmen laddas upp just nu. Avbryt uppladdningen först.");
  await videoChanged(actor.organizationId, video.id, true);
  await prisma.youTubeVideo.deleteMany({ where: { id: video.id, organizationId: actor.organizationId } });
  for (const key of [video.fileKey, video.thumbnailKey, video.fileUpload]) await removeStored(actor.organizationId, key).catch(() => undefined);
  await audit(actor, "youtube_video_delete", `Tog bort filmen ur Workflow (id ${video.id})${video.youtubeId ? "; den finns kvar på YouTube" : ""}.`);
  return { removed: video.id };
}

// ---------- Schemalägg (lib/schedule/server.ts) ----------

/** The hash of a film's content: the texts, the choices, the file and the cover picture. A change asks for a new approval. */
export function videoContentHash(video: Pick<Row, "title" | "description" | "tags" | "categoryId" | "privacy" | "madeForKids" | "playlistId" | "fileKey" | "thumbnailKey">) {
  const fields = { title: video.title, description: video.description, tags: video.tags, categoryId: video.categoryId, privacy: video.privacy, madeForKids: video.madeForKids, playlistId: video.playlistId, fileKey: video.fileKey, thumbnailKey: video.thumbnailKey };
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

export const videoForSchedule = (organizationId: string, id: string) => videoRow(organizationId, id);

/** A scheduled film's items: a change makes them wait for a new approval; a removed film's are cancelled. */
export async function videoChanged(organizationId: string, id: string, removed = false) {
  const items = await prisma.scheduledPublish.findMany({ where: { organizationId, kind: "video", targetId: id, status: { in: ["scheduled", "needs_approval"] } }, select: { id: true, contentHash: true, status: true } });
  if (!items.length) return;
  if (removed) {
    await prisma.scheduledPublish.updateMany({ where: { id: { in: items.map((item) => item.id) }, organizationId }, data: { status: "cancelled", cancelledAt: new Date(), result: "Filmen togs bort." } });
    return;
  }
  const video = await videoRow(organizationId, id);
  if (!video) return;
  const hash = videoContentHash(video);
  for (const item of items) {
    const next = item.contentHash === hash ? "scheduled" : "needs_approval";
    if (next !== item.status) await prisma.scheduledPublish.updateMany({ where: { id: item.id, organizationId, status: item.status }, data: { status: next, title: video.title.slice(0, 200) } });
  }
}

/** The scheduled time has come: the film goes to the upload as the admin who scheduled it (the job then uploads it). */
export async function publishScheduledVideo(actor: Actor, id: string, approvedHash: string): Promise<{ kind: "published" | "fail" | "skip" | "retry"; message: string }> {
  const video = await videoRow(actor.organizationId, id);
  if (!video) return { kind: "skip", message: "Filmen finns inte längre." };
  if (video.youtubeId || video.status === "published") return { kind: "skip", message: "Filmen var redan publicerad." };
  if (video.status === "uploading") return { kind: "skip", message: "Filmen laddas redan upp." };
  if (videoContentHash(video) !== approvedHash) return { kind: "fail", message: "Filmen har ändrats efter schemaläggningen. Godkänn den igen." };
  const problem = await videoPublishProblem(actor.organizationId, video);
  if (problem) return { kind: "fail", message: problem };
  await queue(actor, video);
  await audit(actor, "youtube_publish", `Schemalagd uppladdning av filmen till YouTube började (id ${video.id}).`);
  return { kind: "published", message: "Uppladdningen till YouTube har börjat." };
}

// ---------- the mail ----------

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The company's admins get one mail when an upload fails (what goes wrong must reach a person by e-mail). */
async function notifyAdmins(organizationId: string, video: Pick<Row, "id" | "title">, reason: string) {
  const [{ mailConfig }, { sendSystemEmail }, { publicInstance }] = await Promise.all([import("@/lib/mail/settings-server"), import("@/lib/mail/mailer"), import("@/lib/instance")]);
  const config = await mailConfig();
  if (config.blockedReason) return;
  const admins = await prisma.organizationMember.findMany({ where: { organizationId, isActive: true, role: { in: ["OWNER", "ADMIN"] }, user: { isActive: true } }, select: { user: { select: { email: true } } } });
  const what = `Filmen ”${video.title || "utan titel"}”`;
  const link = absoluteUrl(`/?view=company_videos&video=${encodeURIComponent(video.id)}`);
  for (const admin of admins) {
    await sendSystemEmail({ to: admin.user.email, subject: `[${publicInstance().name}] Filmen kunde inte laddas upp till YouTube`,
      text: `${what} kunde inte laddas upp till YouTube.\nOrsak: ${reason}\n\nÖppna filmen och försök igen:\n${link}`,
      html: `<p>${escape(what)} kunde inte laddas upp till YouTube.</p><p>Orsak: ${escape(reason)}</p><p><a href="${link}">Öppna filmen och försök igen</a></p>` });
  }
}
