import { VIDEO_CHUNK_BYTES, type VideoView } from "./model";

/**
 * Filmer (2026-11-25): the browser sends a film to our own server in pieces of 2 MB, each as the request's raw body, the same way
 * as the landing page's films since 0.85.0 (ee/landing/ui/film-upload.ts). No server code here; the page gives the request.
 *
 * When the network or the server hiccups: a piece that times out, a broken connection or a 5xx is sent again after 1, 2, 4, 8 and
 * 15 seconds, up to five times in a row, and `notice` tells the person meanwhile. Before it is sent again the server is asked how
 * far the upload has come, so a piece that did arrive (only its answer was lost) is not sent twice and the upload goes on from
 * where the server is – also when the server answers 409 with how much it has. An upload the server no longer has starts over.
 */
export const VIDEO_UPLOAD_RETRIES = 5;
/** A piece without an answer for this long is sent again (nginx gives up after 60 s and answers 504 itself). */
export const VIDEO_PIECE_TIMEOUT_MS = 75_000;
export const VIDEO_RETRY_NOTICE = "Nätverket hackar, försöker igen …";
export const VIDEO_UPLOAD_GAVE_UP = "Uppladdningen avbröts: servern svarade inte efter flera försök. Försök igen om en stund.";
export const VIDEO_UPLOAD_STOPPED = "Uppladdningen avbröts.";
/** The wait before the next try: 1, 2, 4, 8 and 15 seconds. Pure. */
export const videoRetryDelay = (attempt: number) => Math.min(15_000, 1000 * 2 ** Math.max(0, attempt - 1));

export type PieceAnswer = { done: boolean; upload?: string; received?: number; video?: VideoView };
type Failure = Error & { status?: number; details?: { received?: unknown } };
/** A broken connection, a timeout (status 0) or a server that does not answer is tried again; a refusal is not. Pure. */
export const pieceTryAgain = (status: number) => status === 0 || status === 408 || status === 429 || status >= 500;

export type VideoUploadDeps = {
  /** One request to /api/youtube/videos; throws an Error with `status` and `details` (features/kfid/api.ts) when it is refused. */
  request: (url: string, init: RequestInit) => Promise<PieceAnswer>;
  wait?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};
const ADDRESS = "/api/youtube/videos";

/** Sends the film; `progress` hears the share the server has (0–1). The answer is the film as stored. */
export async function uploadVideoFile(id: string, file: Blob & { name?: string }, deps: VideoUploadDeps, hooks: {
  progress?: (share: number) => void; notice?: (text: string) => void; stopped?: () => boolean;
} = {}): Promise<VideoView> {
  const progress = hooks.progress ?? (() => undefined);
  const notice = hooks.notice ?? (() => undefined);
  const stopped = hooks.stopped ?? (() => false);
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = deps.timeoutMs ?? VIDEO_PIECE_TIMEOUT_MS;
  const timed = async (url: string, init: RequestInit) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await deps.request(url, { ...init, signal: controller.signal }); } finally { clearTimeout(timer); }
  };
  let upload = "";
  let offset = 0;
  let failures = 0;
  const giveUp = () => { notice(""); return new Error(VIDEO_UPLOAD_GAVE_UP); };
  const shown = () => progress(file.size ? Math.min(1, offset / file.size) : 1);
  for (;;) {
    if (stopped()) { notice(""); throw new Error(VIDEO_UPLOAD_STOPPED); }
    let answer: PieceAnswer;
    try {
      const query = new URLSearchParams({ id, upload, offset: String(offset), total: String(file.size), name: file.name ?? "" });
      answer = await timed(`${ADDRESS}?${query}`, { method: "POST", body: file.slice(offset, offset + VIDEO_CHUNK_BYTES), headers: { "Content-Type": "application/octet-stream" } });
    } catch (error) {
      const status = (error as Failure).status ?? 0;
      const received = (error as Failure).details?.received;
      if ((status === 409 || status === 404) && typeof received === "number") {
        // The server has another amount than the page thought: go on from there (0 = it has nothing, start over).
        if (++failures > VIDEO_UPLOAD_RETRIES) throw giveUp();
        if (received === 0) upload = "";
        offset = received;
        shown();
        continue;
      }
      if (!pieceTryAgain(status)) { notice(""); throw error; }
      if (++failures > VIDEO_UPLOAD_RETRIES) throw giveUp();
      notice(VIDEO_RETRY_NOTICE);
      await wait(videoRetryDelay(failures));
      if (upload) {
        try {
          const state = await timed(`${ADDRESS}?${new URLSearchParams({ id, upload })}`, { method: "GET" });
          if (state.done && state.video) { progress(1); notice(""); return state.video; }
          if (typeof state.received === "number") offset = state.received;
        } catch (asked) {
          // The server no longer has it: start over. Any other trouble: the same piece again (written at its place, so harmless).
          if ((asked as Failure).status === 404) { upload = ""; offset = 0; }
        }
        shown();
      }
      continue;
    }
    failures = 0;
    notice("");
    if (answer.done && answer.video) { progress(1); return answer.video; }
    if (!answer.upload || typeof answer.received !== "number" || answer.received <= offset) throw new Error("Uppladdningen blev inte klar. Försök igen.");
    upload = answer.upload;
    offset = answer.received;
    shown();
  }
}
