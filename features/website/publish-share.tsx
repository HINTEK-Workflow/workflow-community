"use client";

import { useMemo, useState } from "react";
import { ImageOff, Send } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogActions, Modal } from "@/features/kfid/ui";
import { cn } from "@/lib/utils";
import { defaultHeading, defaultSelection, draftFromSelection, pageImages, shareBlocks, type ShareBlock } from "@/lib/meta/page-share";
import { imageAddress, isExternalImage } from "./website-canvas";

export type ShareChoice = { heading: string; body: string; caption: string; background: string | null };

const TYPE_LABEL: Record<ShareBlock["type"], string> = { heading: "Rubrik", paragraph: "Text", list: "Lista", image: "Bild" };

/**
 * Publicera with "Dela även på Facebook och Instagram" (2026-11-10): the confirmation shows the page's blocks as a checklist –
 * the blocks changed since the version on the site are ticked – the heading for the picture and, if wanted, one of the page's
 * pictures as its background. What is ticked becomes a draft under Inlägg, in page order; nothing is posted from here. Compact
 * on a computer (a popup), a page of its own on a phone (Modal's own rule). A picture on another site is never loaded here: it
 * is named, and the server fetches it.
 */
export function PublishShareDialog({ open, title, warning, baseMarkup, nextMarkup, siteOrigin, onCancel, onPublish }: {
  open: boolean; title: string; warning: string; baseMarkup: string; nextMarkup: string; siteOrigin: string | null;
  onCancel: () => void; onPublish: (share: ShareChoice | null) => void;
}) {
  const blocks = useMemo(() => (open ? shareBlocks(baseMarkup, nextMarkup) : []), [open, baseMarkup, nextMarkup]);
  const texts = blocks.filter((block) => block.type !== "image");
  const images = useMemo(() => pageImages(blocks), [blocks]);
  const headings = texts.filter((block) => block.type === "heading");
  const [share, setShare] = useState(false);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [heading, setHeading] = useState<string | null | undefined>(undefined);
  const [background, setBackground] = useState<string | null>(null);
  const chosen = selected ?? defaultSelection(blocks);
  const headingKey = heading === undefined ? defaultHeading(blocks, chosen) : heading;
  const draft = useMemo(() => draftFromSelection(blocks, chosen, headingKey, title), [blocks, chosen, headingKey, title]);
  const toggle = (key: string, on: boolean) => setSelected((current) => { const base = current ?? defaultSelection(blocks); return on ? [...base, key] : base.filter((item) => item !== key); });
  const close = () => { setShare(false); setSelected(null); setHeading(undefined); setBackground(null); };

  return <Modal open={open} onOpenChange={(next) => { if (!next) { close(); onCancel(); } }} title="Publicera på webbplatsen?" size="form">
    <div className="min-w-0 space-y-4 overflow-x-clip text-sm" data-testid="site-publish-dialog">
      <p className="leading-6 text-muted-foreground">{title} skrivs till webbplatsen nu. Sidan som ligger där sparas först, så du kan återställa den.{warning}</p>
      <label className="flex cursor-pointer items-start gap-2.5" data-testid="site-share"><Checkbox checked={share} onCheckedChange={(value) => setShare(value === true)} className="mt-0.5" />
        <span>Dela även på Facebook och Instagram <span className="text-muted-foreground">(blir ett utkast under Inlägg)</span></span></label>

      {share ? <div className="space-y-4" data-testid="share-options">
        <fieldset className="min-w-0 space-y-1">
          <legend className="mb-1 text-xs font-medium">Block i inlägget <span className="font-normal text-muted-foreground">– ändrade är ikryssade</span></legend>
          {texts.length ? <ul className="max-h-64 space-y-0.5 overflow-y-auto overflow-x-clip rounded-md border p-1" data-testid="share-blocks">
            {texts.map((block) => <li key={block.key}>
              <label className="flex min-h-10 cursor-pointer items-start gap-2.5 rounded px-2 py-1.5 hover:bg-[var(--surface-hover)]" data-testid={`share-block-${block.key}`}>
                <Checkbox checked={chosen.includes(block.key)} onCheckedChange={(value) => toggle(block.key, value === true)} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="text-xs font-medium text-muted-foreground">{TYPE_LABEL[block.type]}{block.changed ? <span className="ml-1.5 rounded-full bg-[#fcefd6] px-1.5 text-[11px] text-[#5c3b00] dark:bg-amber-950 dark:text-amber-200">Ändrad</span> : null}</span>
                  <span className={cn("block truncate", block.type === "heading" && "font-semibold")} title={block.text}>{block.type === "list" ? (block.items ?? []).map((item) => `• ${item}`).join("  ") : block.text}</span>
                </span>
              </label>
            </li>)}
          </ul> : <p className="text-xs text-muted-foreground">Sidan har inga texter att dela.</p>}
        </fieldset>

        <div className="field-stack">
          <label htmlFor="share-heading" className="text-xs font-medium">Rubrik i bilden</label>
          <select id="share-heading" className="form-select" value={headingKey ?? ""} onChange={(event) => setHeading(event.target.value || null)} data-testid="share-heading">
            <option value="">Sidans titel: {title}</option>
            {headings.map((block) => <option key={block.key} value={block.key}>{block.text.slice(0, 80)}</option>)}
          </select>
        </div>

        {images.length ? <fieldset className="min-w-0">
          <legend className="mb-1 text-xs font-medium">Bakgrundsbild</legend>
          <div role="radiogroup" aria-label="Bakgrundsbild" className="flex flex-wrap gap-2" data-testid="share-backgrounds">
            <button type="button" role="radio" aria-checked={background === null} onClick={() => setBackground(null)} data-testid="share-bg-none"
              className={cn("flex size-20 items-center justify-center rounded-md border text-xs text-muted-foreground", background === null && "ring-2 ring-[var(--primary)]")}>Ingen</button>
            {images.map((image, index) => {
              const external = isExternalImage(image.url, siteOrigin);
              let host = "";
              try { host = new URL(image.url).hostname; } catch { host = ""; }
              return <button key={image.url} type="button" role="radio" aria-checked={background === image.url} onClick={() => setBackground(image.url)} data-testid={`share-bg-${index}`} title={image.alt || image.url}
                className={cn("relative flex size-20 items-center justify-center overflow-hidden rounded-md border bg-muted text-[10px] text-muted-foreground", background === image.url && "ring-2 ring-[var(--primary)]")}>
                {external
                  ? <span className="flex flex-col items-center gap-1 p-1 text-center"><ImageOff className="size-4" aria-hidden="true" />{host}</span>
                  // eslint-disable-next-line @next/next/no-img-element -- a picture on the company's own site, through the app's own server.
                  : <img src={imageAddress(image.url)} alt={image.alt} className="size-full object-cover" />}
              </button>;
            })}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Bilden läggs bakom mallen, under företagets färg.</p>
        </fieldset> : null}

        <div className="field-stack">
          <span className="text-xs font-medium">Inläggets text</span>
          <p className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-2 text-xs leading-5" data-testid="share-caption">{draft.caption}</p>
        </div>
      </div> : null}

    </div>
    <DialogActions cancel={{ onClick: () => { close(); onCancel(); } }}
      primary={{ label: "Publicera", icon: <Send />, testId: "site-publish-confirm",
        onClick: () => { const choice = share ? { ...draft, background } : null; close(); onPublish(choice); } }} />
  </Modal>;
}
