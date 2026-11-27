"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { HASHTAG_FIELD_MAX, normalizeHashtags } from "@/lib/meta/text";
import { cn } from "@/lib/utils";

/**
 * Hashtaggar (2026-11-12): typed words become #tags (Enter, space, comma or leaving the field), shown as chips with a
 * remove button; they follow the text on Facebook, Instagram and LinkedIn, never in the newsletter. Shared by a post and Ny serie
 * (2026-11-13); `id` is the field's id and the prefix of its test ids.
 */
export function HashtagField({ value, onChange, id = "post-hashtags", disabled = false }: { value: string; onChange: (value: string) => void; id?: string; disabled?: boolean }) {
  const [typed, setTyped] = useState("");
  const tags = value ? value.split(" ") : [];
  const add = (text: string) => { if (text.trim()) onChange(normalizeHashtags(`${value} ${text}`)); setTyped(""); };
  const full = tags.length >= HASHTAG_FIELD_MAX;
  return <div className="field-stack">
    <div className="flex items-center justify-between gap-2"><label htmlFor={id} className="text-xs font-medium">Hashtaggar</label>
      <span className="text-xs tabular-nums text-muted-foreground" data-testid={`${id}-count`}>{tags.length}/{HASHTAG_FIELD_MAX}</span></div>
    {tags.length ? <ul className="flex flex-wrap gap-1.5" aria-label="Valda hashtaggar" data-testid={`${id}-list`}>
      {tags.map((tag) => <li key={tag} className="inline-flex min-h-8 items-center gap-0.5 rounded-full border bg-muted/50 pl-3 pr-1 text-sm" data-testid={id === "post-hashtags" ? "post-hashtag" : `${id}-tag`}>
        <span>{tag}</span>
        <button type="button" disabled={disabled} className={cn("inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")} aria-label={`Ta bort ${tag}`} title={`Ta bort ${tag}`}
          onClick={() => onChange(tags.filter((other) => other !== tag).join(" "))}><X className="size-3.5" aria-hidden="true" /></button>
      </li>)}
    </ul> : null}
    <Input id={id} value={typed} disabled={full || disabled} placeholder={full ? `Högst ${HASHTAG_FIELD_MAX}` : "Skriv ett ord och tryck Enter"} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby={`${id}-help`}
      onChange={(event) => { const next = event.target.value; if (/[\s,;]$/.test(next)) add(next); else setTyped(next); }}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(typed); } else if (event.key === "Backspace" && !typed && tags.length) onChange(tags.slice(0, -1).join(" ")); }}
      onBlur={() => add(typed)} onPaste={(event) => { const text = event.clipboardData.getData("text"); if (/[\s,;#]/.test(text.trim())) { event.preventDefault(); add(`${typed} ${text}`); } }} data-testid={id} />
    <p id={`${id}-help`} className="text-xs text-muted-foreground">Läggs efter texten på Facebook, Instagram och LinkedIn. Skriv ord med eller utan #.</p>
  </div>;
}
