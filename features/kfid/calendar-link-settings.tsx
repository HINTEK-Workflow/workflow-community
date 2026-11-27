"use client";

import { useEffect, useState } from "react";
import { CalendarDays, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { formatSwedishDate } from "@/lib/swedish-time";
import { api } from "./api";
import { useConfirm } from "./confirm";
import { KeyField } from "./secret-field";
import { DialogActions, Modal, Panel } from "./ui";
import { useWorkspaceData } from "./use-workspace-data";

type Link = { createdAt: string; thisCompany: boolean };
type Data = { demo?: boolean; link: Link | null };

const DESCRIPTION = "Dina bokningar, arbetsordrar och jourjobb i din egen kalender. Går bara att läsa.";

/**
 * Kalenderlänk (PL14, 2026-11-01): the person's own link to a calendar program, read only. The address is shown once, when it
 * is made, like a key; only its hash is kept. A new link replaces the old one, and removing it stops it at once. Not in Local, which has no server to fetch from.
 */
export function CalendarLinkSettings({ notify }: { notify: (message: string, error?: boolean) => void }) {
  const read = useWorkspaceData<Data>("/api/calendar-link", (signal) => api<Data>("/api/calendar-link", { cache: "no-store", signal }));
  const [confirm, confirmCard] = useConfirm();
  const [shownUrl, setShownUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (read.error) notify(read.error, true); }, [read.error, notify]);

  if (read.data?.demo) return <Panel icon={CalendarDays} title="Kalenderlänk" description={DESCRIPTION}>
    <p className="text-sm text-muted-foreground" data-testid="calendar-link">Kalenderlänken går inte att prova i demon.</p>
  </Panel>;

  const link = read.data?.link ?? null;
  const loaded = read.data !== undefined;
  const create = async () => {
    if (link && !await confirm({ title: "Byta kalenderlänk?", message: "Den gamla länken slutar fungera direkt. Lägg in den nya i din kalender.", confirmLabel: "Byt länk", cancelLabel: "Behåll", tone: "danger" })) return;
    setBusy(true);
    try {
      const answer = await api<{ url: string; link: Link }>("/api/calendar-link", { method: "POST", body: "{}" });
      read.mutate((current) => ({ ...(current ?? {}), link: answer.link }));
      setShownUrl(answer.url);
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!await confirm({ title: "Ta bort kalenderlänken?", message: "Länken slutar fungera direkt. Händelserna försvinner ur din kalender vid nästa uppdatering.", confirmLabel: "Ta bort", cancelLabel: "Behåll", tone: "danger" })) return;
    setBusy(true);
    try {
      await api("/api/calendar-link", { method: "DELETE" });
      read.mutate((current) => ({ ...(current ?? {}), link: null }));
      notify("Kalenderlänken är borttagen.");
    } catch (error) { notify((error as Error).message, true); } finally { setBusy(false); }
  };

  return <Panel icon={CalendarDays} title="Kalenderlänk" description={DESCRIPTION}>
    <div className="space-y-3" data-testid="calendar-link">
      <p className="text-sm text-muted-foreground" data-testid="calendar-link-status">
        {!loaded ? "Läser in…"
          : !link ? "Ingen länk."
          : link.thisCompany ? `Länken skapades ${formatSwedishDate(link.createdAt)}.`
          : `Länken skapades ${formatSwedishDate(link.createdAt)} och gäller ett annat företag. Byt länk för att den ska gälla det här.`}
      </p>
      <div className="flex flex-wrap gap-2">
        {link
          ? <Button type="button" variant="outline" disabled={busy} onClick={() => void create()} data-testid="calendar-link-replace"><RefreshCw />Byt länk</Button>
          : <Button type="button" variant="outline" disabled={busy || !loaded} onClick={() => void create()} data-testid="calendar-link-create"><CalendarDays />Skapa länk</Button>}
        {link ? <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove()} data-testid="calendar-link-remove"><Trash2 />Ta bort</Button> : null}
      </div>
    </div>
    <Modal open={Boolean(shownUrl)} onOpenChange={(open) => { if (!open) setShownUrl(null); }} title="Kopiera länken nu" size="compact" closeButton={false}>
      <KeyField id="calendar-link-url" label="Din kalenderlänk" className="mt-1" hint="Länken visas bara nu. Lägg in den som prenumeration i din kalender och dela den inte.">
        <Input id="calendar-link-url" readOnly value={shownUrl ?? ""} className="min-w-0 flex-1 basis-56 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} data-testid="calendar-link-url" />
        <CopyButton value={shownUrl ?? ""} onCopied={() => notify("Länken är kopierad.")} onFailed={() => notify("Markera och kopiera länken själv.", true)} data-testid="calendar-link-copy" />
      </KeyField>
      <DialogActions primary={{ label: "Klart", onClick: () => setShownUrl(null), testId: "calendar-link-done" }} />
    </Modal>
    {confirmCard}
  </Panel>;
}
