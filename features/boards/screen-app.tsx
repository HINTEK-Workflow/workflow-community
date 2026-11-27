"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Monitor } from "lucide-react";
import { nextNightlyReload } from "@/lib/boards/player";
import type { ScreenSettings } from "@/lib/boards/screens";
import { BoardPlayer, useFeedLoop, type PlayerFeed } from "./board-player";

/**
 * Kopplad skärm (Tavlor och skärmar etapp 2, 2026-11-18; plan 7): what a TV or a kiosk browser shows at /skarm. With its screen key it
 * plays its boards at once; without one it shows a code and a QR code to connect it in Workflow, and asks every few seconds whether
 * it has been approved (a new code every ten minutes, so nobody has to touch the TV). It talks only to its own Workflow server, keeps
 * the screen awake, reloads itself once a night at the chosen hour and follows orders from Skärmar (reload, identify). Its own pages fill the\n * screen exactly (fixed, no scrolling) from an iPad to a 4K tv (2026-11-19).
 */
type Feed = PlayerFeed & { screen: { name: string; settings: ScreenSettings }; command: "reload" | "identify" | null };
type Pairing = { code: string; expiresAt: string; interval: number; qr: string; address: string };
class FetchError extends Error { constructor(public status: number, message: string) { super(message); } }

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new FetchError(response.status, (body as { error?: string }).error || "Ingen kontakt med Workflow.");
  return body as T;
}

const imageUrl = (id: string) => `/skarm/api/image?id=${encodeURIComponent(id)}`;

export function ScreenApp({ version }: { version: string }) {
  const [paired, setPaired] = useState<boolean | null>(null);
  const [identify, setIdentify] = useState<string | null>(null);
  const read = useCallback(() => json<Feed>(`/skarm/api/feed?w=${window.screen.width}&h=${window.screen.height}&v=${encodeURIComponent(version)}`), [version]);
  const live = useFeedLoop(read, 30_000, { isFinal: (error) => error instanceof FetchError && (error.status === 401 || error.status === 423) });
  const final = live.final instanceof FetchError ? live.final : null;
  useEffect(() => {
    if (live.data) queueMicrotask(() => setPaired(true));
    else if (final?.status === 401) queueMicrotask(() => setPaired(false));
  }, [live.data, final]);
  // The theme of the screen (Mörkt unless chosen), on the page itself.
  const theme = live.data?.screen.settings.theme ?? "dark";
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  // Orders from Skärmar, each taken once.
  const command = live.data?.command;
  const at = live.data?.at;
  useEffect(() => {
    if (!command) return;
    if (command === "reload") { window.location.reload(); return; }
    queueMicrotask(() => setIdentify(live.data?.screen.name ?? "Skärm"));
    const timer = window.setTimeout(() => setIdentify(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [command, at, live.data?.screen.name]);
  // Once a night at the chosen hour (the device's own clock), against memory leaks in TV browsers.
  const reloadHour = live.data?.screen.settings.reloadHour;
  useEffect(() => {
    if (reloadHour === null || reloadHour === undefined) return;
    const timer = window.setTimeout(() => window.location.reload(), Math.max(60_000, nextNightlyReload(new Date(), reloadHour) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [reloadHour]);
  if (final?.status === 423) return <Message title="Skärmen visar inget just nu" text={final.message} />;
  if (paired === false) return <PairingView onReady={() => { setPaired(null); window.location.reload(); }} />;
  return <BoardPlayer feed={live.data} imageUrl={imageUrl} lostSince={live.lostSince} onReload={() => window.location.reload()} title={live.data?.screen.name}
    burnIn={Boolean(live.data?.screen.settings.burnIn)} identify={identify} distance={live.data?.screen.settings.distance} testId="screen-player" />;
}

function Message({ title, text }: { title: string; text: string }) {
  return <main className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden gap-[2vmin] bg-background p-[4vmin] text-center text-foreground">
    <Monitor className="size-[8vmin] text-primary" aria-hidden="true" />
    <h1 className="text-[4vmin] font-bold">{title}</h1>
    <p className="max-w-[70vw] text-[2.4vmin] text-muted-foreground">{text}</p>
  </main>;
}

function PairingView({ onReady }: { onReady: () => void }) {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [problem, setProblem] = useState("");
  const timer = useRef<number | null>(null);
  const retry = useRef<() => void>(() => undefined);
  const start = useCallback(async () => {
    try {
      setPairing(await json<Pairing>("/skarm/api/start", { method: "POST", body: JSON.stringify({ width: window.screen.width, height: window.screen.height }) }));
      setProblem("");
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Ingen kontakt med Workflow.");
      timer.current = window.setTimeout(() => retry.current(), 15_000);
    }
  }, []);
  useEffect(() => { retry.current = () => void start(); }, [start]);
  useEffect(() => { queueMicrotask(() => void start()); return () => { if (timer.current) window.clearTimeout(timer.current); }; }, [start]);
  useEffect(() => {
    if (!pairing) return;
    let stop = false;
    let wait = pairing.interval * 1000;
    const ask = async () => {
      if (stop) return;
      try {
        const answer = await json<{ status: string }>("/skarm/api/poll", { method: "POST", body: "{}" });
        if (answer.status === "ready") { onReady(); return; }
        if (answer.status === "slow_down") wait += 1000;
      } catch (error) {
        if (error instanceof FetchError && error.status === 410) { void start(); return; }
      }
      if (new Date(pairing.expiresAt).getTime() <= Date.now()) { void start(); return; }
      window.setTimeout(() => void ask(), wait);
    };
    const first = window.setTimeout(() => void ask(), wait);
    return () => { stop = true; window.clearTimeout(first); };
  }, [pairing, onReady, start]);
  if (!pairing) return <Message title="Kopplar skärmen" text={problem || "Hämtar en kod…"} />;
  return <main className="fixed inset-0 grid items-center gap-[4vmin] overflow-hidden bg-background p-[5vmin] text-foreground md:grid-cols-[1fr_auto]" data-testid="screen-pairing">
    <div className="space-y-[2.5vmin]">
      <p className="flex items-center gap-[1.2vmin] text-[2.6vmin] font-semibold text-primary"><Monitor className="size-[3.2vmin]" aria-hidden="true" />Koppla skärmen till Workflow</p>
      <p className="font-mono text-[12vmin] font-bold tracking-[0.08em]" data-testid="screen-pair-code">{pairing.code}</p>
      <ol className="list-decimal space-y-[0.8vmin] pl-[3vmin] text-[2.4vmin] text-muted-foreground">
        <li>Skanna QR-koden med telefonen, eller öppna {pairing.address || window.location.origin} på en dator.</li>
        <li>Gå till Tavlor › Fasta skärmar › Koppla skärm och skriv koden.</li>
        <li>Ge skärmen ett namn och välj vad den ska visa.</li>
      </ol>
      <p className="text-[1.8vmin] text-muted-foreground">Koden byts själv efter tio minuter.{problem ? ` ${problem}` : ""}</p>
    </div>
    {/* The QR code is made by Workflow's own server and holds only the pairing page's address and the code. */}
    {/* eslint-disable-next-line @next/next/no-img-element -- an SVG made on our own server, as a data address */}
    <img src={`data:image/svg+xml;utf8,${encodeURIComponent(pairing.qr)}`} alt={`QR-kod till kopplingssidan med koden ${pairing.code}`} className="qr-surface size-[34vmin] rounded-lg p-[1.5vmin]" />
  </main>;
}
