/**
 * The one question before changes are thrown away (2026-10-13: Avbryt, Bakåt and a swipe ask whenever something
 * is changed; 2026-10-14: the browser's and the phone's own Bakåt ask with the same words – "Lämna arbetsordern? / Lämna
 * utan att spara" is gone). "Fortsätt redigera", never a second "Avbryt" next to the top bar's Avbryt that means the
 * opposite. Lives here, without React, so the leave guards (lib/workflow) and the confirm card (features/kfid/confirm.tsx)
 * share it.
 */
export type DiscardQuestion = { title: string; message: string; confirmLabel: string; cancelLabel: string; tone: "danger" };

export const DISCARD_QUESTION: DiscardQuestion = { title: "Kasta ändringarna?", message: "Det du har skrivit eller valt här sparas inte.", confirmLabel: "Kasta", cancelLabel: "Fortsätt redigera", tone: "danger" };
