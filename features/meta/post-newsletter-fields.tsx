"use client";

import { useState } from "react";
import { Eye, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { NEWSLETTER_SUBJECT_MAX, NEWSLETTER_TEXT_MAX, ownFields, resolvePostMail, type NewsletterMail } from "@/lib/mail/post-newsletter-mail";

/** What Inlägg knows about the newsletter: null for everyone without Utskick, so they never see the choice. */
export type PostNewsletterInfo = { recipients: number } | null;
type PostText = { heading: string; body: string; caption: string; link: string | null };

/**
 * Även som nyhetsbrev (2026-11-12): the tick and the mail's own fields in Inlägg, only for the person with Utskick. The
 * fields start from the post – the subject the heading, the text the post's text without hashtags, its link and picture – and
 * follow it ("Följer inlägget") until one is written here ("Egen text"); "Hämta från inlägget igen" lets it follow again.
 * Visa mejlet shows the real newsletter as it will be sent (saved first). Nothing is sent from here: Publicera or Schemalägg
 * sends it once, with the post.
 */
export function PostNewsletterFields({ info, post, checked, mail, disabled, onToggle, onMail, beforePreview, postId }: {
  info: PostNewsletterInfo; post: PostText; checked: boolean; mail: unknown; disabled: boolean;
  onToggle: (value: boolean) => void; onMail: (value: NewsletterMail | null) => void;
  /** Saves the editor's changes first; false stops. */
  beforePreview: () => Promise<boolean>; postId: string;
}) {
  const [preview, setPreview] = useState<{ html: string; subject: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  if (!info) return null;
  const fields = ownFields(mail);
  const resolved = resolvePostMail({ id: postId, ...post, newsletterMail: fields }, "Nytt från oss");
  const change = (patch: NewsletterMail) => {
    const next = { ...fields, ...patch };
    const kept = Object.fromEntries(Object.entries(next).filter(([, value]) => value !== null && value !== undefined)) as NewsletterMail;
    onMail(Object.keys(kept).length ? kept : null);
  };
  const state = (follows: boolean, reset: () => void, testId: string) => follows
    ? <span className="text-xs text-muted-foreground" data-testid={`${testId}-state`}>Följer inlägget</span>
    : <span className="flex items-center gap-2 text-xs" data-testid={`${testId}-state`}><span className="font-medium">Egen text</span>
      <Button type="button" variant="ghost" size="sm" className="h-7 px-2" disabled={disabled} onClick={reset} data-testid={`${testId}-reset`}><RotateCcw />Hämta från inlägget igen</Button></span>;
  const show = async () => {
    setLoading(true); setError(null);
    try {
      if (!(await beforePreview())) { setError("Inlägget kunde inte sparas."); return; }
      setPreview(await api<{ html: string; subject: string }>("/api/meta/posts", { method: "POST", body: JSON.stringify({ action: "newsletter-preview", id: postId }) }));
    } catch (cause) { setError((cause as Error).message); } finally { setLoading(false); }
  };

  return <div className="space-y-3 border-t pt-3" data-testid="post-newsletter">
    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => onToggle(value === true)} data-testid="post-to-newsletter" />Även som nyhetsbrev
    </label>
    {checked ? <>
      <p className="text-xs text-muted-foreground" data-testid="post-newsletter-note">Skickas med inlägget, i nyhetsbrevets mall, till {info.recipients} mottagare när du publicerar eller vid den schemalagda tiden. Hashtaggar kommer inte med.</p>
      <div className="field-stack">
        <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="post-newsletter-subject" className="text-xs font-medium">Ämne</label>{state(resolved.follows.subject, () => change({ subject: null }), "post-newsletter-subject")}</div>
        <Input id="post-newsletter-subject" value={resolved.subject} maxLength={NEWSLETTER_SUBJECT_MAX} disabled={disabled} onChange={(event) => change({ subject: event.target.value })} data-testid="post-newsletter-subject" />
      </div>
      <div className="field-stack">
        <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="post-newsletter-text" className="text-xs font-medium">Text i mejlet</label>{state(resolved.follows.text, () => change({ text: null }), "post-newsletter-text")}</div>
        <textarea id="post-newsletter-text" className="form-textarea min-h-28" value={resolved.text} maxLength={NEWSLETTER_TEXT_MAX} disabled={disabled} onChange={(event) => change({ text: event.target.value })} data-testid="post-newsletter-text" />
      </div>
      <div className="field-stack">
        <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="post-newsletter-link" className="text-xs font-medium">Länk (Läs mer)</label>{state(resolved.follows.link, () => change({ link: null }), "post-newsletter-link")}</div>
        <Input id="post-newsletter-link" type="url" inputMode="url" placeholder="https://" value={resolved.link ?? ""} disabled={disabled} onChange={(event) => change({ link: event.target.value })} data-testid="post-newsletter-link" />
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
        <Checkbox checked={resolved.image} disabled={disabled} onCheckedChange={(value) => change({ image: value === true ? null : false })} data-testid="post-newsletter-image" />Inläggets bild i mejlet
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void (preview ? setPreview(null) : show())} data-testid="post-newsletter-preview"><Eye />{preview ? "Dölj mejlet" : loading ? "Hämtar…" : "Visa mejlet"}</Button>
        {error ? <span className="text-xs text-destructive" role="status">{error}</span> : null}
      </div>
      {preview ? <figure className="space-y-1" data-testid="post-newsletter-mail">
        <figcaption className="text-xs text-muted-foreground">Ämne: <span className="font-medium text-foreground">{preview.subject}</span></figcaption>
        {/* The mail's own HTML in a closed frame: no scripts, nothing of the app's page reaches it. */}
        <iframe title="Nyhetsbrevet som det skickas" sandbox="" srcDoc={preview.html} className="h-[32rem] w-full rounded-lg border bg-white" />
      </figure> : null}
    </> : null}
  </div>;
}
