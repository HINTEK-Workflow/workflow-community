/**
 * Arbetsordern som hållare (2026-10-30): how a task page saves its work order's changes (features/workflow/
 * use-holder-work-order.ts). Användartest 2026-10-31, fel 1: "Arbetsordern sparades inte: Uppgiften har ändrats" was shown
 * although the change was saved. Two saves of the same changes ran at once – the one a moment after typing and the one
 * Spara starts first – from the same version; the first was saved and the second was refused. The saves now run one at a
 * time, and a save that finds nothing left to send does nothing.
 */

/** Runs the jobs one at a time, in the order they were given; a failed job does not stop the ones after it. */
export function createSerialRunner() {
  let chain: Promise<unknown> = Promise.resolve();
  return function run<T>(job: () => Promise<T>): Promise<T> {
    const result = chain.then(job, job);
    chain = result.then(() => undefined, () => undefined);
    return result;
  };
}

const conflict = (issue: unknown) => (issue as { status?: number } | null)?.status === 409;

/**
 * Sends the changes on the newest saved order known (else read now). Someone saved the order in between (409): it is read
 * again and the same changes are put on that version, once.
 */
export async function saveOnNewest<R>({ known, read, send, retry = true }: {
  known: R | null | undefined;
  read: () => Promise<R>;
  send: (base: R) => Promise<unknown>;
  /** False where there is no version to meet (the local edition). */
  retry?: boolean;
}): Promise<void> {
  const base = known ?? await read();
  try { await send(base); }
  catch (issue) {
    if (!retry || !conflict(issue)) throw issue;
    await send(await read());
  }
}
