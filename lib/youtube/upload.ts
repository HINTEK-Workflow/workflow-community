import { retryable, startResumable, uploadChunk, uploadStatus, YouTubeError, type ChunkAnswer, type UploadedVideo, type VideoMetadata, type YouTubeTransport } from "./api";
import { YOUTUBE_CHUNK_BYTES } from "./model";

/**
 * Filmer (2026-11-20): the resumable upload to YouTube, with the database, the file and the transport given from outside
 * (lib/youtube/videos-server.ts gives the real ones; the tests their own).
 *
 * - The session's address and how far YouTube has the file are saved after every piece, so a stopped server, a lost connection
 *   or the job's time running out picks up where YouTube is: the next run asks YouTube (Content-Range bytes * /total) before it
 *   sends more.
 * - Within a run (2026-11-25): a piece that gets no answer, a broken connection or a 5xx from YouTube is sent again after 1, 2, 4,
 *   8 and 15 seconds, up to five times in a row. Before it is sent again YouTube is asked how far it has the file, and the upload
 *   goes on from the byte YouTube confirms – so a piece that did arrive (only its answer was lost) is not sent twice. YouTube's own
 *   guide for resumable uploads says the same: on a 5xx or a lost connection, ask for the status and resume.
 * - A session YouTube no longer knows (404/410, a session lives about a week) starts again from the beginning, once per run.
 * - A failure that may pass by itself (the network, Google's servers, a rate, the day's quota) and outlasts the retries above is
 *   tried again by the job after 1, 5, 15, 45 and 120 minutes; anything else fails at once with its reason.
 */
export const MAX_UPLOAD_ATTEMPTS = 6;
const BACKOFF_MINUTES = [1, 5, 15, 45, 120];
/** The day's quota fills at midnight Pacific time: no sooner than an hour. */
const QUOTA_WAIT_MINUTES = 60;
/** How many times in a row a piece (or the status question) is tried again within one run. */
export const PIECE_RETRIES = 5;
/** The wait before the next try within a run: 1, 2, 4, 8 and 15 seconds. Pure. */
export const pieceRetryDelay = (attempt: number) => Math.min(15_000, 1000 * 2 ** Math.max(0, attempt - 1));
/** A lost connection, a timeout or Google's server error: worth sending again in a few seconds. A rate or the quota waits for the job. Pure. */
export const pieceRetryable = (error: unknown) => error instanceof YouTubeError && error.kind !== "quota" && error.kind !== "rate" && (error.kind === "network" || error.status >= 500);

/** When a failed attempt is tried again, or null when it was the last. `attempts` counts the attempt just made. Pure. */
export function nextUploadAttempt(attempts: number, error: unknown, now = new Date()): Date | null {
  if (attempts >= MAX_UPLOAD_ATTEMPTS || !retryable(error)) return null;
  const minutes = Math.max(BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 1, error instanceof YouTubeError && error.kind === "quota" ? QUOTA_WAIT_MINUTES : 0);
  return new Date(now.getTime() + minutes * 60_000);
}

/** The piece to send from `offset`: 2 MiB, or what is left. Pure. */
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
  /** The wait between tries within a run (the tests give one that does not wait). */
  wait?: (ms: number) => Promise<void>;
};
export type UploadInput = { session: string | null; offset: number; total: number; type: string; meta: VideoMetadata };
export type UploadResult = { kind: "done"; video: UploadedVideo } | { kind: "paused"; offset: number };

const STUCK = "YouTube tar inte emot filen. Uppladdningen försöker igen om en stund.";

/** One run of the upload: from where YouTube is to the end, or until `stop` says so. Throws YouTubeError for the caller to settle. */
export async function runUpload(deps: UploadDeps, input: UploadInput): Promise<UploadResult> {
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let session = input.session;
  let offset = input.offset;
  let restarted = false;
  let stalled = 0;
  let failures = 0;
  const begin = async () => {
    session = await startResumable(deps.transport, await deps.token(), { meta: input.meta, size: input.total, type: input.type });
    offset = 0;
    await deps.save({ session, offset });
  };
  /** A failure that passes in a few seconds is waited out (up to PIECE_RETRIES in a row); anything else is thrown. */
  const hiccup = async (error: unknown) => {
    if (!pieceRetryable(error) || ++failures > PIECE_RETRIES) throw error;
    await wait(pieceRetryDelay(failures));
  };
  /** How far YouTube has the file, asked again through hiccups. */
  const status = async (): Promise<ChunkAnswer> => {
    for (;;) {
      try { return await uploadStatus(deps.transport, session!, await deps.token(), input.total); }
      catch (error) { if (error instanceof YouTubeError && error.kind === "session") throw error; await hiccup(error); }
    }
  };
  if (!session) await begin();
  else {
    // A session from an earlier run: ask how far YouTube came before anything is sent again.
    try {
      const answer = await status();
      if (answer.done) return { kind: "done", video: answer.video };
      offset = answer.received;
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
    try {
      // Everything sent but no answer with the video: ask once more.
      if (!piece) {
        const answer = await status();
        if (answer.done) return { kind: "done", video: answer.video };
        stalled += 1;
        if (stalled >= 3) throw new YouTubeError(STUCK, "other", 502);
        offset = answer.received;
        continue;
      }
      const bytes = await deps.read(piece.start, piece.length);
      let answer: ChunkAnswer;
      try { answer = await uploadChunk(deps.transport, session!, await deps.token(), { bytes, start: piece.start, total: input.total, type: input.type }); }
      catch (error) {
        if (error instanceof YouTubeError && error.kind === "session") throw error;
        await hiccup(error);
        // Before the piece is sent again: how much YouTube has, so the upload goes on from the byte YouTube confirms.
        const known = await status();
        if (known.done) return { kind: "done", video: known.video };
        offset = known.received;
        // Saved also when nothing changed: it keeps the run's claim on the film while it waits out the hiccup.
        await deps.save({ session, offset });
        continue;
      }
      failures = 0;
      if (answer.done) return { kind: "done", video: answer.video };
      // YouTube says how much it has; it may be less than was sent, and the next piece starts there.
      stalled = answer.received <= piece.start ? stalled + 1 : 0;
      if (stalled >= 3) throw new YouTubeError(STUCK, "other", 502);
      offset = answer.received;
      await deps.save({ session, offset });
    } catch (error) {
      if (error instanceof YouTubeError && error.kind === "session" && !restarted) { restarted = true; failures = 0; await begin(); continue; }
      throw error;
    }
  }
}

export { uploadPercent } from "./model";
