/**
 * Filmer (YouTube, 2026-11-20), pure – shared by the page, the server and the tests (no server code here).
 *
 * - A film is a draft until an admin presses Publicera or Schemalägg; the upload to YouTube runs on the server.
 * - The texts follow YouTube's own limits for a video's snippet: a title of at most 100 characters, a description of at most
 *   5000 bytes, neither with < or >, and tags of at most 500 characters together (a tag with a space counts its quotes).
 * - A film file is checked by its first bytes, never by its name: MP4 and MOV (an ISO base media file, `ftyp` or an older
 *   QuickTime atom) and WebM (an EBML header with the doctype webm).
 */
export const VIDEO_STATUSES = ["draft", "uploading", "published", "failed"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];
/** What the list shows: the stored status, and Schemalagd while an active schedule item waits. */
export type VideoListStatus = VideoStatus | "scheduled";
export const VIDEO_STATUS_LABEL: Record<VideoListStatus, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  draft: { label: "Utkast", tone: "neutral" },
  scheduled: { label: "Schemalagd", tone: "info" },
  uploading: { label: "Laddas upp", tone: "info" },
  published: { label: "Publicerad", tone: "success" },
  failed: { label: "Fel", tone: "danger" },
};

export const PRIVACY_OPTIONS = [
  { key: "private", label: "Privat", hint: "Bara du och de du bjuder in kan se filmen." },
  { key: "unlisted", label: "Olistad", hint: "Alla med länken kan se filmen, men den syns inte på kanalen eller i sökningar." },
  { key: "public", label: "Offentlig", hint: "Alla kan hitta och se filmen." },
] as const;
export type VideoPrivacy = (typeof PRIVACY_OPTIONS)[number]["key"];
export const PRIVACY_KEYS = PRIVACY_OPTIONS.map((option) => option.key) as [VideoPrivacy, ...VideoPrivacy[]];
export const privacyLabel = (key: string | null | undefined) => PRIVACY_OPTIONS.find((option) => option.key === key)?.label ?? "Privat";

export const TITLE_MAX = 100;
export const DESCRIPTION_MAX_BYTES = 5000;
export const TAGS_MAX_CHARS = 500;
export const TAG_MAX = 100;
export const TAGS_MAX_COUNT = 60;

/**
 * The browser sends a film to our own server in pieces of 2 MB, each as the request's raw body (2026-11-25, as the landing page's
 * films since 0.85.0: 8 MB pieces hung on a slow line until the proxy gave up after 60 s).
 */
export const VIDEO_CHUNK_BYTES = 2 * 1024 * 1024;
/**
 * The server sends it on to YouTube in pieces of 2 MiB (2026-11-25, before 8 MiB): YouTube wants every piece but the last to be a
 * multiple of 256 KiB, and a smaller piece is quicker to send again when the line hiccups.
 */
export const YOUTUBE_CHUNK_BYTES = 8 * 256 * 1024;
/** A cover picture: JPEG or PNG, at most 2 MB (YouTube's own limit for thumbnails.set). */
export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
export const DEFAULT_VIDEO_MAX_MB = 2048;

export const VIDEO_TYPES = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" } as const;
export type VideoFileKind = keyof typeof VIDEO_TYPES;

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

/** What a film file is by its first bytes (at least 12; 64 lets a WebM say its doctype), or null. Pure. */
export function videoKindOf(head: Uint8Array): VideoFileKind | null {
  if (head.byteLength < 12) return null;
  const box = ascii(head, 4, 8);
  if (box === "ftyp") return ascii(head, 8, 12) === "qt  " ? "mov" : "mp4";
  // Older QuickTime files start with another atom.
  if (["moov", "mdat", "wide", "free", "skip"].includes(box)) return "mov";
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    const text = ascii(head, 0, Math.min(head.byteLength, 64));
    return text.includes("webm") ? "webm" : null;
  }
  return null;
}

/** What a picture is by its first bytes: JPEG or PNG, or null. Pure. */
export function imageKindOf(head: Uint8Array): "image/jpeg" | "image/png" | null {
  if (head.byteLength >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.byteLength >= 8 && head[0] === 0x89 && ascii(head, 1, 4) === "PNG" && head[4] === 0x0d && head[5] === 0x0a) return "image/png";
  return null;
}

