"use client";

import { useEffect, useRef, useState } from "react";
import { APP_COLUMN_WIDTH, appColumnFrameName, type DetailLevels, type DeviceClass } from "@/lib/workflow/detail-level";

/**
 * Visning 1 på en bred skärm (plan 1P, 2026-10-11): the app look in a narrow column in the middle of a tablet or a
 * computer screen. The column holds the very same app in a frame only 560 px wide, so every screen, dialog-as-screen and
 * the tab bar are exactly what a phone shows (the page's own responsive rules and the phone's native look see a phone-
 * wide window). The desktop menu and top bar are not drawn at all while the column is on; "Mer → Visning" inside the app
 * changes the level back. The frame tells this window about two things only: the address it is at (so a reload or a copied
 * link opens the same screen) and a changed display level; and, when the person signs out, that the whole window must
 * leave. Display only: the frame is a normal signed-in session of the same person; the server decides every call.
 */
export type AppColumnMessage =
  | { type: "hintek-app-column:url"; url: string }
  | { type: "hintek-app-column:detail"; detail: DetailLevels }
  | { type: "hintek-app-column:leave"; url: string };

const isMessage = (value: unknown): value is AppColumnMessage => Boolean(value) && typeof value === "object" && typeof (value as { type?: unknown }).type === "string" && (value as { type: string }).type.startsWith("hintek-app-column:");

export function AppColumnStage({ device, source: address, onDetail }: { device: DeviceClass; source: string; onDetail: (detail: DetailLevels) => void }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  // The address is read once: what the frame later reports moves the address bar but never reloads the frame. It is the
  // shell's path and query, so the server can draw the column too (Telefonens första bild); a #part is added after loading.
  const [source] = useState(address);
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && frame.current) frame.current.src = `${source}${hash}`;
  }, [source]);
  const onDetailRef = useRef(onDetail);
  useEffect(() => { onDetailRef.current = onDetail; });
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || !isMessage(event.data)) return;
      const message = event.data;
      if (message.type === "hintek-app-column:detail") onDetailRef.current(message.detail);
      else if (typeof message.url === "string" && message.url.startsWith("/") && !message.url.startsWith("//")) {
        if (message.type === "hintek-app-column:leave") window.location.assign(message.url);
        else window.history.replaceState(window.history.state, "", message.url);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return <div className="app-column-stage" data-testid="app-column-stage">
    <div className="app-column-frame" style={{ width: `min(100%, ${APP_COLUMN_WIDTH}px)` }}>
      <iframe ref={frame} name={appColumnFrameName(device)} src={source} title="Workflow i appvy" data-testid="app-column-frame" allow="camera; geolocation; clipboard-write" />
    </div>
  </div>;
}
