import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for Google's OAuth and the YouTube Data API v3 (Filmer, 2026-11-20), for the tests and the release regression's
 * browser test (scripts/qa/stand-ins.ts --youtube): the sign-in (which sends the browser straight back with a code), the token
 * exchange with PKCE, renewing and revoking, channels, playlists, categories, the resumable upload (a session address, pieces
 * with Content-Range, 308 with Range, the status question), thumbnails.set, playlistItems.insert and videos.update/delete/list –
 * on 127.0.0.1, with Google's error shapes. Nothing here talks to Google. What was uploaded is kept in memory and listed on the
 * stand-in's own page (/).
 */
export type FakeVideo = { id: string; title: string; description: string; tags: string[]; categoryId: string; privacy: string; madeForKids: boolean; bytes: number; thumbnail: number; playlists: string[]; deleted: boolean };
export type FakeYouTube = {
  url: string;
  clientId: string; clientSecret: string;
  channels: { id: string; name: string }[];
  playlists: { id: string; name: string }[];
  videos: FakeVideo[];
  /** Requests as method and path (never a token). */
  requests: { method: string; path: string }[];
  /** The pieces' Content-Range headers, in order. */
  ranges: string[];
  /** The next n upload pieces answer 503 (a server error the upload must survive). */
  failPieces(count: number): void;
  /** Every session YouTube knows is forgotten (an upload must start again). */
  forgetSessions(): void;
  /** YouTube keeps every new film private (the API project has not passed Google's audit). */
  lockPrivate(on: boolean): void;
  /** Makes every token answer 401, and a refresh invalid_grant. */
  revokeAll(): void;
  issued(): string[];
  stop(): Promise<void>;
};

type Options = { port?: number; clientId?: string; clientSecret?: string; channels?: { id: string; name: string }[]; playlists?: { id: string; name: string }[]; lockPrivate?: boolean };

const CATEGORIES = [{ id: "22", title: "Personer och bloggar" }, { id: "27", title: "Utbildning" }, { id: "28", title: "Vetenskap och teknik" }, { id: "26", title: "Instruktioner och stil" }];
const PIECE = 256 * 1024;