/** "el, installation, 'el bil'" → the tags, each trimmed, without # and duplicates. Pure. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const tag = part.trim().replace(/^#+/, "").replace(/\s+/g, " ");
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
  }
  return tags;
}

/** How YouTube counts the tags: every tag's characters, two quotes for one with a space, and a comma between. Pure. */
export const tagsLength = (tags: readonly string[]) => tags.reduce((sum, tag) => sum + tag.length + (tag.includes(" ") ? 2 : 0), 0) + Math.max(0, tags.length - 1);

const utf8Length = (text: string) => new TextEncoder().encode(text).byteLength;

export type VideoTexts = { title: string; description: string; tags: readonly string[] };

/** Why the texts cannot go to YouTube, or null. Pure. */
export function textsProblem(input: VideoTexts): string | null {
  const title = input.title.trim();
  if (!title) return "Skriv en titel.";
  if (title.length > TITLE_MAX) return `Titeln får vara högst ${TITLE_MAX} tecken.`;
  if (/[<>]/.test(title)) return "Titeln får inte innehålla < eller >.";
  if (utf8Length(input.description) > DESCRIPTION_MAX_BYTES) return "Beskrivningen är för lång för YouTube (högst 5 000 tecken).";
  if (/[<>]/.test(input.description)) return "Beskrivningen får inte innehålla < eller >.";
  if (input.tags.length > TAGS_MAX_COUNT) return `Högst ${TAGS_MAX_COUNT} taggar.`;
  if (input.tags.some((tag) => tag.length > TAG_MAX || /[<>]/.test(tag))) return "En tagg är för lång eller innehåller < eller >.";
  if (tagsLength(input.tags) > TAGS_MAX_CHARS) return `Taggarna får vara högst ${TAGS_MAX_CHARS} tecken tillsammans.`;
  return null;
}

export type PublishReadiness = VideoTexts & { fileReady: boolean; madeForKids: boolean | null; privacy: string; categoryId: string | null };

/** Why the film cannot be published or scheduled yet (the page greys the buttons with it; the server says the same). Pure. */
export function publishProblem(input: PublishReadiness): string | null {
  if (!input.fileReady) return "Ladda upp filmfilen först.";
  const texts = textsProblem(input);
  if (texts) return texts;
  if (input.madeForKids === null) return "Svara på om filmen är gjord för barn. YouTube kräver svaret.";
  if (!(PRIVACY_KEYS as readonly string[]).includes(input.privacy)) return "Välj vem som får se filmen.";
  return null;
}

/** The film's address on YouTube (opened in a new tab; never embedded). */
export const youtubeWatchUrl = (id: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
export const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;

/** The share sent, 0–100, for the page. Pure. */
export const uploadPercent = (sent: number, total: number) => (total > 0 ? Math.min(100, Math.floor((sent / total) * 100)) : 0);

/** "1,2 GB", "350 MB": a size in words. Pure. */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
  if (bytes >= 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

/** One film as the page shows it (no token, no session address). */
export type VideoView = {
  id: string; status: VideoStatus; listStatus: VideoListStatus;
  title: string; description: string; tags: string[]; categoryId: string | null; privacy: VideoPrivacy; madeForKids: boolean | null;
  playlistId: string | null; playlistName: string | null;
  file: { name: string | null; type: string | null; size: number | null; received: number; ready: boolean; upload: string | null };
  thumbnail: { source: string | null; version: string | null } | null;
  youtube: { id: string; url: string; privacy: string | null; lockedPrivate: boolean } | null;
  upload: { sent: number; total: number; attempts: number; nextAt: string | null; error: string | null; startedAt: string | null; running: boolean } | null;
  thumbnailPending: boolean; playlistPending: boolean;
  publishedAt: string | null; createdAt: string; updatedAt: string;
};

/** The filters of the list, as the page's chips. */
export const VIDEO_FILTERS = [
  { key: "all", label: "Alla" },
  { key: "draft", label: "Utkast" },
  { key: "scheduled", label: "Schemalagda" },
  { key: "uploading", label: "Laddas upp" },
  { key: "published", label: "Publicerade" },
  { key: "failed", label: "Fel" },
] as const;
export type VideoFilter = (typeof VIDEO_FILTERS)[number]["key"];

/** The films a filter and a search show: the search looks in the title, the description and the tags. Pure. */
export function filterVideos<T extends Pick<VideoView, "listStatus" | "title" | "description" | "tags">>(videos: readonly T[], filter: VideoFilter, query: string): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return videos.filter((video) => (filter === "all" || video.listStatus === filter)
    && words.every((word) => `${video.title}\n${video.description}\n${video.tags.join(" ")}`.toLowerCase().includes(word)));
}
