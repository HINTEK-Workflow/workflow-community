"use client";

import { Input } from "@/components/ui/input";

/**
 * Sökmotorer och delning, the shared parts (2026-11-11): the search-result preview and the title and description fields with
 * their counters. The landing editor (ee/landing/ui/landing-panels.tsx) and Min webbsida (features/website/seo-panel.tsx) use
 * the same parts, so a page's search settings look and behave alike everywhere.
 * The fields stop at the limit as the browser counts (UTF-16 units), never above what WordPress (code points) accepts.
 */

/** How the page can look in a search result: the address, the title and the description (the standards when empty). */
export function SearchResultPreview({ address, title, description, hidden = false, testId }: { address: string; title: string; description: string; hidden?: boolean; testId?: string }) {
  return <div className="rounded-lg border bg-card p-3" aria-label="Så kan sidan se ut i en sökträff" data-testid={testId}>
    <p className="truncate text-xs text-muted-foreground">{address}</p>
    <p className="mt-0.5 line-clamp-2 font-semibold text-primary">{title}</p>
    <p className="mt-0.5 line-clamp-3 text-xs text-muted-foreground">{description}</p>
    {hidden ? <p className="mt-1.5 text-xs font-medium text-foreground" data-testid={testId ? `${testId}-hidden` : undefined}>Visas inte i sökmotorer.</p> : null}
  </div>;
}

/** The title and the description, each with its counter; empty fields give the standard texts (their placeholders). */
export function SeoTextFields({ idPrefix, title, description, titleMax, descriptionMax, titlePlaceholder, descriptionPlaceholder, onTitle, onDescription, titleHint = "Tomt ger standardtiteln.", descriptionHint = "Tomt ger standardtexten." }: {
  idPrefix: string; title: string; description: string; titleMax: number; descriptionMax: number; titlePlaceholder: string; descriptionPlaceholder: string;
  onTitle: (value: string) => void; onDescription: (value: string) => void; titleHint?: string; descriptionHint?: string;
}) {
  const titleLength = title.length;
  const descriptionLength = description.length;
  return <>
    <div className="field-stack"><label htmlFor={`${idPrefix}-title`} className="text-xs font-medium">Sidtitel</label>
      <Input id={`${idPrefix}-title`} maxLength={titleMax} value={title} placeholder={titlePlaceholder}
        onChange={(event) => onTitle(event.target.value)} data-testid={`${idPrefix}-title`} />
      <p className="text-xs text-muted-foreground" data-testid={`${idPrefix}-title-count`}>{titleLength} av {titleMax} tecken. {titleHint}</p>
    </div>
    <div className="field-stack"><label htmlFor={`${idPrefix}-description`} className="text-xs font-medium">Beskrivning</label>
      <textarea id={`${idPrefix}-description`} className="form-textarea min-h-20" maxLength={descriptionMax} value={description} placeholder={descriptionPlaceholder}
        onChange={(event) => onDescription(event.target.value)} data-testid={`${idPrefix}-description`} />
      <p className="text-xs text-muted-foreground" data-testid={`${idPrefix}-description-count`}>{descriptionLength} av {descriptionMax} tecken. {descriptionHint}</p>
    </div>
  </>;
}
