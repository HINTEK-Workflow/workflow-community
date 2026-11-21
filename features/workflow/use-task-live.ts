"use client";

import { useEffect, useRef, useState } from "react";

export type LiveEditor = { userId: string; name: string };
export type TaskChange = { version: number; byUserId: string; byName: string; status?: string; reason: "save" | "reopen" | "timer" | "attachment" | "delete" };

/**
 * Live sync for an open task (2026-10-04): who else has it open and when a newer version is saved, from our own
 * server (Server-Sent Events). The browser reconnects by itself; the demo and Local have no server and stay off.
 */
export function useTaskLive(taskId: string | undefined, enabled: boolean, onChange: (change: TaskChange) => void) {
  const [editors, setEditors] = useState<LiveEditor[]>([]);
  const [connected, setConnected] = useState(false);
  const handler = useRef(onChange);
  useEffect(() => { handler.current = onChange; });
  useEffect(() => {
    const demo = typeof window !== "undefined" && (window as typeof window & { __workflowDemo?: boolean }).__workflowDemo;
    if (!taskId || !enabled || demo || typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/workflow-tasks/live?id=${encodeURIComponent(taskId)}`);
    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("error", () => setConnected(false));
    source.addEventListener("presence", (event) => {
      try { setEditors((JSON.parse((event as MessageEvent).data) as { editors: LiveEditor[] }).editors); } catch { /* ignore a broken event */ }
    });
    source.addEventListener("changed", (event) => {
      try { handler.current(JSON.parse((event as MessageEvent).data) as TaskChange); } catch { /* ignore a broken event */ }
    });
    return () => { source.close(); setEditors([]); setConnected(false); };
  }, [taskId, enabled]);
  return { editors, connected };
}