export async function startFakeYouTube(options: Options = {}): Promise<FakeYouTube> {
  const clientId = options.clientId ?? "123456789012-exempelklient0123456789.apps.googleusercontent.com";
  const clientSecret = options.clientSecret ?? "exempel-klienthemlighet-0123456789";
  const channels = options.channels ?? [{ id: "UCexempelkanal0123456789", name: "Elfirma Exempel" }];
  const playlists = options.playlists ?? [{ id: "PLexempellista0001", name: "Instruktioner" }, { id: "PLexempellista0002", name: "Referensjobb" }];
  const access = new Set<string>();
  const refresh = new Set<string>();
  const codes = new Map<string, { challenge: string; redirectUri: string }>();
  const sessions = new Map<string, { meta: Record<string, unknown>; total: number; received: number; type: string }>();
  const videos: FakeVideo[] = [];
  const requests: FakeYouTube["requests"] = [];
  const ranges: string[] = [];
  let failing = 0;
  let locked = Boolean(options.lockPrivate);
  let revoked = false;
  const token = (prefix: string) => `${prefix}${randomBytes(24).toString("base64url")}`;
  const id = (length: number) => randomBytes(length).toString("base64url").replace(/[^A-Za-z0-9]/g, "x").slice(0, length);

  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json; charset=UTF-8", ...headers });
    res.end(JSON.stringify(body));
  };
  const apiError = (res: ServerResponse, status: number, reason: string, message = reason) => json(res, status, { error: { code: status, message, errors: [{ reason, domain: "youtube", message }] } });
  const read = (req: IncomingMessage) => new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
  const bearer = (req: IncomingMessage) => /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ""))?.[1] ?? null;
  const authorized = (req: IncomingMessage) => { const value = bearer(req); return !revoked && Boolean(value && access.has(value)); };
  const issue = (withRefresh: boolean) => {
    const accessToken = token("ya29.fake-");
    access.add(accessToken);
    const out: Record<string, unknown> = { access_token: accessToken, expires_in: 3599, scope: "https://www.googleapis.com/auth/youtube", token_type: "Bearer" };
    if (withRefresh) { const value = token("1//fake-"); refresh.add(value); out.refresh_token = value; }
    return out;
  };
  const videoJson = (video: FakeVideo) => ({ kind: "youtube#video", id: video.id, snippet: { title: video.title, description: video.description, tags: video.tags, categoryId: video.categoryId, channelId: channels[0].id },
    status: { uploadStatus: "uploaded", privacyStatus: video.privacy, selfDeclaredMadeForKids: video.madeForKids } });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push({ method: req.method ?? "GET", path: url.pathname });
    try {
      // ---------- the sign-in: straight back with a code, as a person who pressed Tillåt ----------
      if (req.method === "GET" && url.pathname === "/o/oauth2/v2/auth") {
        const redirectUri = url.searchParams.get("redirect_uri") ?? "";
        const state = url.searchParams.get("state") ?? "";
        const back = new URL(redirectUri);
        if (url.searchParams.get("client_id") !== clientId) { back.searchParams.set("error", "invalid_client"); }
        else if (url.searchParams.get("code_challenge_method") !== "S256" || !url.searchParams.get("code_challenge")) { back.searchParams.set("error", "invalid_request"); }
        else {
          const code = token("4/fake-");
          codes.set(code, { challenge: url.searchParams.get("code_challenge")!, redirectUri });
          back.searchParams.set("code", code);
        }
        back.searchParams.set("state", state);
        res.writeHead(302, { location: back.toString() });
        res.end();
        return;
      }
      if (req.method === "POST" && url.pathname === "/token") {
        const form = new URLSearchParams((await read(req)).toString("utf8"));
        if (form.get("client_id") !== clientId || form.get("client_secret") !== clientSecret) return json(res, 401, { error: "invalid_client", error_description: "The OAuth client was not found." });
        if (form.get("grant_type") === "authorization_code") {
          const code = codes.get(form.get("code") ?? "");
          codes.delete(form.get("code") ?? "");
          const verifier = form.get("code_verifier") ?? "";
          if (!code || code.redirectUri !== form.get("redirect_uri") || createHash("sha256").update(verifier).digest("base64url") !== code.challenge) return json(res, 400, { error: "invalid_grant", error_description: "Bad Request" });
          return json(res, 200, issue(true));
        }
        if (form.get("grant_type") === "refresh_token") {
          if (revoked || !refresh.has(form.get("refresh_token") ?? "")) return json(res, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
          return json(res, 200, issue(false));
        }
        return json(res, 400, { error: "unsupported_grant_type" });
      }
      if (req.method === "POST" && url.pathname === "/revoke") {
        const form = new URLSearchParams((await read(req)).toString("utf8"));
        const value = form.get("token") ?? "";
        const known = access.delete(value) || refresh.delete(value);
        return json(res, known ? 200 : 400, known ? {} : { error: "invalid_token" });
      }
      // The browser test's own switches (the stand-in runs in another process): { lockPrivate, failPieces }.
      if (url.pathname === "/__control" && req.method === "POST") {
        const body = JSON.parse((await read(req)).toString("utf8") || "{}") as { lockPrivate?: boolean; failPieces?: number };
        if (typeof body.lockPrivate === "boolean") locked = body.lockPrivate;
        if (typeof body.failPieces === "number") failing = Math.max(0, Math.min(10, body.failPieces));
        return json(res, 200, { lockPrivate: locked, failPieces: failing });
      }
      if (url.pathname === "/videos.json" && req.method === "GET") return json(res, 200, { videos });
      if (url.pathname === "/" && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8"><title>Låtsas-YouTube</title><h1>Låtsas-YouTube</h1><ul>${videos.map((video) => `<li>${video.id}: ${video.title.replace(/[<>&]/g, "")} (${video.privacy}, ${video.bytes} byte${video.deleted ? ", borttagen" : ""})</li>`).join("")}</ul>`);
        return;
      }

      // ---------- the API ----------
      const upload = url.pathname.startsWith("/upload/youtube/v3/");
      if (!url.pathname.startsWith("/youtube/v3/") && !upload) { res.writeHead(404); res.end(); return; }
      if (!authorized(req)) return apiError(res, 401, "authError", "Invalid Credentials");
      const path = url.pathname.replace(/^\/(upload\/)?youtube\/v3\//, "");

      if (upload && path === "videos" && req.method === "POST") {
        const meta = JSON.parse((await read(req)).toString("utf8") || "{}") as Record<string, unknown>;
        const total = Number(req.headers["x-upload-content-length"]);
        if (!Number.isInteger(total) || total <= 0) return apiError(res, 400, "invalidValue", "X-Upload-Content-Length");
        const sessionId = id(24);
        sessions.set(sessionId, { meta, total, received: 0, type: String(req.headers["x-upload-content-type"] ?? "video/*") });
        const address = `${baseUrl}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&upload_id=${sessionId}`;
        res.writeHead(200, { location: address, "content-length": "0" });
        res.end();
        return;
      }
      if (upload && path === "videos" && req.method === "PUT") {
        const session = sessions.get(url.searchParams.get("upload_id") ?? "");
        const bytes = await read(req);
        if (!session) return apiError(res, 404, "notFound", "Upload session not found.");
        const range = String(req.headers["content-range"] ?? "");
        ranges.push(range);
        const status = (done: boolean) => {
          if (done) {
            const snippet = (session.meta.snippet ?? {}) as Record<string, unknown>;
            const state = (session.meta.status ?? {}) as Record<string, unknown>;
            const asked = String(state.privacyStatus ?? "private");
            const video: FakeVideo = { id: id(11), title: String(snippet.title ?? ""), description: String(snippet.description ?? ""), tags: Array.isArray(snippet.tags) ? snippet.tags.map(String) : [],
              categoryId: String(snippet.categoryId ?? "22"), privacy: locked ? "private" : asked, madeForKids: state.selfDeclaredMadeForKids === true, bytes: session.total, thumbnail: 0, playlists: [], deleted: false };
            videos.push(video);
            sessions.delete(url.searchParams.get("upload_id")!);
            return json(res, 201, videoJson(video));
          }
          res.writeHead(308, session.received ? { range: `bytes=0-${session.received - 1}`, "content-length": "0" } : { "content-length": "0" });
          res.end();
        };
        if (/^bytes \*\/\d+$/.test(range)) return status(session.received >= session.total);
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
        if (!match) return apiError(res, 400, "badContent", "Content-Range");
        if (failing > 0) { failing -= 1; return apiError(res, 503, "backendError", "Backend Error"); }
        const [start, end, total] = [Number(match[1]), Number(match[2]), Number(match[3])];
        if (total !== session.total || end - start + 1 !== bytes.byteLength) return apiError(res, 400, "badContent", "The piece does not match its Content-Range.");
        if (end + 1 < total && bytes.byteLength % PIECE !== 0) return apiError(res, 400, "badContent", "A piece must be a multiple of 256 KiB.");
        if (start === session.received) session.received = end + 1;
        return status(session.received >= session.total);
      }
      if (upload && path === "thumbnails/set" && req.method === "POST") {
        const video = videos.find((item) => item.id === url.searchParams.get("videoId") && !item.deleted);
        const bytes = await read(req);
        if (!video) return apiError(res, 404, "videoNotFound");
        if (bytes.byteLength > 2 * 1024 * 1024) return apiError(res, 400, "mediaBodyRequired");
        video.thumbnail = bytes.byteLength;
        return json(res, 200, { kind: "youtube#thumbnailSetResponse", items: [{ default: { url: "https://i.ytimg.com/vi/x/default.jpg" } }] });
      }
      if (path === "channels" && req.method === "GET") return json(res, 200, { kind: "youtube#channelListResponse", items: channels.map((channel) => ({ kind: "youtube#channel", id: channel.id, snippet: { title: channel.name } })) });
      if (path === "playlists" && req.method === "GET") return json(res, 200, { kind: "youtube#playlistListResponse", items: playlists.map((list) => ({ kind: "youtube#playlist", id: list.id, snippet: { title: list.name } })) });
      if (path === "videoCategories" && req.method === "GET") return json(res, 200, { items: CATEGORIES.map((category) => ({ id: category.id, snippet: { title: category.title, assignable: true } })) });
      if (path === "playlistItems" && req.method === "POST") {
        const body = JSON.parse((await read(req)).toString("utf8") || "{}") as { snippet?: { playlistId?: string; resourceId?: { videoId?: string } } };
        const video = videos.find((item) => item.id === body.snippet?.resourceId?.videoId && !item.deleted);
        if (!playlists.some((list) => list.id === body.snippet?.playlistId)) return apiError(res, 404, "playlistNotFound");
        if (!video) return apiError(res, 404, "videoNotFound");
        video.playlists.push(body.snippet!.playlistId!);
        return json(res, 200, { kind: "youtube#playlistItem", id: id(20) });
      }
      if (path === "videos" && req.method === "PUT") {
        const body = JSON.parse((await read(req)).toString("utf8") || "{}") as { id?: string; snippet?: Record<string, unknown>; status?: Record<string, unknown> };
        const video = videos.find((item) => item.id === body.id && !item.deleted);
        if (!video) return apiError(res, 404, "videoNotFound");
        if (!body.snippet?.categoryId) return apiError(res, 400, "invalidCategoryId");
        video.title = String(body.snippet.title ?? video.title); video.description = String(body.snippet.description ?? ""); video.tags = Array.isArray(body.snippet.tags) ? body.snippet.tags.map(String) : [];
        video.categoryId = String(body.snippet.categoryId); video.madeForKids = body.status?.selfDeclaredMadeForKids === true;
        video.privacy = locked ? "private" : String(body.status?.privacyStatus ?? video.privacy);
        return json(res, 200, videoJson(video));
      }
      if (path === "videos" && req.method === "DELETE") {
        const video = videos.find((item) => item.id === url.searchParams.get("id") && !item.deleted);
        if (!video) return apiError(res, 404, "videoNotFound");
        video.deleted = true;
        res.writeHead(204); res.end();
        return;
      }
      if (path === "videos" && req.method === "GET") {
        const video = videos.find((item) => item.id === url.searchParams.get("id") && !item.deleted);
        return json(res, 200, { items: video ? [videoJson(video)] : [] });
      }
      return apiError(res, 404, "notFound");
    } catch {
      if (!res.headersSent) apiError(res, 500, "backendError");
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(options.port ?? 0, "127.0.0.1", () => resolve()); });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: baseUrl, clientId, clientSecret, channels, playlists, videos, requests, ranges,
    failPieces(count) { failing = count; },
    forgetSessions() { sessions.clear(); },
    lockPrivate(on) { locked = on; },
    revokeAll() { revoked = true; },
    issued: () => [...access, ...refresh],
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
