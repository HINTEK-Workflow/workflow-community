"use client";

import { useCallback, useRef, useState } from "react";
import { ImageIcon, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { Panel } from "@/features/kfid/ui";
import { formatSwedish } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";

type IconView = { own: boolean; changedAt: string | null; icons: Record<"32" | "192" | "512" | "maskable", string> };

/**
 * Appikonen (2026-11-10, val D) under Drift och säkerhet: the installation's icon in the browser tab and on the home
 * screen. A square PNG, JPEG or WebP of at most 2 MB; the server draws it again in every size. Ta bort goes back to the
 * built-in icon. Shown only where the installation may have its own (features.ownIcon).
 */
export function InstanceIconSettings({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const [data, setData] = useState<IconView | null>(null);
  const [busy, setBusy] = useState<"" | "upload" | "remove">("");
  const input = useRef<HTMLInputElement>(null);
  const [confirm, confirmElement] = useConfirm();
  const load = useCallback(async () => {
    try { setData(await api<IconView>("/api/instance-icon?meta=1", { cache: "no-store" })); } catch (error) { notify((error as Error).message, true); }
  }, [notify]);
  useLoadEffect(load);
  const upload = async (file: File) => {
    // A damaged picture is caught here, before any upload; the server still checks the file itself.
    try { (await createImageBitmap(file)).close(); }
    catch { notify("Bilden kunde inte läsas. Välj PNG, JPEG eller WebP.", true); return; }
    if (file.size > 2_000_000) { notify("Bilden får vara högst 2 MB.", true); return; }
    setBusy("upload");
    const form = new FormData();
    form.set("file", file);
    try { setData(await api<IconView>("/api/instance-icon", { method: "POST", body: form })); notify("Appikonen är bytt. Den syns när sidan laddas om."); }
    catch (error) { notify((error as Error).message, true); }
    finally { setBusy(""); }
  };
  const remove = async () => {
    if (!(await confirm({ title: "Ta bort den egna appikonen?", message: "Den inbyggda ikonen används igen.", confirmLabel: "Ta bort", tone: "danger" }))) return;
    setBusy("remove");
    try { setData(await api<IconView>("/api/instance-icon", { method: "DELETE" })); notify("Den inbyggda appikonen gäller."); }
    catch (error) { notify((error as Error).message, true); }
    finally { setBusy(""); }
  };
  return <Panel icon={ImageIcon} title="Appikon" description="Ikonen som syns i webbläsarens flik och på hemskärmen." collapsible defaultCollapsed>
    {confirmElement}
    {!data ? <p className="text-sm text-muted-foreground" role="status">Hämtar…</p> : <div className="flex flex-wrap items-center gap-4" data-testid="instance-icon">
      {/* The icon as it is now: fixed size, so nothing moves when it changes. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- a small icon from the app's own address */}
      <img src={data.icons["192"]} alt="Appikonen nu" width={64} height={64} className="size-16 shrink-0 rounded-xl border bg-card" data-testid="instance-icon-preview" />
      <div className="min-w-0 flex-1 basis-56 space-y-1 text-sm">
        <p data-testid="instance-icon-state">{data.own ? `Egen ikon${data.changedAt ? `, bytt ${formatSwedish(data.changedAt, { dateStyle: "medium", timeStyle: "short" })}` : ""}.` : "Den inbyggda ikonen."}</p>
        <p className="text-xs text-muted-foreground">Välj en kvadratisk bild i PNG, JPEG eller WebP på högst 2 MB. Den behöver vara minst 192 × 192 pixlar.</p>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden data-testid="instance-icon-file"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={Boolean(busy)} onClick={() => input.current?.click()} busy={busy === "upload"} busyLabel="Laddar upp…" data-testid="instance-icon-upload"><Upload />Välj bild</Button>
        {data.own ? <Button type="button" variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => void remove()} busy={busy === "remove"} busyLabel="Tar bort…" data-testid="instance-icon-remove"><RotateCcw />Ta bort</Button> : null}
      </div>
    </div>}
  </Panel>;
}
