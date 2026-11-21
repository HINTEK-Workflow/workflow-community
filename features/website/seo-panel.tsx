"use client";

import { useRef, useState } from "react";
import { ImagePlus, Images, X } from "lucide-react";
import { SearchResultPreview, SeoTextFields } from "@/components/seo-fields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/features/kfid/api";
import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX, type PageSeo } from "@/lib/website/seo";
import { MediaLibraryDialog, type SiteMedia } from "./media-picker";
import { imageAddress } from "./website-canvas";

/**
 * Sökmotorer och delning for one page of the company's WordPress (2026-11-11): shown only when the site has the SEO meta (the
 * optional Workflow SEO plugin). The same preview and text fields as the landing editor's panel (components/seo-fields.tsx), plus
 * Dölj för sökmotorer and the share picture – chosen from the site's media library or uploaded to it. Every change goes to the
 * editor's state; Spara keeps it with the draft, Publicera writes it with the page.
 */
export function WebsiteSeoPanel({ seo, pageTitle, pageLink, media, onChange, onMedia }: {
  seo: PageSeo; pageTitle: string; pageLink: string; media: SiteMedia[];
  onChange: (next: PageSeo) => void; onMedia: (item: SiteMedia) => void;
}) {
  const set = (values: Partial<PageSeo>) => onChange({ ...seo, ...values });
  const address = pageLink.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const picture = seo.image ? media.find((item) => item.id === seo.image) ?? null : null;
  const [choosing, setChoosing] = useState(false);
  const [library, setLibrary] = useState<SiteMedia[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const openLibrary = async () => {
    setChoosing(true);
    if (library) return;
    try { setLibrary((await api<{ media: SiteMedia[] }>("/api/website?media=1", undefined, { change: false })).media); }
    catch (cause) { setError((cause as Error).message); setLibrary([]); }
  };
  const choose = (item: SiteMedia) => { onMedia(item); set({ image: item.id }); setChoosing(false); };
  const upload = async (picked: File | undefined) => {
    if (!picked) return;
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("file", picked);
      const result = await api<{ id: number; url: string }>("/api/website/media", { method: "POST", body: form });
      const item = { id: result.id, url: result.url, thumb: result.url, alt: "" };
      setLibrary((current) => (current ? [item, ...current] : current));
      choose(item);
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); if (file.current) file.current.value = ""; }
  };

  return <div className="space-y-4 text-sm" data-testid="site-seo-settings">
    <SearchResultPreview address={address} title={seo.title.trim() || pageTitle} description={seo.description.trim() || "Sidans utdrag eller webbplatsens standardtext."} hidden={seo.noindex} testId="site-seo-preview" />
    <SeoTextFields idPrefix="site-seo" title={seo.title} description={seo.description} titleMax={SEO_TITLE_MAX} descriptionMax={SEO_DESCRIPTION_MAX}
      titlePlaceholder={pageTitle} descriptionPlaceholder="Tomt ger sidans utdrag" onTitle={(value) => set({ title: value })} onDescription={(value) => set({ description: value })}
      titleHint="Tomt ger webbplatsens standardtitel." descriptionHint="Tomt ger sidans utdrag." />
    <label className="flex items-start gap-2.5" data-testid="site-seo-noindex"><Checkbox checked={seo.noindex} onCheckedChange={(value) => set({ noindex: value === true })} className="mt-0.5" />
      <span>Dölj sidan för sökmotorer <span className="text-muted-foreground">(noindex)</span></span></label>

    <fieldset className="field-group space-y-3 rounded-lg border p-3" data-testid="site-seo-image"><legend className="px-1 text-xs font-medium">Delningsbild</legend>
      {picture
        // eslint-disable-next-line @next/next/no-img-element -- a picture on the company's own site, through the app's own server.
        ? <img src={imageAddress(picture.thumb)} alt="" className="max-h-32 w-auto rounded-md border" data-testid="site-seo-image-preview" />
        : <p className="text-xs text-muted-foreground" data-testid="site-seo-image-state">{seo.image ? `Bild ${seo.image} i mediabiblioteket.` : "Ingen vald – webbplatsens standardbild används."}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void openLibrary()} data-testid="site-seo-image-library"><Images />Välj från webbplatsen</Button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" aria-label="Ladda upp en delningsbild" onChange={(event) => void upload(event.target.files?.[0])} data-testid="site-seo-image-file" />
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => file.current?.click()}><ImagePlus />{busy ? "Laddar upp…" : "Ladda upp"}</Button>
        {seo.image ? <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => set({ image: 0 })} data-testid="site-seo-image-remove"><X />Ta bort</Button> : null}
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <p className="text-xs text-muted-foreground">Visas när sidan delas. Bäst är 1200 × 630 pixlar.</p>
    </fieldset>
    <MediaLibraryDialog open={choosing} onOpenChange={setChoosing} title="Välj delningsbild" media={library} busy={busy} onChoose={choose} testId="site-seo-media" />
    <p className="text-xs text-muted-foreground">Spara behåller ändringarna i utkastet. Publicera skriver dem till webbplatsen.</p>
  </div>;
}
