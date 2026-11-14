"use client";

import { useEffect, useMemo, useRef } from "react";
import { Camera, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RemoveButton } from "@/components/ui/remove-button";
import { DEVIATION_PHOTO_LIMIT, DEVIATION_PHOTO_PHASES, type DeviationView } from "@/lib/self-inspection/model";

/**
 * Bilder på avvikelser (2026-10-30): take or choose several photos when an entry is reported (Före) or marked done
 * (Efter), shown as miniatures that open larger – the same way as a work order's pictures (a private file behind the
 * session, opened in a tab of its own). Cloud only: the backend keeps the bytes (app/api/self-inspection/deviation-photos).
 */
export type DeviationPhotosApi = {
  upload: (deviationId: string, phase: "BEFORE" | "AFTER", file: File) => Promise<void>;
  remove: (photoId: string) => Promise<void>;
  href: (photoId: string) => string;
};

export function cloudDeviationPhotos(api: (url: string, init?: RequestInit) => Promise<unknown>): DeviationPhotosApi {
  return {
    upload: async (deviationId, phase, file) => {
      const form = new FormData();
      form.set("deviationId", deviationId);
      form.set("phase", phase);
      form.set("file", file);
      await api("/api/self-inspection/deviation-photos", { method: "POST", body: form });
    },
    remove: async (photoId) => { await api(`/api/self-inspection/deviation-photos/${encodeURIComponent(photoId)}`, { method: "DELETE" }); },
    // The demo keeps its photos in the browser's memory and hands out their address (features/demo/demo-backend.ts).
    href: (photoId) => (typeof window !== "undefined" && (window as typeof window & { __workflowDemoPhoto?: (id: string) => string }).__workflowDemoPhoto?.(photoId))
      || `/api/self-inspection/deviation-photos/${encodeURIComponent(photoId)}`,
  };
}

const ACCEPT = "image/jpeg,image/png,image/webp";

/** Photos chosen before they are sent: Ta foto (the camera on a phone) and Välj bilder, with miniatures that can be removed. */
export function PhotoPicker({ files, onChange, disabled = false, label = "Bilder", cameraRef }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean; label?: string;
  /** A camera input of the caller's own (Rapportera tillbud opens the camera at once on a phone). */ cameraRef?: React.RefObject<HTMLInputElement | null> }) {
  const camera = useRef<HTMLInputElement>(null);
  const chooser = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => { for (const item of previews) URL.revokeObjectURL(item.url); }, [previews]);
  const add = (list: FileList | null) => {
    const chosen = Array.from(list ?? []).filter((file) => ACCEPT.split(",").includes(file.type));
    if (chosen.length) onChange([...files, ...chosen].slice(0, DEVIATION_PHOTO_LIMIT));
  };
  const full = files.length >= DEVIATION_PHOTO_LIMIT;
  return <div className="grid gap-2" data-testid="deviation-photo-picker">
    <span className="text-xs font-medium">{label}</span>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={disabled || full} onClick={() => (cameraRef?.current ?? camera.current)?.click()} data-testid="deviation-photo-camera"><Camera />Ta foto</Button>
      <Button type="button" variant="outline" size="sm" disabled={disabled || full} onClick={() => chooser.current?.click()} data-testid="deviation-photo-choose"><ImagePlus />Välj bilder</Button>
    </div>
    <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label="Ta foto" onChange={(event) => { add(event.target.files); event.target.value = ""; }} />
    <input ref={chooser} type="file" accept={ACCEPT} multiple className="sr-only" tabIndex={-1} aria-label="Välj bilder" onChange={(event) => { add(event.target.files); event.target.value = ""; }} />
    {previews.length ? <ul className="flex flex-wrap gap-2" data-testid="deviation-photo-previews">{previews.map((item, index) => <li key={item.url} className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element -- a picture chosen on the device, not yet sent */}
      <img src={item.url} alt={item.file.name} className="size-20 rounded-md border object-cover" />
      <RemoveButton label={`Ta bort ${item.file.name}`} className="absolute -right-2 -top-2 bg-background" disabled={disabled} onClick={() => onChange(files.filter((_, at) => at !== index))} />
    </li>)}</ul> : null}
  </div>;
}

/** The stored photos of an entry as miniatures, Före and Efter; a click opens the picture larger in a tab of its own. */
export function PhotoStrip({ photos, api, canRemove, onRemove, busy = false }: { photos: NonNullable<DeviationView["attachments"]>; api: DeviationPhotosApi;
  canRemove?: (photo: NonNullable<DeviationView["attachments"]>[number]) => boolean; onRemove?: (photoId: string) => void; busy?: boolean }) {
  if (!photos.length) return null;
  return <div className="mt-3 space-y-2" data-testid="deviation-photos">
    {(["BEFORE", "AFTER"] as const).map((phase) => {
      const shown = photos.filter((photo) => photo.phase === phase);
      return shown.length ? <div key={phase}>
        <p className="text-xs text-muted-foreground">{DEVIATION_PHOTO_PHASES[phase]}</p>
        <ul className="mt-1 flex flex-wrap gap-2">{shown.map((photo) => <li key={photo.id} className="relative">
          <a href={api.href(photo.id)} target="_blank" rel="noreferrer" aria-label={`Visa ${photo.filename}`} className="block">
            {/* eslint-disable-next-line @next/next/no-img-element -- a private picture behind the session, not a static asset */}
            <img src={api.href(photo.id)} alt={photo.filename} loading="lazy" className="size-20 rounded-md border object-cover" />
          </a>
          {onRemove && canRemove?.(photo) ? <RemoveButton label={`Ta bort ${photo.filename}`} className="absolute -right-2 -top-2 bg-background" disabled={busy} onClick={() => onRemove(photo.id)} /> : null}
        </li>)}</ul>
      </div> : null;
    })}
  </div>;
}
