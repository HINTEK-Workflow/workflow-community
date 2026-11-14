import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for Meta's Graph API (Facebook och Instagram, 2026-11-10), for the tests and for showing the whole flow on a dev
 * server (scripts/meta/demo-meta.ts): the calls Workflow makes – the token exchange, debug_token, /me/accounts, a page's photos,
 * Instagram's container (also a story's, media_type STORIES), its status, media_publish and content_publishing_limit, a page's
 * photo_stories (2026-11-13), and removing an object – on 127.0.0.1, with
 * Meta's error shapes. Nothing here talks to Meta. What was "posted" is kept in memory and shown on the stand-in's own page (/).
 *
 * Instagram's container fetches the picture from the address it is given, as Instagram does; on loopback that address is the
 * dev server's own.
 */
export type FakeMetaPage = { id: string; name: string; instagram?: { id: string; username: string } | null };
export type FakePost = { network: "facebook" | "instagram" | "facebook_story" | "instagram_story"; target: string; caption: string; published: boolean; bytes: number; image?: string; at: string; id: string };
export type FakeMeta = {
  url: string;
  appId: string; appSecret: string; shortToken: string;
  /** Requests as method and path (never a token). */
  requests: { method: string; path: string }[];
  posts: FakePost[];
  deleted: string[];
  /** The picture addresses Instagram's containers were given. */
  imageUrls: string[];
  /** Every token given out so far (long-lived user tokens and page tokens). */
  issued(): string[];
  /** Makes a token answer like a revoked one (code 190, subcode 460). */
  revokeAll(): void;
  setScopes(scopes: string[]): void;
  setQuota(used: number, total?: number): void;
  stop(): Promise<void>;
};

export const ALL_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish", "business_management"];

type Options = {
  port?: number; appId?: string; appSecret?: string; shortToken?: string; pages?: FakeMetaPage[]; scopes?: string[]; version?: string;
  /** How Instagram's container fetches the picture (the tests answer from the app's route without a server); fetch by default. */
  fetchImage?: (url: string) => Promise<Response>;
};

