"use client";

import { useMemo, useRef, useState } from "react";
import { AlignLeft, ArrowDown, ArrowUp, Heading, ImageIcon, Info, Minus, MousePointerClick, MoveVertical, Trash2, Upload } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MAILING_BLOCK_LABELS, MAILING_BLOCK_TYPES, newMailingBlock, renderMailing, type MailingBlock, type MailingBlockType, type MailingDocument } from "@/lib/mail/mailing-document";

const ICONS: Record<MailingBlockType, LucideIcon> = { heading: Heading, text: AlignLeft, button: MousePointerClick, image: ImageIcon, notice: Info, divider: Minus, spacer: MoveVertical };
const field = "grid gap-1.5 text-xs font-medium text-muted-foreground";

/** A short line about a block for its card when it is not being edited. */
function summary(block: MailingBlock) {
  switch (block.type) {
    case "heading": return block.text || "Tom rubrik";
    case "text": return block.text.replace(/\s+/g, " ").slice(0, 120) || "Tom text";
    case "button": return `${block.label || "Knapp"} → ${block.url || "ingen adress"}`;
    case "image": return block.src ? block.alt || "Bild" : "Ingen bild vald";
    case "notice": return block.text.replace(/\s+/g, " ").slice(0, 120) || "Tom notis";
    case "divider": return "Linje";
    case "spacer": return "Luft mellan blocken";
  }
}

/**
 * Utskick som block (2026-10-03: "html-baserad med formulärseditorns egenskaper"): a ribbon of blocks to add, a
 * sheet where a block is chosen, moved and removed and its settings edited in place, and beside it the mail exactly as
 * it will be sent.
 */
