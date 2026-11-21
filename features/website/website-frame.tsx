"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FRAME_CHANNEL, FRAME_PATH, previewDocument, readFrameMessage, type ThemeStyles } from "@/lib/website/frame";

/**
 * Where the frames draw from: the connected site's origin (its pictures, styles and fonts) and its look (the page's css).
 * `allowed` (Samtycke, 2026-11-11, docs/regler/samtycke.md): the frames fetch from the site only after the person has
 * clicked "Visa förhandsvisning" on this page – before that each frame is a placeholder of the same size and nothing is
 * asked of the site. `allow` is that click; it holds for the open page until another page is opened.
 */
export type FrameEnv = { origin: string | null; styles: ThemeStyles; allowed?: boolean; allow?: () => void };

/** Whether a frame may load: nothing to fetch from (no site), or the person has asked for the preview. */
export const frameMayLoad = (env: FrameEnv) => !env.origin || env.allowed === true;

const newToken = () => {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * The site's own html in a sandboxed frame (ee/website/frame.ts says why and how): scripts run (the calculators work), the
 * app is out of reach. A change of the html draws a new frame after a short pause (typing in the code field); the frame
 * keeps its last height meanwhile, so the page does not jump. `onPress`: a press inside the frame (selects the block).
 */
export function SiteFrame({ html, env, title, onPress, testId, delay = 350, className, minHeight = 24, gate = "box" }: {
  html: string; env: FrameEnv; title: string; onPress?: () => void; testId?: string; delay?: number; className?: string; minHeight?: number;
  /** Before the click: a placeholder of the frame's size ("box"), or only the button (an html block's static preview shows under it). */
  gate?: "box" | "button";
}) {
  const [frame, setFrame] = useState(() => ({ html, env, token: newToken() }));
  const [height, setHeight] = useState(120);
  const ref = useRef<HTMLIFrameElement>(null);
  const press = useRef(onPress);
  useEffect(() => { press.current = onPress; });

  useEffect(() => {
    if (html === frame.html && env === frame.env) return;
    const timer = setTimeout(() => setFrame({ html, env, token: newToken() }), html === frame.html ? 0 : delay);
    return () => clearTimeout(timer);
  }, [html, env, frame, delay]);

  useEffect(() => {
    const { token } = frame;
    const onMessage = (event: MessageEvent) => {
      const target = ref.current?.contentWindow ?? null;
      const message = readFrameMessage(event, target, token);
      if (!message || !target) return;
      if (message.kind === "ready") target.postMessage({ channel: FRAME_CHANNEL, kind: "render", token, html: previewDocument({ html: frame.html, token, origin: frame.env.origin, styles: frame.env.styles }) }, "*");
      else if (message.kind === "height") setHeight(Math.max(minHeight, message.height));
      else press.current?.();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame, minHeight]);

  // Before the click: the same room as the frame (its last height), a button and one short line. A press selects the block,
  // so the block can be edited without the preview.
  if (!frameMayLoad(frame.env) && gate === "button") return <Button type="button" variant="outline" size="sm" className="bg-background shadow-sm" title="Kör blockets skript. Hämtar från din webbplats."
    onClick={(event) => { event.stopPropagation(); frame.env.allow?.(); }} data-testid="site-preview-load">Visa förhandsvisning</Button>;
  if (!frameMayLoad(frame.env)) return <div className={cn("flex w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed bg-muted/30 p-3 text-center", className)}
    style={{ height }} onClick={() => press.current?.()} data-testid={testId ? `${testId}-gate` : undefined} data-site-ui="">
    <Button type="button" variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); frame.env.allow?.(); }} data-testid="site-preview-load">Visa förhandsvisning</Button>
    <p className="text-xs text-muted-foreground">Hämtar från din webbplats</p>
  </div>;
  return <iframe key={frame.token} ref={ref} title={title} src={`${FRAME_PATH}#${frame.token}`} sandbox="allow-scripts" referrerPolicy="no-referrer"
    className={cn("block w-full border-0 bg-transparent", className)} style={{ height }} data-testid={testId} data-site-ui="" />;
}