export async function startFakeMeta(options: Options = {}): Promise<FakeMeta> {
  const appId = options.appId ?? "1234567890123";
  const appSecret = options.appSecret ?? "demoappsecret0123456789abcdef00";
  const shortToken = options.shortToken ?? "EAADemoShortLivedUserToken0123456789abcdefABCDEF";
  const version = options.version ?? "v24.0";
  const pages = options.pages ?? [{ id: "111111111111111", name: "Elfirma Exempel AB", instagram: { id: "17840000000000001", username: "elfirma_exempel" } }];
  let scopes = options.scopes ?? [...ALL_SCOPES];
  let quota = { used: 0, total: 50 };
  let revoked = false;
  const userTokens = new Set<string>();
  const pageTokens = new Map<string, string>();
  const containers = new Map<string, { ig: string; status: string; caption: string; image?: string; bytes: number; story: boolean }>();
  const requests: FakeMeta["requests"] = [];
  const posts: FakePost[] = [];
  const deleted: string[] = [];
  const imageUrls: string[] = [];
  const id = () => String(BigInt(`0x${randomBytes(7).toString("hex")}`));
  const token = (prefix: string) => `${prefix}${randomBytes(24).toString("base64url")}`;

  const send = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const error = (response: ServerResponse, status: number, code: number, message: string, subcode?: number) =>
    send(response, status, { error: { message, type: code === 190 ? "OAuthException" : "GraphMethodException", code, ...(subcode ? { error_subcode: subcode } : {}), fbtrace_id: "fake" } });
  const readBody = async (request: IncomingMessage) => { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk as Buffer); return Buffer.concat(chunks); };
  const params = async (request: IncomingMessage, url: URL): Promise<Map<string, string | Blob>> => {
    const out = new Map<string, string | Blob>([...url.searchParams.entries()]);
    if (request.method === "POST") {
      const bytes = await readBody(request);
      const type = request.headers["content-type"] ?? "";
      const form = type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")
        ? await new Response(new Uint8Array(bytes), { headers: { "content-type": type } }).formData() : null;
      if (form) for (const [key, value] of form.entries()) out.set(key, value as string | Blob);
    }
    return out;
  };
  const userOk = (value: unknown) => typeof value === "string" && userTokens.has(value);
  const pageOf = (value: unknown) => (typeof value === "string" ? pageTokens.get(value) ?? null : null);

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push({ method: request.method ?? "GET", path: url.pathname });
    if (url.pathname === "/" && request.method === "GET") return gallery(response);
    const prefix = `/${version}/`;
    if (!url.pathname.startsWith(prefix)) return error(response, 400, 2635, "Unknown API version.");
    const path = url.pathname.slice(prefix.length);
    const input = await params(request, url);
    const access = input.get("access_token");
    if (revoked && path !== "debug_token" && (userOk(access) || pageOf(access))) return error(response, 400, 190, "Error validating access token: The session has been invalidated.", 460);

    if (path === "oauth/access_token" && request.method === "GET") {
      if (input.get("client_id") !== appId || input.get("client_secret") !== appSecret) return error(response, 400, 101, "Error validating client secret.");
      if (input.get("grant_type") !== "fb_exchange_token" || input.get("fb_exchange_token") !== shortToken) return error(response, 400, 190, "Invalid OAuth access token.");
      const long = token("EAALong");
      userTokens.add(long);
      return send(response, 200, { access_token: long, token_type: "bearer", expires_in: 60 * 24 * 60 * 60 });
    }
    if (path === "debug_token" && request.method === "GET") {
      if (access !== `${appId}|${appSecret}`) return error(response, 400, 190, "Invalid app token.");
      const subject = input.get("input_token");
      const known = userOk(subject) || Boolean(pageOf(subject));
      if (!known) return error(response, 400, 190, "Invalid OAuth access token.");
      const now = Math.floor(Date.now() / 1000);
      return send(response, 200, { data: {
        app_id: appId, type: pageOf(subject) ? "PAGE" : "USER", application: "Demo", is_valid: !revoked,
        expires_at: pageOf(subject) ? 0 : now + 60 * 24 * 60 * 60, data_access_expires_at: now + 90 * 24 * 60 * 60, scopes, user_id: "100000000000001",
      } });
    }
    if (path === "me/accounts" && request.method === "GET") {
      if (!userOk(access)) return error(response, 400, 190, "Invalid OAuth access token.");
      if (!scopes.includes("pages_show_list")) return send(response, 200, { data: [] });
      return send(response, 200, { data: pages.map((page) => {
        let pageToken = [...pageTokens.entries()].find(([, owner]) => owner === page.id)?.[0];
        if (!pageToken) { pageToken = token("EAAPage"); pageTokens.set(pageToken, page.id); }
        return { id: page.id, name: page.name, access_token: pageToken, ...(page.instagram ? { instagram_business_account: page.instagram } : {}) };
      }) });
    }
    const pagePhotos = /^(\d+)\/photos$/.exec(path);
    if (pagePhotos && request.method === "POST") {
      if (pageOf(access) !== pagePhotos[1]) return error(response, 400, 190, "Invalid OAuth access token.");
      if (!scopes.includes("pages_manage_posts")) return error(response, 403, 200, "Requires pages_manage_posts permission.");
      const source = input.get("source");
      if (!(source instanceof Blob)) return error(response, 400, 100, "No image.");
      const bytes = Buffer.from(await source.arrayBuffer());
      const photo = id();
      const published = input.get("published") !== "false";
      posts.push({ network: "facebook", target: pagePhotos[1], caption: String(input.get("caption") ?? ""), published, bytes: bytes.byteLength, image: `data:image/jpeg;base64,${bytes.toString("base64")}`, at: new Date().toISOString(), id: photo });
      return send(response, 200, { id: photo, ...(published ? { post_id: `${pagePhotos[1]}_${photo}` } : {}) });
    }
    // A page's story from an unpublished photo of the same page (the photo becomes the story).
    const stories = /^(\d+)\/photo_stories$/.exec(path);
    if (stories && request.method === "POST") {
      if (pageOf(access) !== stories[1]) return error(response, 400, 190, "Invalid OAuth access token.");
      const photo = posts.find((item) => item.id === String(input.get("photo_id") ?? "") && item.network === "facebook" && item.target === stories[1] && !item.published);
      if (!photo) return error(response, 400, 100, "Invalid photo id.");
      const storyId = id();
      Object.assign(photo, { network: "facebook_story", published: true, id: storyId });
      return send(response, 200, { success: true, post_id: storyId });
    }
    const media = /^(\d+)\/media$/.exec(path);
    if (media && request.method === "POST") {
      const owner = pageOf(access);
      if (!owner || pages.find((page) => page.id === owner)?.instagram?.id !== media[1]) return error(response, 400, 190, "Invalid OAuth access token.");
      if (!scopes.includes("instagram_content_publish")) return error(response, 403, 10, "Application does not have permission for this action.");
      const imageUrl = String(input.get("image_url") ?? "");
      const container = id();
      let status = "ERROR";
      let image: string | undefined;
      let bytes = 0;
      try {
        imageUrls.push(imageUrl);
        const fetched = options.fetchImage ? await options.fetchImage(imageUrl) : await fetch(imageUrl, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
        const body = Buffer.from(await fetched.arrayBuffer());
        if (fetched.ok && (fetched.headers.get("content-type") ?? "").startsWith("image/jpeg") && body.byteLength > 1000) { status = "FINISHED"; image = `data:image/jpeg;base64,${body.toString("base64")}`; bytes = body.byteLength; }
      } catch { status = "ERROR"; }
      containers.set(container, { ig: media[1], status, caption: String(input.get("caption") ?? ""), image, bytes, story: input.get("media_type") === "STORIES" });
      return send(response, 200, { id: container });
    }
    const publish = /^(\d+)\/media_publish$/.exec(path);
    if (publish && request.method === "POST") {
      const container = containers.get(String(input.get("creation_id") ?? ""));
      if (!container || container.ig !== publish[1] || !pageOf(access)) return error(response, 400, 100, "Invalid creation id.");
      if (container.status !== "FINISHED") return error(response, 400, 9007, "Media is not ready.");
      if (quota.used >= quota.total) return error(response, 400, 9, "Application request limit reached.");
      container.status = "PUBLISHED";
      quota.used += 1;
      const mediaId = id();
      posts.push({ network: container.story ? "instagram_story" : "instagram", target: publish[1], caption: container.caption, published: true, bytes: container.bytes, image: container.image, at: new Date().toISOString(), id: mediaId });
      return send(response, 200, { id: mediaId });
    }
    const limit = /^(\d+)\/content_publishing_limit$/.exec(path);
    if (limit && request.method === "GET") {
      if (!pageOf(access)) return error(response, 400, 190, "Invalid OAuth access token.");
      return send(response, 200, { data: [{ quota_usage: quota.used, config: { quota_total: quota.total, quota_duration: 86400 } }] });
    }
    const object = /^(\d+)$/.exec(path);
    if (object && request.method === "GET") {
      const container = containers.get(object[1]);
      if (!container || !pageOf(access)) return error(response, 400, 100, "Unsupported get request.");
      return send(response, 200, { status_code: container.status, id: object[1] });
    }
    if (object && request.method === "DELETE") {
      if (!pageOf(access)) return error(response, 400, 190, "Invalid OAuth access token.");
      deleted.push(object[1]);
      const at = posts.findIndex((post) => post.id === object[1]);
      if (at >= 0) posts.splice(at, 1);
      return send(response, 200, { success: true });
    }
    return error(response, 400, 100, "Unsupported request.");
  }

  function gallery(response: ServerResponse) {
    const escape = (value: string) => value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char]!);
    const rows = posts.slice().reverse().map((post) => `<article><h2>${({ facebook: "Facebook", instagram: "Instagram", facebook_story: "Facebook-story", instagram_story: "Instagram-story" })[post.network]} · ${escape(post.target)} · ${post.published ? "publicerat" : "ej publicerat (test)"}</h2>
      ${post.image ? `<img src="${post.image}" alt="">` : ""}<pre>${escape(post.caption)}</pre><p>${escape(post.at)} · id ${escape(post.id)}</p></article>`).join("");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><meta charset="utf-8"><title>Låtsas-Meta</title><style>body{font:15px system-ui;margin:24px;max-width:720px}article{border:1px solid #ccc;border-radius:12px;padding:16px;margin:16px 0}img{width:100%;max-width:540px;border-radius:8px}pre{white-space:pre-wrap;font:inherit}</style>
      <h1>Låtsas-Meta</h1><p>Det här är en ställföreträdare för Facebook och Instagram på den här datorn. Inget här är publicerat på riktigt.</p>${rows || "<p>Inget har publicerats ännu.</p>"}`);
  }

  const server = createServer((request, response) => { handle(request, response).catch(() => error(response, 500, 1, "Fake failure.")); });
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`, appId, appSecret, shortToken, requests, posts, deleted, imageUrls,
    issued: () => [...userTokens, ...pageTokens.keys()],
    revokeAll: () => { revoked = true; },
    setScopes: (next) => { scopes = [...next]; },
    setQuota: (used, total = 50) => { quota = { used, total }; },
    stop: () => new Promise<void>((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
