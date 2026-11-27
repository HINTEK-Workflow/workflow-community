"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Link2Off } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { secretFromHash } from "@/lib/boards/screens";
import { BoardPlayer, useFeedLoop, type PlayerFeed } from "./board-player";

/**
 * Delningslänk (Tavlor och skärmar etapp 2, 2026-11-18; plan 6.4): /visa#k=… The secret is read from the address's #-part (which the
 * browser never sends anywhere), sent once by POST and swapped for a session cookie for /visa; then the #-part is removed from the
 * address. With a code the visitor is asked for it first. The board plays like on a screen, in the dark theme unless the device is light.
 */
type Feed = PlayerFeed & { name: string };
class FetchError extends Error { constructor(public status: number, message: string, public needCode = false) { super(message); } }

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => ({})) as { error?: string; needCode?: boolean };
  if (!response.ok) throw new FetchError(response.status, body.error || "Ingen kontakt med Workflow.", Boolean(body.needCode));
  return body as T;
}
const imageUrl = (id: string) => `/visa/api/image?id=${encodeURIComponent(id)}`;

export function LinkApp() {
  const [opened, setOpened] = useState<"checking" | "open" | "code" | "closed">("checking");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.theme = window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }, []);
  const open = useCallback(async (key: string, withCode?: string) => {
    setBusy(true);
    try {
      await json("/visa/api/open", { method: "POST", body: JSON.stringify({ k: key, ...(withCode ? { code: withCode } : {}) }) });
      window.history.replaceState(null, "", "/visa");
      setOpened("open");
      setError("");
    } catch (cause) {
      const failure = cause as FetchError;
      if (failure.needCode) { setOpened("code"); setError(withCode ? failure.message : ""); }
      else { setOpened("closed"); setError(failure.message); }
    } finally { setBusy(false); }
  }, []);
  useEffect(() => {
    const key = secretFromHash(window.location.hash);
    queueMicrotask(() => {
      if (key) { setSecret(key); void open(key); }
      // No secret in the address: a session from before may still be open (a reload).
      else setOpened("open");
    });
  }, [open]);
  if (opened === "checking") return <Shell><p className="text-muted-foreground">Öppnar länken…</p></Shell>;
  if (opened === "closed") return <Shell><Link2Off className="size-10 text-muted-foreground" aria-hidden="true" /><h1 className="text-xl font-bold">Länken kan inte visas</h1><p className="text-muted-foreground">{error}</p></Shell>;
  if (opened === "code") return <Shell>
    <KeyRound className="size-10 text-primary" aria-hidden="true" />
    <h1 className="text-xl font-bold">Skriv koden</h1>
    <p className="text-muted-foreground">Den som delade tavlan har gett dig en kod.</p>
    <form className="flex w-full max-w-xs flex-col gap-3" onSubmit={(event) => { event.preventDefault(); if (secret) void open(secret, code); }}>
      <label htmlFor="link-code" className="sr-only">Kod</label>
      <Input id="link-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 10))} className="text-center text-lg tracking-widest" data-testid="link-code" />
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" busy={busy} busyLabel="Öppnar…" disabled={code.length < 6}>Visa tavlan</Button>
    </form>
  </Shell>;
  return <LinkPlayer onClosed={(message) => { setOpened("closed"); setError(message); }} />;
}

function LinkPlayer({ onClosed }: { onClosed: (message: string) => void }) {
  const read = useCallback(() => json<Feed>("/visa/api/feed"), []);
  const live = useFeedLoop(read, 30_000, { isFinal: (error) => error instanceof FetchError && error.status === 401 });
  useEffect(() => { if (live.final) onClosed("Länken har gått ut, är spärrad eller har inte öppnats. Öppna länken du fick igen."); }, [live.final, onClosed]);
  return <BoardPlayer feed={live.data} imageUrl={imageUrl} lostSince={live.lostSince} onReload={() => void live.refresh()} title={live.data?.name} testId="link-player" />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background p-6 text-center text-foreground">{children}</main>;
}
