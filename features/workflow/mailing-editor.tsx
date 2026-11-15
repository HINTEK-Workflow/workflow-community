"use client";

import { useMemo, useRef, useState } from "react";
import { AlignLeft, ArrowDown, ArrowUp, Bold, Code2, Heading, ImageIcon, Info, Italic, Link2, List, ListOrdered, Minus, Monitor, MousePointerClick, MoveVertical, Smartphone, Upload } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MAILING_BLOCK_LABELS, newMailingBlock, renderMailing, type MailingBlock, type MailingBlockType, type MailingDocument } from "@/lib/mail/mailing-document";
import { IconButton } from "@/components/ui/icon-button";
import { RemoveButton } from "@/components/ui/remove-button";

const ICONS: Record<MailingBlockType, LucideIcon> = { heading: Heading, text: AlignLeft, button: MousePointerClick, image: ImageIcon, notice: Info, divider: Minus, spacer: MoveVertical, html: Code2 };
// The ribbon in a steady grid (2026-10-04: "strukturera upp ikonerna"): text blocks first, then picture and
// button, then layout – four to a row, two on a phone.
const RIBBON: MailingBlockType[] = ["heading", "text", "notice", "html", "image", "button", "divider", "spacer"];
const field = "grid gap-1.5 text-xs font-medium text-muted-foreground";

const TOOLS = [
  { key: "bold", label: "Fet", icon: Bold },
  { key: "italic", label: "Kursiv", icon: Italic },
  { key: "link", label: "Länk", icon: Link2 },
  { key: "bullets", label: "Punktlista", icon: List },
  { key: "numbered", label: "Numrerad lista", icon: ListOrdered },
] as const;

/**
 * Text with a small formatting bar (2026-10-04: "lite bättre editor"): bold, italic, link and lists act on the
 * marked text and write the same short marks the mail understands (**fet**, *kursiv*, [text](adress), "- " rader), so
 * what is stored stays plain text that also reads well in the plain-text mail.
 */