export function MailingEditor({ document, onChange, name, newsletter, notify }: {
  document: MailingDocument; onChange: (document: MailingDocument) => void; name: string; newsletter: boolean; notify: (text: string, error?: boolean) => void;
}) {
  const [selected, setSelected] = useState<string | null>(document.blocks[0]?.id ?? null);
  const [uploading, setUploading] = useState(false);
  const counter = useRef(0);
  const set = (blocks: MailingBlock[]) => onChange({ ...document, blocks });
  const update = (id: string, patch: Partial<MailingBlock>) => set(document.blocks.map((block) => (block.id === id ? { ...block, ...patch } as MailingBlock : block)));
  const move = (index: number, step: number) => {
    const next = [...document.blocks];
    const [item] = next.splice(index, 1);
    next.splice(index + step, 0, item);
    set(next);
  };
  const add = (type: MailingBlockType) => {
    counter.current += 1;
    const block = newMailingBlock(type, `b${Date.now().toString(36)}${counter.current}`);
    const at = selected ? document.blocks.findIndex((item) => item.id === selected) + 1 : document.blocks.length;
    const next = [...document.blocks];
    next.splice(at > 0 ? at : next.length, 0, block);
    set(next);
    setSelected(block.id);
  };
  const upload = async (id: string, file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/superadmin/mailings/images", { method: "POST", body: form });
      const result = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error ?? "Bilden kunde inte laddas upp.");
      update(id, { src: result.url, alt: file.name.replace(/\.[^.]+$/, "") } as Partial<MailingBlock>);
    } catch (cause) { notify((cause as Error).message, true); } finally { setUploading(false); }
  };
  const preview = useMemo(() => renderMailing(document, {
    name, footer: newsletter ? `Du får det här för att du har sagt ja till nyheter från ${name}.` : `Du får det här som administratör i ${name}.`,
    unsubscribe: newsletter ? "#" : null,
  }).html, [document, name, newsletter]);

  return <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap gap-1.5 rounded-xl border bg-card p-1.5" role="toolbar" aria-label="Lägg till block" data-testid="mailing-ribbon">
        {MAILING_BLOCK_TYPES.map((type) => { const Icon = ICONS[type]; return <button key={type} type="button" onClick={() => add(type)}
          className="flex h-10 items-center gap-2 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
          <span className="flex size-7 items-center justify-center rounded-md bg-secondary text-primary"><Icon className="size-4" /></span>{MAILING_BLOCK_LABELS[type]}
        </button>; })}
      </div>
      <ol className="space-y-2 rounded-xl border bg-card p-3" data-testid="mailing-blocks" onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
        {document.blocks.length ? null : <li className="p-6 text-center text-sm text-muted-foreground">Lägg till ett block ovanför.</li>}
        {document.blocks.map((block, index) => { const Icon = ICONS[block.type]; const open = selected === block.id; return <li key={block.id}
          className={cn("rounded-lg border transition-colors", open ? "border-primary bg-secondary/30" : "hover:border-primary/40")} data-testid="mailing-block">
          <div className="flex items-center gap-2 p-2">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setSelected(open ? null : block.id)} aria-expanded={open}>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary text-primary"><Icon className="size-4" /></span>
              <span className="min-w-0"><span className="block text-xs font-medium">{MAILING_BLOCK_LABELS[block.type]}</span><span className="block truncate text-xs text-muted-foreground">{summary(block)}</span></span>
            </button>
            <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Flytta upp" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></Button>
            <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Flytta ned" disabled={index === document.blocks.length - 1} onClick={() => move(index, 1)}><ArrowDown /></Button>
            <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Ta bort blocket" onClick={() => { set(document.blocks.filter((item) => item.id !== block.id)); setSelected(null); }}><Trash2 /></Button>
          </div>
          {open ? <div className="grid gap-3 border-t p-3" data-testid="mailing-block-settings">
            {block.type === "heading" ? <>
              <label className={field}>Rubrik<Input value={block.text} maxLength={200} onChange={(event) => update(block.id, { text: event.target.value })} /></label>
              <label className={field}>Storlek<select className="form-select" value={block.size} onChange={(event) => update(block.id, { size: event.target.value as "large" | "medium" })}><option value="large">Stor</option><option value="medium">Mellan</option></select></label>
            </> : null}
            {block.type === "text" || block.type === "notice" ? <label className={field}>Text
              <textarea className="form-textarea min-h-32 text-sm text-foreground" value={block.text} maxLength={block.type === "text" ? 8000 : 2000} onChange={(event) => update(block.id, { text: event.target.value })} />
              <span className="font-normal">En tom rad ger nytt stycke. **Fet stil** med två stjärnor; webbadresser blir länkar.</span>
            </label> : null}
            {block.type === "notice" ? <label className={field}>Färg<select className="form-select" value={block.tone} onChange={(event) => update(block.id, { tone: event.target.value as "info" | "warning" })}><option value="info">Blå – information</option><option value="warning">Orange – viktigt</option></select></label> : null}
            {block.type === "button" ? <>
              <label className={field}>Text på knappen<Input value={block.label} maxLength={80} onChange={(event) => update(block.id, { label: event.target.value })} /></label>
              <label className={field}>Adress<Input value={block.url} placeholder="https://" onChange={(event) => update(block.id, { url: event.target.value })} /></label>
            </> : null}
            {block.type === "image" ? <>
              <label className={cn(field, "cursor-pointer")}>Bild (PNG, JPG, GIF eller WebP, högst 2 MB)
                <span className="flex h-10 items-center justify-center gap-2 rounded-md border border-dashed text-sm font-medium text-foreground hover:bg-secondary/40"><Upload className="size-4" />{uploading ? "Laddar upp…" : block.src ? "Byt bild" : "Välj bild"}</span>
                <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(block.id, file); event.target.value = ""; }} />
              </label>
              <label className={field}>Beskrivning (visas om bilden inte laddas)<Input value={block.alt} maxLength={200} onChange={(event) => update(block.id, { alt: event.target.value })} /></label>
              <label className={field}>Länk när man klickar på bilden (valfritt)<Input value={block.link} placeholder="https://" onChange={(event) => update(block.id, { link: event.target.value })} /></label>
            </> : null}
            {block.type === "divider" || block.type === "spacer" ? <p className="text-xs text-muted-foreground">Inga inställningar.</p> : null}
          </div> : null}
        </li>; })}
      </ol>
    </div>
    <div className="min-w-0 xl:sticky xl:top-24">
      <p className="mb-2 text-xs font-medium text-muted-foreground">Så här ser mejlet ut</p>
      <iframe title="Förhandsvisning av utskicket" srcDoc={preview} sandbox="" className="h-[36rem] w-full rounded-xl border bg-white" data-testid="mailing-preview" />
    </div>
  </div>;
}
