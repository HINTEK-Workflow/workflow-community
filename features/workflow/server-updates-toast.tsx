"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { api } from "@/features/kfid/api";
import { indicatorBadge, indicatorText } from "@/features/workflow/indicator-tone";
import { SERVER_UPDATES_HREF, serverToastDue, serverUpdateToastText, type ServerView } from "@/lib/ops/host-status";
import { cn } from "@/lib/utils";

/** What this browser remembers: the sign-in (its time) whose notice was closed. */
const CLOSED_KEY = "hwf-server-updates-toast";
const closedLogin = () => { try { return window.localStorage.getItem(CLOSED_KEY); } catch { return null; } };
const rememberClosed = (login: string) => { try { window.localStorage.setItem(CLOSED_KEY, login); } catch { /* it may come again after a reload */ } };

export type ServerUpdatesNoticeState = { text: string; close: () => void } | null;

/**
 * Serveruppdateringar väntar (2026-11-06: "en toast som ligger i toppen på sidan som påminner varje gång att det finns
 * uppdatering, när jag loggat in"): once per sign-in, for the superadmin only (the server checks the role again), read from the
 * same status files as Servrar och uppdateringar. It stays until it is closed or Visa is chosen. Read once in the workspace, so
 * a new page does not ask again.
 */
export function useServerUpdatesNotice(enabled: boolean): ServerUpdatesNoticeState {
  const [shown, setShown] = useState<{ text: string; login: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void api<{ servers: ServerView[]; login: string | null }>("/api/superadmin/server-updates", { cache: "no-store", signal: controller.signal })
      .then((data) => {
        const text = serverUpdateToastText(data.servers);
        if (text && data.login && serverToastDue({ role: "SUPERADMIN", text, login: data.login, closed: closedLogin() })) setShown({ text, login: data.login });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [enabled]);
  if (!enabled || !shown) return null;
  return { text: shown.text, close: () => { rememberClosed(shown.login); setShown(null); } };
}

/**
 * The notice itself: a line in the page under its heading (2026-11-12: as a toast at the top right it covered the head's
 * buttons, Inlägg's Nytt inlägg), so it never lies over the page; closed with its cross.
 */
export function ServerUpdatesNotice({ notice }: { notice: NonNullable<ServerUpdatesNoticeState> }) {
  const router = useRouter();
  return <div role="status" data-testid="server-updates-toast" data-placement="inline"
    className={cn("mb-4 flex items-start gap-3 rounded-lg border px-3 py-2", indicatorBadge("warning"))}>
    <AlertCircle className={cn("mt-1 size-4 shrink-0", indicatorText("warning"))} aria-hidden="true" />
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
      <p className="min-w-0 flex-1 basis-60 text-sm leading-6 text-foreground">{notice.text}</p>
      <Button type="button" size="sm" variant="outline" data-testid="server-updates-toast-show" onClick={() => { notice.close(); router.push(SERVER_UPDATES_HREF); }}>Visa</Button>
    </div>
    <IconButton label="Stäng meddelande" onClick={notice.close}><X /></IconButton>
  </div>;
}