function FormattedText({ value, onChange, maxLength, label }: { value: string; onChange: (value: string) => void; maxLength: number; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const apply = (next: string, start: number, end: number) => {
    onChange(next.slice(0, maxLength));
    requestAnimationFrame(() => { const area = ref.current; if (area) { area.focus(); area.setSelectionRange(start, end); } });
  };
  const wrap = (mark: string, placeholder: string) => {
    const area = ref.current; if (!area) return;
    const { selectionStart: start, selectionEnd: end } = area;
    const chosen = value.slice(start, end) || placeholder;
    apply(`${value.slice(0, start)}${mark}${chosen}${mark}${value.slice(end)}`, start + mark.length, start + mark.length + chosen.length);
  };
  const link = () => {
    const area = ref.current; if (!area) return;
    const { selectionStart: start, selectionEnd: end } = area;
    const chosen = value.slice(start, end) || "länktext";
    const inserted = `[${chosen}](https://)`;
    // The address is marked afterwards, so typing or pasting replaces it at once.
    const at = start + chosen.length + 3;
    apply(`${value.slice(0, start)}${inserted}${value.slice(end)}`, at, at + "https://".length);
  };
  const list = (numbered: boolean) => {
    const area = ref.current; if (!area) return;
    const from = value.lastIndexOf("\n", area.selectionStart - 1) + 1;
    const nextBreak = value.indexOf("\n", Math.max(area.selectionEnd - 1, from));
    const to = nextBreak === -1 ? value.length : nextBreak;
    const lines = value.slice(from, to).split("\n");
    const marker = /^\s*([-•]|\d+[.)])\s+/;
    const off = lines.every((line) => (numbered ? /^\s*\d+[.)]\s+/ : /^\s*[-•]\s+/).test(line));
    const changed = lines.map((line, index) => off ? line.replace(marker, "") : `${numbered ? `${index + 1}.` : "-"} ${line.replace(marker, "")}`).join("\n");
    apply(`${value.slice(0, from)}${changed}${value.slice(to)}`, from, from + changed.length);
  };
  const run = (tool: (typeof TOOLS)[number]["key"]) => {
    if (tool === "bold") wrap("**", "fet text");
    else if (tool === "italic") wrap("*", "kursiv text");
    else if (tool === "link") link();
    else list(tool === "numbered");
  };
  return <div className={field}>
    <span>{label}</span>
    <div className="overflow-hidden rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring/40">
      <div className="flex flex-wrap gap-1 border-b bg-secondary/40 p-1" role="toolbar" aria-label="Formatering" data-testid="mailing-format">
        {TOOLS.map(({ key, label: name, icon: Icon }) => <button key={key} type="button" title={name} aria-label={name} onMouseDown={(event) => event.preventDefault()} onClick={() => run(key)}
          className="flex size-8 items-center justify-center rounded-md bg-background text-primary shadow-xs transition-colors hover:bg-secondary"><Icon className="size-4" /></button>)}
      </div>
      <textarea ref={ref} aria-label={label} className="block min-h-36 w-full resize-y border-0 bg-transparent px-3 py-2 text-sm font-normal text-foreground outline-none" value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />
    </div>
    <span className="font-normal">Markera text och välj formatering. En tom rad ger nytt stycke; webbadresser blir länkar av sig själva.</span>
  </div>;
}

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
    case "html": return block.html.trim() ? `${block.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Egen HTML"}` : "Ingen HTML inklistrad";
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
    const block = newMailingBlock(type, `b${new Date().getTime().toString(36)}${counter.current}`);
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
    unsubscribe: newsletter ? "#" : null, webVersion: "#",
  }).html, [document, name, newsletter]);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  return <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <div className="min-w-0 space-y-3">
      <div className="grid grid-cols-2 gap-1 rounded-xl border bg-card p-1.5 sm:grid-cols-4" role="toolbar" aria-label="Lägg till block" data-testid="mailing-ribbon">
        {RIBBON.map((type) => { const Icon = ICONS[type]; return <button key={type} type="button" onClick={() => add(type)}
          className="flex h-10 min-w-0 items-center gap-2 rounded-lg px-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
          <span className="flex size-7 items-center justify-center rounded-md bg-secondary text-primary"><Icon className="size-4" /></span><span className="truncate">{MAILING_BLOCK_LABELS[type]}</span>
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
            <IconButton label="Flytta upp" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></IconButton>
            <IconButton label="Flytta ned" disabled={index === document.blocks.length - 1} onClick={() => move(index, 1)}><ArrowDown /></IconButton>
            <RemoveButton label="Ta bort blocket" onClick={() => { set(document.blocks.filter((item) => item.id !== block.id)); setSelected(null); }} />
          </div>
          {open ? <div className="grid gap-3 border-t p-3" data-testid="mailing-block-settings">
            {block.type === "heading" ? <>
              <label className={field}>Rubrik<Input value={block.text} maxLength={200} onChange={(event) => update(block.id, { text: event.target.value })} /></label>
              <label className={field}>Storlek<select className="form-select" value={block.size} onChange={(event) => update(block.id, { size: event.target.value as "large" | "medium" })}><option value="large">Stor</option><option value="medium">Mellan</option></select></label>
            </> : null}
            {block.type === "text" || block.type === "notice" ? <FormattedText label="Text" value={block.text} maxLength={block.type === "text" ? 8000 : 2000} onChange={(text) => update(block.id, { text })} /> : null}
            {block.type === "html" ? <label className={field}>HTML
              <textarea className="form-textarea min-h-48 font-mono text-xs text-foreground" spellCheck={false} value={block.html} maxLength={50000} placeholder="<p>Klistra in färdig HTML här …</p>" onChange={(event) => update(block.id, { html: event.target.value })} />
              <span className="font-normal">För färdig HTML från ett annat verktyg. Skript, formulär och inbäddade ramar tas bort när utskicket skapas. Bilder måste ligga på en webbadress (https://).</span>
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
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">Så här ser utskicket ut</p>
        <div className="inline-flex rounded-lg border bg-card p-0.5" role="radiogroup" aria-label="Visa som" data-testid="mailing-device">
          {([["desktop", "Dator", Monitor], ["mobile", "Mobil", Smartphone]] as const).map(([key, label, Icon]) => <button key={key} type="button" role="radio" aria-checked={device === key} onClick={() => setDevice(key)}
            className={cn("flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors", device === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}><Icon className="size-3.5" />{label}</button>)}
        </div>
      </div>
      <div className="rounded-xl border bg-secondary/30">
        <iframe title="Förhandsvisning av utskicket" srcDoc={preview} sandbox="" className={cn("mx-auto block h-[36rem] bg-white", device === "mobile" ? "w-[375px] max-w-full border-x" : "w-full rounded-xl")} data-testid="mailing-preview" />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Varje utskick får överst länken ”Visa i webbläsaren”, som öppnar utskicket som en webbsida om e-postprogrammet blockerar innehållet.</p>
    </div>
  </div>;
}
