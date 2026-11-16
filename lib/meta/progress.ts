/**
 * Publiceringens förlopp (2026-11-15, built 2026-11-16): Testpublicering and Publicera run on the server step by step –
 * the picture, then each channel – and the steps are kept with the post (SocialPost.publishProgress), so the page shows what is
 * happening, what was sent and what failed, also when it is opened again later. Avbryt stops every step not yet begun; what was
 * already published stays published and is named. Pure: the server and the page read the same rules.
 */
export type StepKey = "image" | "facebook" | "instagram" | "facebookStory" | "instagramStory" | "linkedin" | "newsletter";
export type StepStatus = "waiting" | "running" | "done" | "failed" | "cancelled";
export type ProgressStep = { key: StepKey; status: StepStatus; detail: string | null };
export type PublishProgress = {
  mode: "test" | "live";
  running: boolean;
  startedAt: string;
  finishedAt: string | null;
  cancelRequested: boolean;
  steps: ProgressStep[];
  /** The summary once finished (the same text the result has). */
  message: string | null;
};

export const STEP_LABEL: Record<StepKey, string> = {
  image: "Ritar bilden", facebook: "Facebook", instagram: "Instagram", facebookStory: "Story på Facebook", instagramStory: "Story på Instagram",
  linkedin: "LinkedIn", newsletter: "Nyhetsbrev",
};
export const STEP_ORDER: readonly StepKey[] = ["image", "facebook", "instagram", "facebookStory", "instagramStory", "linkedin", "newsletter"];
/** The channels (the steps that send something somewhere). */
export const CHANNEL_STEPS: readonly StepKey[] = STEP_ORDER.filter((key) => key !== "image");

/** A run still marked running after this long was cut off (the server restarted): it is shown as stopped. */
export const STALE_MS = 15 * 60_000;
export const STOPPED_MESSAGE = "Publiceringen avbröts innan den var klar (servern startades om). Kontrollera kanalerna innan du försöker igen.";

export function initialProgress(mode: "test" | "live", channels: readonly StepKey[], now = new Date()): PublishProgress {
  const keys = STEP_ORDER.filter((key) => key === "image" || channels.includes(key));
  return { mode, running: true, startedAt: now.toISOString(), finishedAt: null, cancelRequested: false, steps: keys.map((key) => ({ key, status: "waiting", detail: null })), message: null };
}

export function setStep(progress: PublishProgress, key: StepKey, status: StepStatus, detail: string | null = null): PublishProgress {
  return { ...progress, steps: progress.steps.map((step) => (step.key === key ? { ...step, status, detail } : step)) };
}

/** Avbryt: every step that has not begun is cancelled. */
export const cancelWaiting = (progress: PublishProgress): PublishProgress =>
  ({ ...progress, steps: progress.steps.map((step) => (step.status === "waiting" ? { ...step, status: "cancelled", detail: "Avbrutet, inget skickades." } : step)) });

/** "A", "A och B", "A, B och C". */
const listed = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} och ${names[names.length - 1]}` : names[0] ?? "");

/** What an Avbryt left: what was sent, and what was not. */
export function cancelSummary(progress: PublishProgress): string {
  const channels = progress.steps.filter((step) => step.key !== "image");
  const sent = listed(channels.filter((step) => step.status === "done").map((step) => STEP_LABEL[step.key]));
  const stopped = listed(channels.filter((step) => step.status === "cancelled").map((step) => STEP_LABEL[step.key]));
  const test = progress.mode === "test";
  return [
    test ? "Testpubliceringen avbröts." : "Publiceringen avbröts.",
    sent ? (test ? `Redan provat: ${sent}.` : `Redan publicerat: ${sent} – det ligger kvar.`) : (test ? "" : "Inget hann publiceras."),
    stopped ? `Inte skickat: ${stopped}.` : "",
  ].filter(Boolean).join(" ");
}

export function finishProgress(progress: PublishProgress, message: string, now = new Date()): PublishProgress {
  const steps = progress.steps.map((step) => (step.status === "running" || step.status === "waiting" ? { ...step, status: "cancelled" as const, detail: step.detail ?? "Inte försökt." } : step));
  return { ...progress, steps, running: false, finishedAt: now.toISOString(), message };
}

const STATUSES: readonly StepStatus[] = ["waiting", "running", "done", "failed", "cancelled"];
/** The stored value as a progress, or null; a run left running too long is shown as stopped. */
export function progressOf(value: unknown, now = Date.now()): PublishProgress | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<PublishProgress>;
  if ((entry.mode !== "test" && entry.mode !== "live") || typeof entry.startedAt !== "string" || !Array.isArray(entry.steps)) return null;
  const steps = entry.steps.flatMap((step) => (step && STEP_ORDER.includes(step.key) && STATUSES.includes(step.status)
    ? [{ key: step.key, status: step.status, detail: typeof step.detail === "string" ? step.detail : null }] : []));
  const progress: PublishProgress = {
    mode: entry.mode, running: entry.running === true, startedAt: entry.startedAt, finishedAt: typeof entry.finishedAt === "string" ? entry.finishedAt : null,
    cancelRequested: entry.cancelRequested === true, steps, message: typeof entry.message === "string" ? entry.message : null,
  };
  const started = Date.parse(progress.startedAt);
  if (progress.running && (!Number.isFinite(started) || now - started > STALE_MS)) return finishProgress(progress, STOPPED_MESSAGE, new Date(now));
  return progress;
}
