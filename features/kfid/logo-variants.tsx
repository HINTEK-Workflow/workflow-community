"use client";

import { useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LOGO_VARIANT_FILES, type LogoVariantColumn } from "@/lib/kfid/logo-variants";
import { cn } from "@/lib/utils";
import { api } from "./api";

/**
 * Loggans varianter (2026-11-13), beside the company's logo under Företag: Logga för mörk bakgrund, Logga för ljus
 * bakgrund and Logga i svart. Each is uploaded, shown and removed on its own, with the same checks as the logo (the server's).
 * The posts' pictures choose the one that reads on the template; nothing is Workflow's own – every company uploads its own.
 */
export function LogoVariantsField({ settings, admin, onChanged, notify }: {
  settings: Partial<Record<LogoVariantColumn, string | null>> | null | undefined;
  admin: boolean;
  onChanged: () => Promise<void>;
  notify: (text: string, error?: boolean) => void;
}) {
  return <div className="mt-5 space-y-3" data-testid="logo-variants">
    <div>
      <p className="text-sm font-medium">Fler varianter av loggan</p>
      <p className="text-xs text-muted-foreground">Används i bilderna till inlägg. Varje mall väljer den som syns bäst. Saknas en variant används logotypen ovan.</p>
    </div>
    <ul className="grid gap-3 sm:grid-cols-3">
      {LOGO_VARIANT_FILES.map((variant) => <LogoVariantRow key={variant.key} variant={variant} path={settings?.[variant.column] ?? null} admin={admin} onChanged={onChanged} notify={notify} />)}
    </ul>
  </div>;
}

function LogoVariantRow({ variant, path, admin, onChanged, notify }: {
  variant: (typeof LOGO_VARIANT_FILES)[number]; path: string | null; admin: boolean; onChanged: () => Promise<void>; notify: (text: string, error?: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const keepScroll = async () => { const y = window.scrollY; await onChanged(); window.requestAnimationFrame(() => window.scrollTo(0, y)); };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    // A damaged picture is caught before the upload (as for the logo); the server checks the file itself.
    try { const bitmap = await createImageBitmap(file); bitmap.close(); }
    catch { notify("Bilden kunde inte läsas. Välj JPG, PNG eller WebP.", true); if (input.current) input.current.value = ""; return; }
    const form = new FormData();
    form.set("file", file);
    form.set("variant", variant.key);
    setBusy(true);
    try { await api("/api/files", { method: "POST", body: form }); notify(`${variant.label} är sparad.`); await keepScroll(); }
    catch (cause) { notify((cause as Error).message, true); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  const remove = async () => {
    setBusy(true);
    try { await api(`/api/files/${variant.id}`, { method: "DELETE" }); notify(`${variant.label} är borttagen.`); await keepScroll(); }
    catch (cause) { notify((cause as Error).message, true); }
    finally { setBusy(false); }
  };
  // The preview stands on the kind of background the variant is made for.
  const dark = variant.key === "onDark";
  return <li className="min-w-0 rounded-lg border p-3" data-testid={`logo-variant-${variant.key}`}>
    <label htmlFor={`logo-variant-${variant.key}-file`} className="block text-sm font-medium">{variant.label}</label>
    <p className="text-xs text-muted-foreground">{variant.help}</p>
    <div className={cn("mt-2 flex h-16 items-center justify-center rounded border p-2", dark ? "bg-slate-900" : "bg-white")}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the company's own file, through the app's own server. */}
      {path ? <img src={`/api/files/${variant.id}?v=${encodeURIComponent(path)}`} alt={variant.label} className="max-h-full max-w-full object-contain" data-testid={`logo-variant-${variant.key}-image`} />
        : <span className={cn("text-xs", dark ? "text-slate-300" : "text-slate-500")}>Ingen bild</span>}
    </div>
    <input ref={input} type="file" id={`logo-variant-${variant.key}-file`} accept="image/png,image/jpeg,image/webp" disabled={!admin || busy} className="sr-only"
      onChange={(event) => void upload(event.target.files?.[0])} data-testid={`logo-variant-${variant.key}-file`} />
    <div className="mt-2 flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={!admin || busy} onClick={() => input.current?.click()} data-testid={`logo-variant-${variant.key}-upload`}><Upload />{path ? "Byt bild" : "Välj bild"}</Button>
      {path && admin ? <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => void remove()} data-testid={`logo-variant-${variant.key}-remove`}><Trash2 />Ta bort</Button> : null}
    </div>
  </li>;
}
