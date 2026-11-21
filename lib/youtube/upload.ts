import { retryable, startResumable, uploadChunk, uploadStatus, YouTubeError, type UploadedVideo, type VideoMetadata, type YouTubeTransport } from "./api";
import { YOUTUBE_CHUNK_BYTES } from "./model";

/**
 * Filmer (2026-11-20): the resumable upload to YouTube, with the database, the file and the transport given from outside
 * (lib/youtube/videos-server.ts gives the real ones; the tests their own).
 *
 * - The session's address and how far YouTube has the file are saved after every piece, so a stopped server, a lost connection
 *   or the job's time running out picks up where YouTube is: the next run asks YouTube (Content-Range bytes * /total) before it
 *   sends more.
 * - A session YouTube no longer knows (404/410, a session lives about a week) starts again from the beginning, once per run.
 * - A failure that may pass by itself (the network, Google's servers, a rate, the day's quota) is tried again after 1, 5, 15, 45
 *   and 120 minutes; anything else fails at once with its reason.
 */
export const MAX_UPLOAD_ATTEMPTS = 6;
const BACKOFF_MINUTES = [1, 5, 15, 45, 120];
/** The day's quota fills at midnight Pacific time: no sooner than an hour. */
const QUOTA_WAIT_MINUTES = 60;

/** When a failed attempt is tried again, or null when it was the last. `attempts` counts the attempt just made. Pure. */
export function nextUploadAttempt(attempts: number, error: unknown, now = new Date()): Date | null {
  if (attempts >= MAX_UPLOAD_ATTEMPTS || !retryable(error)) return null;
  const minutes = Math.max(BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 1, error instanceof YouTubeError && error.kind === "quota" ? QUOTA_WAIT_MINUTES : 0);
  return new Date(now.getTime() + minutes * 60_000);
}

/** The piece to send from `offset`: 8 MiB, or what is left. Pure. */
export function nextPiece(offset: number, total: number, size = YOUTUBE_CHUNK_BYTES): { start: number; length: number } | null {
  if (offset >= total) return null;
  return { start: offset, length: Math.min(size, total - offset) };
}

export type UploadDeps = {
  transport: YouTubeTransport;
  /** A working access token (renewed when it is about to end). */
  token(): Promise<string>;
  /** `length` bytes of the stored film from `start`. */
  read(start: number, length: number): Promise<Uint8Array>;
  /** Saves the session's address (null: none) and how far YouTube has the file. */
  save(progress: { session: string | null; offset: number }): Promise<void>;
  /** Whether the run should stop and let the next one go on (its time is out, or the film was taken back). */
  stop(): Promise<boolean> | boolean;
};
export type UploadInput = { session: string | null; offset: number; total: number; type: string; meta: VideoMetadata };
export type UploadResult = { kind: "done"; video: UploadedVideo } | { kind: "paused"; offset: number };

/** One run of the upload: from where YouTube is to the end, or until `stop` says so. Throws YouTubeError for the caller to settle. */
export async function runUpload(deps: UploadDeps, input: UploadInput): Promise<UploadResult> {
  let session = input.session;
  let offset = input.offset;
  let restarted = false;
  let stalled = 0;
  const begin = async () => {
    session = await startResumable(deps.transport, await deps.token(), { meta: input.meta, size: input.total, type: input.type });
    offset = 0;
    await deps.save({ session, offset });
  };
  if (!session) await begin();
  else {
    // A session from an earlier run: ask how far YouTube came before anything is sent again.
    try {
      const status = await uploadStatus(deps.transport, session, await deps.token(), input.total);
      if (status.done) return { kind: "done", video: status.video };
      offset = status.received;
      await deps.save({ session, offset });
    } catch (error) {
      if (!(error instanceof YouTubeError && error.kind === "session")) throw error;
      restarted = true;
      await begin();
    }
  }
  for (;;) {
    if (await deps.stop()) return { kind: "paused", offset };
    const piece = nextPiece(offset, input.total);
    // Everything sent but no answer with the video: ask once more.
    if (!piece) {
      const status = await uploadStatus(deps.transport, session!, await deps.token(), input.total);
      if (status.done) return { kind: "done", video: status.video };
      stalled += 1;
      if (stalled >= 3) throw new YouTubeError("YouTube tar inte emot filen. Uppladdningen försöker igen om en stund.", "other", 502);
      offset = status.received;
      continue;
    }
    const bytes = await deps.read(piece.start, piece.length);
    try {
      const answer = await uploadChunk(deps.transport, session!, await deps.token(), { bytes, start: piece.start, total: input.total, type: input.type });
      if (answer.done) return { kind: "done", video: answer.video };
      // YouTube says how much it has; it may be less than was sent, and the next piece starts there.
      stalled = answer.received <= piece.start ? stalled + 1 : 0;
      if (stalled >= 3) throw new YouTubeError("YouTube tar inte emot filen. Uppladdningen försöker igen om en stund.", "other", 502);
      offset = answer.received;
      await deps.save({ session, offset });
    } catch (error) {
      if (error instanceof YouTubeError && error.kind === "session" && !restarted) { restarted = true; await begin(); continue; }
      throw error;
    }
  }
}

export { uploadPercent } from "./model";
