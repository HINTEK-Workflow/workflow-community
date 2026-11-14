"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SESSION_BACK_EVENT, setSignedOutHandler } from "@/features/kfid/api";
import { Modal } from "@/features/kfid/ui";
import { sessionBackHref, signInHere } from "@/lib/auth/session-return";

/** Who the browser is signed in as now: the id, null for nobody, undefined when the answer could not be read. */
async function sessionUserId(): Promise<string | null | undefined> {
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    if (!response.ok) return undefined;
    const session = await response.json() as { user?: { id?: string } } | null;
    return session?.user?.id ?? null;
  } catch { return undefined; }
}

const CHECK_EVERY_MS = 3000;

/**
 * Utloggad mitt i arbetet (the session ended: its time ran out, or the person was signed out elsewhere): rendered once in the
 * workspace. When a request answers 401 and the session really is gone, this card offers sign-in in a new tab, so this page
 * and everything typed on it stay as they are. When the session is back the card closes and open editors save again
 * (SESSION_BACK_EVENT). Someone else signing in there must not save this person's work, so the page then asks for a reload.
 * Where a new tab is not possible (an installed app, a blocked popup) the sign-in happens here and returns to this address; the
 * task editor's browser draft is restored there.
 */
export function SessionExpiredHost({ userId }: { userId?: string }) {
  const [state, setState] = useState<"closed" | "signed-out" | "someone-else">("closed");
  const [waiting, setWaiting] = useState(false);
  const checking = useRef(false);

  const signedOut = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    // A 401 is only believed once the session itself says so: some routes answer 401 for their own reasons.
    if ((await sessionUserId()) === null) setState((current) => (current === "closed" ? "signed-out" : current));
    checking.current = false;
  }, []);

  useEffect(() => {
    setSignedOutHandler(() => void signedOut());
    return () => setSignedOutHandler(null);
  }, [signedOut]);

  useEffect(() => {
    if (state !== "signed-out") return;
    const look = async () => {
      const now = await sessionUserId();
      if (!now) return;
      setWaiting(false);
      if (userId && now !== userId) { setState("someone-else"); return; }
      setState("closed");
      window.dispatchEvent(new Event(SESSION_BACK_EVENT));
    };
    const timer = window.setInterval(() => void look(), CHECK_EVERY_MS);
    window.addEventListener("focus", look);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", look); };
  }, [state, userId]);

  function signIn() {
    const installed = window.matchMedia?.("(display-mode: standalone)").matches;
    const tab = installed ? null : window.open(sessionBackHref(), "_blank");
    if (tab) setWaiting(true);
    else window.location.assign(signInHere(window.location.pathname, window.location.search));
  }

  if (state === "someone-else") return <Modal open onOpenChange={() => undefined} title="Inloggad som någon annan" size="compact">
    <div className="space-y-4" data-testid="session-expired-other">
      <p className="text-sm">Du loggade in med ett annat konto. Ladda om sidan för att fortsätta. Osparade ändringar sparas inte på det kontot.</p>
      <div className="flex justify-end"><Button type="button" onClick={() => window.location.reload()}>Ladda om sidan</Button></div>
    </div>
  </Modal>;
  return <Modal open={state === "signed-out"} onOpenChange={(open) => { if (!open) { setState("closed"); setWaiting(false); } }} title="Du är utloggad" size="compact">
    <div className="space-y-4" data-testid="session-expired">
      <p className="text-sm">{waiting ? "Logga in i den nya fliken. Den här sidan fortsätter när du är klar." : "Det du har skrivit finns kvar på sidan. Logga in igen, så sparas det."}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => { setState("closed"); setWaiting(false); }}>Stäng</Button>
        <Button type="button" onClick={signIn} data-testid="session-expired-sign-in">{waiting ? "Öppna inloggningen igen" : "Logga in"}</Button>
      </div>
    </div>
  </Modal>;
}
