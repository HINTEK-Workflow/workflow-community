/**
 * Notisvalen sparas direkt, en i taget och i den ordning de gjordes (mail2, QA 2026-10-24). Varje köad sparning bygger på
 * det senast valda tillståndet, inte på det som syntes när sidan senast ritades: två snabba klick före en omritning
 * skulle annars båda utgå från samma gamla val, och den sista sparningen skriva över den första med inaktuella sorter.
 */
export type NoticeChoice = { email: boolean; kinds: string[]; machineAlarmNight: boolean; requiredNotices?: boolean };
export type NoticeChange =
  | { kind: "email"; on: boolean }
  | { kind: "kind"; key: string; on: boolean }
  | { kind: "night"; on: boolean }
  | { kind: "required"; on: boolean };

/** The choice after one change: a kind is added once (at the end) or removed; e-mail and night are set as given. */
export function applyNoticeChange(current: NoticeChoice, change: NoticeChange): NoticeChoice {
  if (change.kind === "email") return { ...current, email: change.on };
  if (change.kind === "night") return { ...current, machineAlarmNight: change.on };
  if (change.kind === "required") return { ...current, requiredNotices: change.on };
  const others = current.kinds.filter((key) => key !== change.key);
  return { ...current, kinds: change.on ? [...others, change.key] : others };
}

/**
 * The queue of saves for one card. `change(base, change)` builds on the latest choice made here while saves are still on
 * their way (else on `base`, what the page shows), sends the whole choice after the saves before it, and returns the new
 * choice at once (for the page to show) and the save's promise. A failed save does not stop the ones after it; once the
 * queue is empty the page's own answer is the base again.
 */
export function createNoticeSaveQueue(send: (choice: NoticeChoice) => Promise<void>) {
  let latest: NoticeChoice | null = null;
  let pending = 0;
  let chain: Promise<void> = Promise.resolve();
  return {
    change(base: NoticeChoice, change: NoticeChange): { choice: NoticeChoice; done: Promise<void> } {
      const choice = applyNoticeChange(latest ?? base, change);
      latest = choice;
      pending += 1;
      const done = chain.then(() => send(choice)).finally(() => {
        pending -= 1;
        if (pending === 0) latest = null;
      });
      chain = done.catch(() => undefined);
      return { choice, done };
    },
    /** Resolves when every save made so far has been answered (after a failed one the page is read again then). */
    idle(): Promise<void> { return chain; },
  };
}
