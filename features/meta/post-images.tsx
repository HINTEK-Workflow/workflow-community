"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImagePlus, Images } from "lucide-react";
import { MediaLibraryDialog } from "@/features/website/media-picker";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { api } from "@/features/kfid/api";
import type { PostView } from "@/lib/meta/server";
import { EXTRA_IMAGES_MAX, IMAGES_MAX } from "@/lib/meta/text";

/** An extra picture's address on the app's own server (the company's own post only). */
export const extraImageHref = (postId: string, imageId: string) => `/api/meta/posts?image=${encodeURIComponent(postId)}&extra=${encodeURIComponent(imageId)}`;

type SiteMedia = { id: number; url: string; thumb: string; alt: string };

/**
 * Fler bilder (2026-11-15, built 2026-11-16): pictures 2–10 after the drawn picture. Instagram shows them as a carousel,
 * Facebook as one post with several photos; LinkedIn and the story take the drawn picture only. A picture of the connected site
 * (fetched by the server) or an upload, like the background.
 */
export function ExtraImagesField({ post, disabled, onSaved }: { post: PostView; disabled: boolean; onSaved: (post: PostView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [media, setMedia] = useState<SiteMedia[] | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const images = post.images;
  const full = images.length >= EXTRA_IMAGES_MAX;
  const run = async (work: () => Promise<{ post: PostView }>) => {
    setBusy(true); setError("");
    try { onSaved((await work()).post); setChoosing(false); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); if (file.current) file.current.value = ""; }
  };
  const call = (body: Record<string, unknown>) => run(() => api<{ post: PostView }>("/api/meta/posts", { method: "POST", body: JSON.stringify({ id: post.id, ...body }) }));
  const upload = (picked: File | undefined) => {
    if (!picked) return;
    const form = new FormData();
    form.append("id", post.id);
    form.append("kind", "extra");
    form.append("file", picked);
    void run(() => api<{ post: PostView }>("/api/meta/posts", { method: "POST", body: form }));
  };
  const openLibrary = async () => {
    setChoosing(true);
    if (media) return;
    try { setMedia((await api<{ media: SiteMedia[] }>("/api/meta/posts?media=1")).media); }
    catch (cause) { setError((cause as Error).message); setMedia([]); }
  };
  return <div className="field-stack" data-testid="post-images">
    <span className="text-xs font-medium">Fler bilder</span>
    <p className="text-xs text-muted-foreground" data-testid="post-images-help">
      {images.length ? `${images.length + 1} bilder. Instagram visar dem som karusell, Facebook som ett inlägg med flera bilder. LinkedIn och story får bara den första.`
        : `Lägg till upp till ${EXTRA_IMAGES_MAX} bilder efter den ritade bilden (högst ${IMAGES_MAX} totalt).`}
    </p>
    {images.length ? <ol className="flex flex-wrap gap-2" aria-label="Fler bilder">
      {images.map((image, index) => <li key={image.id} className="w-24 space-y-1" data-testid={`post-image-${image.id}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the post's own picture from the app's own server. */}
        <img src={extraImageHref(post.id, image.id)} alt={`Bild ${index + 2}`} className="block aspect-[4/5] w-24 rounded border object-cover" loading="lazy" />
        <div className="flex items-center justify-between">
          <IconButton label={`Flytta bild ${index + 2} bakåt`} size="icon-sm" disabled={disabled || busy || index === 0} onClick={() => void call({ action: "image-move", imageId: image.id, step: -1 })}><ChevronLeft /></IconButton>
          <RemoveButton label={`Ta bort bild ${index + 2}`} disabled={disabled || busy} onClick={() => void call({ action: "image-remove", imageId: image.id })} data-testid={`post-image-remove-${image.id}`} />
          <IconButton label={`Flytta bild ${index + 2} framåt`} size="icon-sm" disabled={disabled || busy || index === images.length - 1} onClick={() => void call({ action: "image-move", imageId: image.id, step: 1 })}><ChevronRight /></IconButton>
        </div>
      </li>)}
    </ol> : null}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={disabled || busy || full} onClick={() => void openLibrary()} data-testid="post-images-site"><Images />Från webbplatsen</Button>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" aria-label="Ladda upp en bild till inlägget" onChange={(event) => upload(event.target.files?.[0])} data-testid="post-images-file" />
      <Button type="button" variant="outline" size="sm" disabled={disabled || busy || full} onClick={() => file.current?.click()}><ImagePlus />Ladda upp bild</Button>
    </div>
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    <MediaLibraryDialog open={choosing} onOpenChange={setChoosing} title="Lägg till en bild" media={media} busy={busy} onChoose={(item) => void call({ action: "image-add", url: item.url })} testId="post-images-media" />
  </div>;
}
