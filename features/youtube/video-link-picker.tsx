"use client";

import { useEffect, useState } from "react";
import { api } from "@/features/kfid/api";

type Linkable = { id: string; title: string; url: string };

/**
 * Länka till en film (Filmer, 2026-11-20): one choice under a post's text. The chosen published film's YouTube address is added
 * at the end of the text; nothing is embedded and nothing is loaded from YouTube. Hidden while the company has no published film
 * that others may see (Olistad or Offentlig).
 */
export function VideoLinkPicker({ text, disabled, onChange }: { text: string; disabled?: boolean; onChange: (text: string) => void }) {
  const [videos, setVideos] = useState<Linkable[]>([]);
  useEffect(() => {
    let active = true;
    void api<{ videos: Linkable[] }>("/api/youtube/videos?linkable=1", { cache: "no-store" }).then((result) => { if (active) setVideos(result.videos); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  if (!videos.length) return null;
  return <div className="field-stack" data-testid="post-video-link">
    <label htmlFor="post-video-link" className="text-xs font-medium">Länka till en film</label>
    <select id="post-video-link" className="form-select" value="" disabled={disabled} aria-describedby="post-video-link-help"
      onChange={(event) => { const chosen = videos.find((video) => video.id === event.target.value); if (chosen && !text.includes(chosen.url)) onChange(`${text.trimEnd()}${text.trim() ? "\n\n" : ""}${chosen.url}`); }}
      data-testid="post-video-link-select">
      <option value="">Välj en publicerad film…</option>
      {videos.map((video) => <option key={video.id} value={video.id}>{video.title}</option>)}
    </select>
    <p id="post-video-link-help" className="text-xs text-muted-foreground">Länken till filmen på YouTube läggs sist i texten.</p>
  </div>;
}
