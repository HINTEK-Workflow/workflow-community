/* eslint-disable @next/next/no-img-element -- Authenticated image endpoint. */
"use client";
import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "./ui";
import { attachmentLabel } from "@/lib/kfid/editor-tools";
import type { ControlData } from "@/lib/kfid/model";
import type { AttachmentItem } from "./types";
export function ImageGallery({
  id,
  files,
  data,
  onSelect,
}: {
  id: string | null;
  files: AttachmentItem[];
  data: ControlData;
  onSelect: (id: string | null) => void;
}) {
  const images = files.filter((f) => f.mimeType.startsWith("image/"));
  const index = images.findIndex((f) => f.id === id),
    current = images[index];
  const start = useRef<{ x: number; y: number } | null>(null);
  const move = (direction: number) => {
    if (images.length)
      onSelect(images[(index + direction + images.length) % images.length].id);
  };
  useEffect(() => {
    if (!id) return;
    const listener = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const next =
          (index + (e.key === "ArrowLeft" ? -1 : 1) + images.length) %
          images.length;
        if (images[next]) onSelect(images[next].id);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [id, index, images, onSelect]);
  return (
    <Modal
      open={Boolean(id)}
      onOpenChange={(open) => {
        if (!open) onSelect(null);
      }}
      title="Bildvisning"
    >
      {current && (
        <div className="space-y-4">
          <img
            draggable={false}
            src={current.url || `/api/files/${current.id}`}
            alt={current.filename}
            className="max-h-[65vh] w-full touch-pan-y rounded-lg bg-muted object-contain"
            onPointerDown={(e) => {
              start.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={(e) => {
              if (start.current) {
                const dx = e.clientX - start.current.x,
                  dy = e.clientY - start.current.y;
                if (Math.abs(dx) > 50 && Math.abs(dy) < 70)
                  move(dx < 0 ? 1 : -1);
              }
              start.current = null;
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="outline"
              size="icon"
              aria-label="Föregående bild"
              disabled={images.length < 2}
              onClick={() => move(-1)}
            >
              <ChevronLeft />
            </Button>
            <div className="text-center">
              <p className="text-sm font-medium">
                {attachmentLabel(data, current)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Bild {index + 1} av {images.length} · {current.filename}
              </p>
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label="Nästa bild"
              disabled={images.length < 2}
              onClick={() => move(1)}
            >
              <ChevronRight />
            </Button>
          </div>
          <Button asChild variant="outline">
            <a
              download={current.filename}
              href={current.url || `/api/files/${current.id}`}
            >
              <Download />
              Ladda ned bilden
            </a>
          </Button>
        </div>
      )}
    </Modal>
  );
}
