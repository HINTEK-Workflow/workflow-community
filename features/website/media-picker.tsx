"use client";

import { Modal } from "@/features/kfid/ui";
import { imageAddress } from "./website-canvas";

export type SiteMedia = { id: number; url: string; thumb: string; alt: string };

/**
 * The connected site's media library as a grid of pictures to choose one from (Inlägg's background, 2026-11-10; Min webbsida's
 * share picture, 2026-11-11). The pictures are shown through the app's own server; the browser never loads one from the site.
 */
export function MediaLibraryDialog({ open, onOpenChange, title, media, busy = false, onChoose, testId }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; media: SiteMedia[] | null; busy?: boolean;
  onChoose: (item: SiteMedia) => void; testId: string;
}) {
  return <Modal open={open} onOpenChange={onOpenChange} title={title} size="form">
    {!media ? <p className="text-sm text-muted-foreground">Hämtar bilderna…</p>
      : media.length ? <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid={testId}>
        {media.map((item) => <button key={item.id} type="button" disabled={busy} onClick={() => onChoose(item)} title={item.alt || item.url} className="aspect-square overflow-hidden rounded-md border bg-muted hover:ring-2 hover:ring-[var(--primary)]" data-testid={`${testId}-${item.id}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a picture on the company's own site, through the app's own server. */}
          <img src={imageAddress(item.thumb)} alt={item.alt} className="size-full object-cover" />
        </button>)}
      </div> : <p className="text-sm text-muted-foreground">Inga bilder i webbplatsens mediabibliotek, eller ingen webbplats kopplad.</p>}
  </Modal>;
}
