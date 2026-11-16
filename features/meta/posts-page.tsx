"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarRange, Heart, ImagePlus, Images, ListOrdered, Megaphone, MessageCircle, Plug, Plus, Save, Send, ShieldCheck, Trash2, X } from "lucide-react";
import { MediaLibraryDialog } from "@/features/website/media-picker";
import { PostScheduleButton } from "@/features/schedule/post-schedule";
import { PostNewsletterFields, type PostNewsletterInfo } from "./post-newsletter-fields";
import { PostLookFields, type LogoAvailability } from "./post-look-fields";
import { HashtagField } from "./hashtag-field";
import { postPlan, ScheduledPanel, useScheduled } from "@/features/schedule/scheduled-list";
import { QueuePage } from "@/features/schedule/queue-page";
import type { SchedulePlan } from "@/features/schedule/schedule-dialog";
import { SeriesPage } from "@/features/schedule/series-page";
import type { ScheduledView } from "@/lib/schedule/labels";
import { PageHeader, SplitPane, SplitPaneNav } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DisabledReason, disabledReasonProps } from "@/components/ui/disabled-reason";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { Panel } from "@/features/kfid/ui";
import { formatSwedish } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { cn } from "@/lib/utils";
import type { LinkedInView } from "@/lib/linkedin/server";
import type { MetaView, PostView, PublishResult } from "@/lib/meta/server";
import { BODY_MAX, CAPTION_STORE_MAX, captionLimit, facebookCaption, HEADING_MAX, instagramCaption, GRID_CROP, IMAGE_WIDTH, LINKEDIN_COMMENTARY_MAX, linkedInCommentary, postProblem } from "@/lib/meta/text";

/**
 * Inlägg (2026-11-10): the company's posts for its Facebook page, Instagram account and – since 2026-11-11 – LinkedIn. A
 * post is always a draft until an admin presses Publicera: the list to the left (the company's drafts – also the ones Min
 * webbsida and a new version make – and what was published), the open post to the right with the picture's heading and text,
 * a template, the post's text, the channels, and a preview of exactly how it will look on each. Testpublicering tries the
 * whole way without anything becoming public. Each channel needs the company's switch under Kopplingar; the server refuses
 * otherwise.
 */
export const POSTS_VIEW = "/?view=company_posts";
const postHref = (id: string) => `${POSTS_VIEW}&post=${encodeURIComponent(id)}`;
const CONNECTIONS = "/?view=advanced&section=web";

const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  draft: { label: "Utkast", tone: "neutral" }, publishing: { label: "Publiceras", tone: "info" }, published: { label: "Publicerat", tone: "success" },
  partial: { label: "Delvis publicerat", tone: "warning" }, failed: { label: "Misslyckades", tone: "danger" },
};
const SOURCE: Record<string, string> = { website: "Från Min webbsida", release: "Ny version", manual: "" };

type Draft = Pick<PostView, "heading" | "body" | "caption" | "hashtags" | "link" | "template" | "logoVariant" | "logoSize" | "logoPlate" | "toFacebook" | "toInstagram" | "toLinkedIn" | "toNewsletter" | "newsletterMail" | "toStory">;
const draftOf = (post: PostView): Draft => ({ heading: post.heading, body: post.body, caption: post.caption, hashtags: post.hashtags, link: post.link, template: post.template, logoVariant: post.logoVariant, logoSize: post.logoSize, logoPlate: post.logoPlate, toFacebook: post.toFacebook, toInstagram: post.toInstagram, toLinkedIn: post.toLinkedIn, toNewsletter: post.toNewsletter, newsletterMail: post.newsletterMail, toStory: post.toStory });
const same = (left: Draft, right: Draft) => JSON.stringify(left) === JSON.stringify(right);

/** Why nothing can be published now, or null. */
export function publishBlock(connection: MetaView | null): string | null {
  if (!connection || connection.status === "missing") return "Koppla Facebook och Instagram under Kopplingar först.";
  if (connection.status === "choose" || !connection.page) return "Välj Facebooksida under Kopplingar först.";
  if (connection.status === "invalid") return connection.statusMessage ?? "Kopplingen fungerar inte. Hämta en ny token under Kopplingar.";
  if (!connection.publishingApproved) return "Publicering är avstängd. Slå på den under Kopplingar.";
  return null;
}

/** Why nothing can be published to LinkedIn now, or null. */
export function linkedInBlock(linkedin: LinkedInView | null): string | null {
  if (!linkedin || linkedin.status === "missing" || !linkedin.connected) return "Koppla LinkedIn under Kopplingar först.";
  if (linkedin.status === "choose" || !linkedin.author) return "Välj var LinkedIn-inläggen ska publiceras under Kopplingar först.";
  if (linkedin.status === "invalid") return linkedin.statusMessage ?? "Kopplingen till LinkedIn fungerar inte. Koppla igen under Kopplingar.";
  if (!linkedin.publishingApproved) return "Publicering till LinkedIn är avstängd. Slå på den under Kopplingar.";
  return null;
}

/** The first reason among the channels the draft uses, or null. */
const draftBlock = (draft: Pick<Draft, "toFacebook" | "toInstagram" | "toLinkedIn">, meta: string | null, linkedin: string | null) =>
  ((draft.toFacebook || draft.toInstagram) && meta) || (draft.toLinkedIn && linkedin) || null;

export function PostsPage({ post: chosen, series, queue }: { post: string | null; /** Innehållsserie (2026-11-11): "new" or a series' id. */ series?: string | null; /** Schemalägg i tur och ordning (2026-11-12). */ queue?: string | null }) {
  const router = useRouter();
  const [posts, setPosts] = useState<PostView[] | null>(null);
  const [connection, setConnection] = useState<MetaView | null>(null);
  const [linkedin, setLinkedin] = useState<LinkedInView | null>(null);
  // Även som nyhetsbrev (2026-11-12): only the person with Utskick gets it from the server; null hides the choice.
  const [newsletter, setNewsletter] = useState<PostNewsletterInfo>(null);
  // Logga (2026-11-13): which of the company's logos exist, for the editor's choice.
  const [logos, setLogos] = useState<LogoAvailability | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const result = await api<{ posts: PostView[]; connection: MetaView; linkedin?: LinkedInView; newsletter?: PostNewsletterInfo; logos?: LogoAvailability }>("/api/meta/posts", { cache: "no-store" });
      setPosts(result.posts); setConnection(result.connection); setLinkedin(result.linkedin ?? null); setNewsletter(result.newsletter ?? null); setLogos(result.logos ?? null); setError("");
    } catch (cause) { setError((cause as Error).message); }
  }, []);
  useLoadEffect(load);
  const [creating, setCreating] = useState(false);
  const metaBlock = publishBlock(connection);
  const liBlock = linkedInBlock(linkedin);
  const create = async () => {
    setCreating(true);
    try {
      // A new post goes where publishing works: Facebook (and Instagram when the page has it) unless only LinkedIn is ready, and LinkedIn when it is.
      const channels = { toFacebook: !metaBlock || Boolean(liBlock), toInstagram: Boolean(connection?.instagram) && (!metaBlock || Boolean(liBlock)), toLinkedIn: !liBlock };
      const result = await api<{ post: PostView }>("/api/meta/posts", { method: "POST", body: JSON.stringify({ action: "create", ...channels }) });
      setPosts((current) => [result.post, ...(current ?? [])]);
      router.push(postHref(result.post.id));
    } catch (cause) { setError((cause as Error).message); } finally { setCreating(false); }
  };
  const open = posts?.find((item) => item.id === chosen) ?? null;
  const replace = (next: PostView) => setPosts((current) => (current ?? []).map((item) => (item.id === next.id ? next : item)));
  const remove = (id: string) => { setPosts((current) => (current ?? []).filter((item) => item.id !== id)); router.push(POSTS_VIEW); void scheduled.reload(); };
  // Schemalagt (2026-11-11): the company's scheduled posts and pages, above the list.
  const scheduled = useScheduled();

  const newButton = <Button type="button" onClick={() => void create()} disabled={creating || !posts} data-testid="post-new"><Plus />Nytt inlägg</Button>;
  const seriesButton = <Button type="button" variant="outline" asChild><Link href={`${POSTS_VIEW}&series=new`} data-testid="post-series-new"><CalendarRange />Ny serie</Link></Button>;
  const queueButton = <Button type="button" variant="outline" asChild><Link href={`${POSTS_VIEW}&queue=new`} data-testid="post-queue-new"><ListOrdered />I tur och ordning</Link></Button>;
  if (queue) return <QueuePage onChanged={async () => { await load(); await scheduled.reload(); }} />;
  if (series) return <SeriesPage id={series} connection={connection} linkedin={linkedin} logos={logos} onChanged={async () => { await load(); await scheduled.reload(); }} />;
  // Sidans huvudåtgärder (2026-11-15): Ny serie, I tur och ordning och Nytt inlägg står alltid uppe till höger, också
  // medan ett inlägg är öppet; det öppna inläggets egna knappar (Ta bort, Spara, Schemalägg, Publicera) står i dess rad.
  const mainActions = <>{seriesButton}{queueButton}{newButton}</>;
  if (error && !posts) return <div className="space-y-4"><PageHeader title="Inlägg" actions={mainActions} /><p className="notice text-destructive" role="alert">{error}</p></div>;
  // The page's notice: only when no channel can be used (LinkedIn's reason once LinkedIn is connected, else Meta's).
  const block = metaBlock && liBlock ? (linkedin?.connected ? liBlock : metaBlock) : null;
  return <div className="space-y-4" data-testid="posts-page">
    <PageHeader title="Inlägg" description="Inlägg till Facebook, Instagram och LinkedIn. Inget publiceras förrän du trycker Publicera eller Schemalägg." actions={mainActions} />
    {block && connection ? <div className="notice flex flex-wrap items-center gap-3" data-testid="posts-guard">
      <p className="min-w-0 flex-1">{block}</p>
      <Button type="button" variant="outline" size="sm" asChild><Link href={CONNECTIONS} data-testid="posts-open-connections"><Plug />Öppna Kopplingar</Link></Button>
    </div> : null}
    {!block && ((!metaBlock && connection?.status === "action" && connection.statusMessage) || (!liBlock && linkedin?.status === "action" && linkedin.statusMessage)) ? <div className="notice flex flex-wrap items-center gap-3" role="status" data-testid="posts-warning">
      <p className="min-w-0 flex-1">{!metaBlock && connection?.status === "action" ? connection.statusMessage : `LinkedIn: ${linkedin?.statusMessage}`}</p>
      <Button type="button" variant="outline" size="sm" asChild><Link href={CONNECTIONS}><Plug />Öppna Kopplingar</Link></Button>
    </div> : null}
    <ScheduledPanel items={scheduled.items} error={scheduled.error} rhythm={scheduled.rhythm} onRhythmChanged={scheduled.setRhythm} onChanged={async () => { await scheduled.reload(); await load(); }} />
    {!posts ? <p className="text-sm text-muted-foreground">Hämtar inläggen…</p> : <SplitPane chosen={Boolean(open)} testId="posts-split" list={posts.length
      ? <SplitPaneNav label="Inlägg" area="admin" items={posts.map((item) => ({
        href: postHref(item.id), title: item.heading.trim() || "Utan rubrik", icon: Megaphone, testId: `post-row-${item.id}`, current: item.id === open?.id,
        status: { label: STATUS[item.status]?.label ?? item.status, tone: STATUS[item.status]?.tone ?? "neutral", detail: [SOURCE[item.source], formatSwedish(item.publishedAt ?? item.createdAt, { dateStyle: "medium" })].filter(Boolean).join(" · ") },
      }))} />
      : <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground" data-testid="posts-empty">Inga inlägg ännu. Tryck Nytt inlägg, eller kryssa i Dela även på Facebook och Instagram när du publicerar en sida i Min webbsida.</div>}>
      {open ? <PostEditor key={open.id} post={open} connection={connection} linkedin={linkedin} newsletter={newsletter} logos={logos} metaBlock={metaBlock} linkedInBlock={liBlock} onSaved={replace} onRemoved={remove}
        scheduled={scheduled.items?.find((item) => item.kind === "post" && item.targetId === open.id && ["scheduled", "needs_approval", "running"].includes(item.status)) ?? null}
        plan={postPlan(scheduled.items, scheduled.rhythm, open.id)}
        onScheduleChanged={async () => { await scheduled.reload(); }} />
        : <div className="hidden rounded-lg border border-dashed p-6 text-sm text-muted-foreground md:block">Välj ett inlägg i listan.</div>}
    </SplitPane>}
  </div>;
}

function Counter({ value, max }: { value: string; max: number }) {
  return <span className={cn("text-xs tabular-nums", value.length > max ? "text-destructive" : "text-muted-foreground")}>{value.length}/{max}</span>;
}

function PostEditor({ post, connection, linkedin, newsletter, logos, metaBlock, linkedInBlock: liBlock, onSaved, onRemoved, scheduled, plan, onScheduleChanged }: {
  post: PostView; connection: MetaView | null; linkedin: LinkedInView | null; newsletter: PostNewsletterInfo; logos: LogoAvailability | null; metaBlock: string | null; linkedInBlock: string | null;
  onSaved: (post: PostView) => void; onRemoved: (id: string) => void;
  scheduled: ScheduledView | null; plan: SchedulePlan; onScheduleChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(post));
  const [saved, setSaved] = useState<Draft>(() => draftOf(post));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const locked = post.status === "published" || post.status === "publishing";
  const dirty = !same(draft, saved);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const problem = postProblem({ ...draft, link: draft.link || null });
  const picture = usePicture(draft, post.id, `${post.backgroundSource ?? ""}:${post.updatedAt}`);
  // Även som story (2026-11-13): on the post's Facebook page and/or Instagram account; greyed with the reason when neither is chosen.
  const storyChannels = draft.toFacebook || draft.toInstagram;
  const story = draft.toStory && storyChannels;
  const storyPicture = usePicture(draft, post.id, `${post.backgroundSource ?? ""}:${post.updatedAt}`, "story", story);

  const save = async (): Promise<PostView | null> => {
    setBusy(true); setMessage(null);
    try {
      const answer = await api<{ post: PostView }>("/api/meta/posts", { method: "POST", body: JSON.stringify({ action: "update", id: post.id, ...draft, link: draft.link?.trim() || null,
        // Även som nyhetsbrev: only the person with Utskick sends these; for anyone else the server keeps them as they are.
        ...(newsletter ? {} : { toNewsletter: undefined, newsletterMail: undefined }) }) });
      onSaved(answer.post); setSaved(draftOf(answer.post)); setDraft(draftOf(answer.post));
      if (scheduled) void onScheduleChanged();
      return answer.post;
    } catch (cause) { setMessage({ text: (cause as Error).message, error: true }); return null; } finally { setBusy(false); }
  };
  const places = [draft.toFacebook ? connection?.page?.name ?? "Facebook" : null, draft.toInstagram ? (connection?.instagram?.username ? `@${connection.instagram.username}` : "Instagram") : null,
    draft.toLinkedIn ? `LinkedIn (${linkedin?.author?.name ?? "kontot"})` : null].filter((place): place is string => Boolean(place));
  const where = places.length > 1 ? `${places.slice(0, -1).join(", ")} och ${places[places.length - 1]}` : places[0] ?? "";
  const testSteps = [draft.toFacebook ? "Facebook tar emot bilden utan att visa den, och den tas bort direkt." : null, draft.toInstagram ? "Instagram hämtar och kontrollerar bilden utan att publicera." : null,
    story ? "Storybilden provas på samma sätt." : null,
    draft.toLinkedIn ? "LinkedIn kontrollerar kopplingen och tar emot bilden utan att något inlägg görs." : null].filter(Boolean).join(" ");
  const mailing = newsletter && draft.toNewsletter ? newsletter : null;
  const publish = async (mode: "test" | "live") => {
    const ok = mode === "test"
      ? await confirm({ title: "Testpublicera?", message: `${testSteps} Inget syns för andra.`, confirmLabel: "Testa" })
      : await confirm({ title: "Publicera nu?", message: `Inlägget publiceras på ${where} och syns för alla.${story ? " Även som story." : ""} Det kan inte ångras härifrån.${mailing ? ` Skickas även som nyhetsbrev till ${mailing.recipients} mottagare.` : ""}`, confirmLabel: "Publicera",
        checkbox: { label: mailing ? "Jag har läst texten, tittat på bilden och läst nyhetsbrevet." : "Jag har läst texten och tittat på bilden.", required: true, testId: "post-publish-check" } });
    if (!ok) return;
    if (dirty && !(await save())) return;
    setBusy(true); setMessage(null); setResult(null);
    try {
      const answer = await api<PublishResult>("/api/meta/posts", { method: "POST", body: JSON.stringify({ action: "publish", id: post.id, mode, confirm: true }) });
      setResult(answer); onSaved(answer.post);
    } catch (cause) { setMessage({ text: (cause as Error).message, error: true }); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirm({ title: "Ta bort inlägget?", message: post.status === "published" ? "Inlägget tas bort från Workflow. Det ligger kvar där det publicerades." : "Utkastet tas bort.", confirmLabel: "Ta bort", tone: "danger" }))) return;
    setBusy(true);
    try { await api("/api/meta/posts", { method: "POST", body: JSON.stringify({ action: "delete", id: post.id }) }); onRemoved(post.id); }
    catch (cause) { setMessage({ text: (cause as Error).message, error: true }); setBusy(false); }
  };

  const block = draftBlock(draft, metaBlock, liBlock);
  const publishReason = block ?? problem ?? (locked ? "Inlägget är redan publicerat." : null);
  const testReason = block ?? problem;
  return <div className="space-y-4" data-testid="post-editor">
    {confirmElement}
    <div className="flex flex-wrap items-center justify-end gap-2" data-testid="post-actions">
      <Button type="button" variant="ghost" className="text-destructive" disabled={busy || post.status === "publishing"} onClick={() => void remove()} data-testid="post-delete"><Trash2 />Ta bort</Button>
      <Button type="button" variant="outline" {...disabledReasonProps({ reason: busy ? null : testReason, describedBy: "post-publish-reason", onClick: () => void publish("test") })} disabled={busy} data-testid="post-test"><ShieldCheck />Testpublicering</Button>
      <Button type="button" variant="outline" disabled={busy || locked || !dirty} onClick={() => void save()} data-testid="post-save"><Save />Spara</Button>
      <PostScheduleButton postId={post.id} reason={publishReason} busy={busy} where={where} current={scheduled} plan={plan} newsletter={mailing} beforeSchedule={async () => !dirty || Boolean(await save())} onScheduled={onScheduleChanged} />
      <Button type="button" {...disabledReasonProps({ reason: busy ? null : publishReason, describedBy: "post-publish-reason", onClick: () => void publish("live") })} disabled={busy} data-testid="post-publish"><Send />Publicera</Button>
    </div>
    <DisabledReason id="post-publish-reason" reason={publishReason} className="text-right" />
    {message ? <p className={cn("notice", message.error && "text-destructive")} role="status" data-testid="post-message">{message.text}</p> : null}
    {result ? <div className="notice space-y-1" role="status" data-testid="post-result">
      <p className="font-medium">{result.message}</p>
      {result.facebook ? <p className={result.facebook.ok ? "" : "text-destructive"}>Facebook: {result.facebook.message}</p> : null}
      {result.instagram ? <p className={result.instagram.ok ? "" : "text-destructive"}>Instagram: {result.instagram.message}</p> : null}
      {result.facebookStory ? <p className={result.facebookStory.ok ? "" : "text-destructive"} data-testid="post-result-facebook-story">Story på Facebook: {result.facebookStory.message}</p> : null}
      {result.instagramStory ? <p className={result.instagramStory.ok ? "" : "text-destructive"} data-testid="post-result-instagram-story">Story på Instagram: {result.instagramStory.message}</p> : null}
      {result.linkedin ? <p className={result.linkedin.ok ? "" : "text-destructive"} data-testid="post-result-linkedin">LinkedIn: {result.linkedin.message}</p> : null}
      {result.newsletter ? <p className={result.newsletter.ok ? "" : "text-destructive"} data-testid="post-result-newsletter">Nyhetsbrev: {result.newsletter.message}</p> : null}
    </div> : null}
    {scheduled ? <p className="text-xs text-muted-foreground" data-testid="post-scheduled">{scheduled.status === "needs_approval" ? "Ändrat efter schemaläggningen – godkänn under Schemalagt" : "Schemalagt"} till {formatSwedish(scheduled.runAt, { dateStyle: "medium", timeStyle: "short" })}.</p> : null}
    {post.status !== "draft" && !result ? <p className="text-xs text-muted-foreground" data-testid="post-state">
      {STATUS[post.status]?.label ?? post.status}{post.publishedAt ? ` ${formatSwedish(post.publishedAt, { dateStyle: "medium", timeStyle: "short" })}` : ""}{post.lastError ? `. ${post.lastError}` : "."}
    </p> : null}

    <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Panel title="Bilden" description="Rubrik och kort text i bilden, med företagets färg och logotyp.">
          <fieldset disabled={locked} className="space-y-3">
            <div className="field-stack"><div className="flex items-center justify-between gap-2"><label htmlFor="post-heading" className="text-xs font-medium">Rubrik</label><Counter value={draft.heading} max={HEADING_MAX} /></div>
              <Input id="post-heading" value={draft.heading} maxLength={HEADING_MAX} onChange={(event) => set("heading", event.target.value)} data-testid="post-heading" /></div>
            <div className="field-stack"><div className="flex items-center justify-between gap-2"><label htmlFor="post-body" className="text-xs font-medium">Kort text</label><Counter value={draft.body} max={BODY_MAX} /></div>
              <textarea id="post-body" className="form-textarea min-h-20" value={draft.body} maxLength={BODY_MAX} onChange={(event) => set("body", event.target.value)} data-testid="post-body" /></div>
            {/* Fler mallar (2026-11-12) and the logo's variant and size (2026-11-13). */}
            <PostLookFields prefix="post" logos={logos} value={{ template: draft.template, logoVariant: draft.logoVariant, logoSize: draft.logoSize, logoPlate: draft.logoPlate }} onChange={(look) => setDraft((current) => ({ ...current, ...look }))} />
          </fieldset>
          <BackgroundField post={post} disabled={locked} onSaved={onSaved} />
        </Panel>
        <Panel title="Inlägget" description="Texten som står i inlägget.">
          <fieldset disabled={locked} className="space-y-3">
            <div className="field-stack"><div className="flex items-center justify-between gap-2"><label htmlFor="post-caption" className="text-xs font-medium">Text</label><Counter value={draft.caption} max={captionLimit(draft)} /></div>
              <textarea id="post-caption" className="form-textarea min-h-32" value={draft.caption} maxLength={CAPTION_STORE_MAX} onChange={(event) => set("caption", event.target.value)} data-testid="post-caption" />
              {draft.toLinkedIn ? <p className="text-xs text-muted-foreground" data-testid="post-linkedin-count">LinkedIn: {linkedInCommentary({ caption: draft.caption, hashtags: draft.hashtags, link: draft.link?.trim() || null }).length}/{LINKEDIN_COMMENTARY_MAX} tecken med hashtaggar och länk.</p> : null}</div>
            <HashtagField value={draft.hashtags} onChange={(value) => set("hashtags", value)} />
            <div className="field-stack"><label htmlFor="post-link" className="text-xs font-medium">Länk</label>
              <Input id="post-link" type="url" inputMode="url" value={draft.link ?? ""} maxLength={500} placeholder="https://" onChange={(event) => set("link", event.target.value)} data-testid="post-link" />
              <p className="text-xs text-muted-foreground">Visas på Facebook och LinkedIn. Instagram visar inga länkar i inlägg.</p></div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><Checkbox checked={draft.toFacebook} onCheckedChange={(value) => set("toFacebook", value === true)} data-testid="post-to-facebook" />Facebook{connection?.page ? ` (${connection.page.name})` : ""}</label>
              <label className={cn("flex min-h-11 cursor-pointer items-center gap-2 text-sm", !connection?.instagram && "text-muted-foreground")}><Checkbox checked={draft.toInstagram} disabled={!connection?.instagram && !draft.toInstagram} onCheckedChange={(value) => set("toInstagram", value === true)} data-testid="post-to-instagram" />Instagram{connection?.instagram?.username ? ` (@${connection.instagram.username})` : connection?.page ? " (inget konto kopplat)" : ""}</label>
              {/* LinkedIn (2026-11-11): greyed with the reason until it is connected and publishing is on; a chosen box can always be unticked. */}
              <label className={cn("flex min-h-11 items-center gap-2 text-sm", liBlock && !draft.toLinkedIn ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer")} title={liBlock && !draft.toLinkedIn ? liBlock : undefined}>
                <Checkbox checked={draft.toLinkedIn} disabled={Boolean(liBlock) && !draft.toLinkedIn} aria-describedby={liBlock ? "post-linkedin-reason" : undefined} onCheckedChange={(value) => set("toLinkedIn", value === true)} data-testid="post-to-linkedin" />
                LinkedIn{linkedin?.author ? ` (${linkedin.author.name})` : ""}</label>
            </div>
            <div className="field-stack" data-testid="post-story">
              <label className={cn("flex min-h-11 items-center gap-2 text-sm", !storyChannels && !draft.toStory ? "cursor-not-allowed text-muted-foreground" : "cursor-pointer")}>
                <Checkbox checked={draft.toStory} disabled={!storyChannels && !draft.toStory} aria-describedby="post-story-help" onCheckedChange={(value) => set("toStory", value === true)} data-testid="post-to-story" />Även som story</label>
              <p id="post-story-help" className="text-xs text-muted-foreground" data-testid="post-story-help">{!storyChannels ? "Välj Facebook eller Instagram först."
                : "Bilden i 9:16 på de valda kanalerna. En story visas i 24 timmar och kan inte ha länk."}</p>
            </div>
            <PostNewsletterFields info={newsletter} post={{ heading: draft.heading, body: draft.body, caption: draft.caption, link: draft.link?.trim() || null }} postId={post.id} disabled={locked}
              checked={draft.toNewsletter} mail={draft.newsletterMail} onToggle={(value) => set("toNewsletter", value)} onMail={(value) => set("newsletterMail", value as Draft["newsletterMail"])}
              beforePreview={async () => !dirty || Boolean(await save())} />
            {liBlock ? <p id="post-linkedin-reason" className="text-xs text-muted-foreground" data-testid="post-linkedin-reason">LinkedIn: {liBlock}</p> : null}
            {draft.toInstagram && connection?.instagram && !connection.instagramReachable ? <p className="text-xs text-muted-foreground" data-testid="post-instagram-local">Instagram hämtar bilden från Workflows adress, och den här servern nås inte från internet. Testa med bara Facebook här.</p> : null}
          </fieldset>
        </Panel>
      </div>
      <Panel title="Förhandsvisning" description="Så här ser inlägget ut.">
        <PostPreview draft={draft} picture={picture} storyPicture={story ? storyPicture : null} connection={connection} linkedin={linkedin} />
      </Panel>
    </div>
  </div>;
}

/**
 * The picture drawn by the server from the heading, text and template – asked again a moment after typing stops. `format` story:
 * the 9:16 story picture, asked only while `enabled`.
 */
function usePicture(draft: Draft, postId: string, backgroundVersion: string, format: "feed" | "story" = "feed", enabled = true) {
  const [url, setUrl] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  const key = useMemo(() => JSON.stringify({ heading: draft.heading, body: draft.body, template: draft.template, logoVariant: draft.logoVariant, logoSize: draft.logoSize, logoPlate: draft.logoPlate, id: postId, format, v: backgroundVersion }), [draft.heading, draft.body, draft.template, draft.logoVariant, draft.logoSize, draft.logoPlate, postId, format, backgroundVersion]);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/meta/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify((({ v: _version, ...rest }) => { void _version; return { action: "preview", ...rest }; })(JSON.parse(key))) });
        if (!response.ok || stopped) return;
        const next = URL.createObjectURL(await response.blob());
        if (current.current) URL.revokeObjectURL(current.current);
        current.current = next;
        setUrl(next);
      } catch { /* the preview waits for the next change */ }
    }, 450);
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [key, enabled]);
  useEffect(() => () => { if (current.current) URL.revokeObjectURL(current.current); }, []);
  return url;
}

/**
 * Bakgrundsbild (2026-11-10): a picture behind the template – one from the connected site's media library (listed through
 * the app's own server) or an upload. The server fetches and stores it; the browser never loads a picture from another host.
 */
function BackgroundField({ post, disabled, onSaved }: { post: PostView; disabled: boolean; onSaved: (post: PostView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [media, setMedia] = useState<{ id: number; url: string; thumb: string; alt: string }[] | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const run = async (work: () => Promise<{ post: PostView }>) => {
    setBusy(true); setError("");
    try { onSaved((await work()).post); setChoosing(false); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); if (file.current) file.current.value = ""; }
  };
  const choose = (url: string | null) => void run(() => api<{ post: PostView }>("/api/meta/posts", { method: "POST", body: JSON.stringify({ action: "background", id: post.id, url }) }));
  const upload = (picked: File | undefined) => {
    if (!picked) return;
    const form = new FormData();
    form.append("id", post.id);
    form.append("file", picked);
    void run(() => api<{ post: PostView }>("/api/meta/posts", { method: "POST", body: form }));
  };
  const openLibrary = async () => {
    setChoosing(true);
    if (media) return;
    try { setMedia((await api<{ media: { id: number; url: string; thumb: string; alt: string }[] }>("/api/meta/posts?media=1")).media); }
    catch (cause) { setError((cause as Error).message); setMedia([]); }
  };
  const label = !post.backgroundSource ? "Ingen – mallens egen färg." : post.backgroundSource === "uppladdad" ? "Uppladdad bild." : "Bild från webbplatsen.";
  return <div className="field-stack" data-testid="post-background">
    <span className="text-xs font-medium">Bakgrundsbild</span>
    <p className="text-xs text-muted-foreground" data-testid="post-background-state">{label}</p>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => void openLibrary()} data-testid="post-background-site"><Images />Välj från webbplatsen</Button>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" aria-label="Ladda upp en bakgrundsbild" onChange={(event) => upload(event.target.files?.[0])} data-testid="post-background-file" />
      <Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => file.current?.click()}><ImagePlus />Ladda upp</Button>
      {post.backgroundSource ? <Button type="button" variant="ghost" size="sm" disabled={disabled || busy} onClick={() => choose(null)} data-testid="post-background-remove"><X />Ta bort</Button> : null}
    </div>
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    <MediaLibraryDialog open={choosing} onOpenChange={setChoosing} title="Välj bakgrundsbild" media={media} busy={busy} onChoose={(item) => choose(item.url)} testId="post-background-media" />
  </div>;
}

function Avatar({ name }: { name: string }) {
  return <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700" aria-hidden="true">{(name.trim()[0] ?? "?").toUpperCase()}</span>;
}

/** Exactly what goes out: Facebook's and LinkedIn's text (with the link) above the picture, Instagram's picture with the text under the name. */
export function PostPreview({ draft, picture, storyPicture = null, connection, linkedin = null }: { draft: Draft; picture: string | null;
  /** Även som story (2026-11-13): the 9:16 story picture, shown beside the posts when the story is chosen. */
  storyPicture?: string | null; connection: MetaView | null; linkedin?: LinkedInView | null }) {
  const pageName = connection?.page?.name ?? "Företagets sida";
  const username = connection?.instagram?.username ?? "företaget";
  const linkedInName = linkedin?.author?.name ?? "Företaget";
  const [grid, setGrid] = useState(false);
  // eslint-disable-next-line @next/next/no-img-element -- a picture drawn by the app's own server, as a blob address.
  const image = picture ? <img src={picture} alt="Inläggets bild" className="block aspect-[4/5] w-full object-cover" data-testid="post-picture" /> : <div className="aspect-[4/5] w-full animate-pulse bg-slate-100" aria-label="Bilden ritas" />;
  // Instagrams rutnät (2026-11-12): the profile shows a centred 3:4 tile of the 4:5 picture; a dashed outline shows it.
  const inset = `${(GRID_CROP.x / IMAGE_WIDTH) * 100}%`;
  const instagramImage = <div className="relative">{image}{grid ? <div className="pointer-events-none absolute inset-y-0 border-2 border-dashed border-white outline-2 outline-dashed outline-slate-900/70" style={{ left: inset, right: inset }} data-testid="preview-instagram-grid">
    <span className="absolute left-1 top-1 rounded bg-slate-900/75 px-1.5 py-0.5 text-[11px] font-medium text-white">Instagrams rutnät</span></div> : null}</div>;
  if (!draft.toFacebook && !draft.toInstagram && !draft.toLinkedIn) return <p className="text-sm text-muted-foreground">Välj Facebook, Instagram, LinkedIn eller flera.</p>;
  return <div className="@container space-y-3">
    {draft.toInstagram ? <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><Checkbox checked={grid} onCheckedChange={(value) => setGrid(value === true)} data-testid="preview-grid-toggle" />Visa vad Instagrams rutnät visar</label> : null}
    <div className="grid justify-items-center gap-4 @xl:grid-cols-2 @xl:items-start">
    {draft.toFacebook ? <figure className="w-full min-w-0 max-w-[22rem] overflow-hidden rounded-lg border bg-white text-slate-900" data-testid="preview-facebook" aria-label="Förhandsvisning på Facebook">
      <figcaption className="sr-only">Facebook</figcaption>
      <div className="flex items-center gap-2.5 px-3 pt-3"><Avatar name={pageName} /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{pageName}</span><span className="block text-xs text-slate-500">Just nu</span></span></div>
      <p className="whitespace-pre-wrap break-words px-3 py-2.5 text-sm leading-5" data-testid="preview-facebook-text">{facebookCaption({ caption: draft.caption, hashtags: draft.hashtags, link: draft.link?.trim() || null })}</p>
      {image}
      <div className="flex justify-around border-t px-3 py-2 text-xs font-medium text-slate-500"><span>Gilla</span><span>Kommentera</span><span>Dela</span></div>
    </figure> : null}
    {draft.toInstagram ? <figure className="w-full min-w-0 max-w-[22rem] overflow-hidden rounded-lg border bg-white text-slate-900" data-testid="preview-instagram" aria-label="Förhandsvisning på Instagram">
      <figcaption className="sr-only">Instagram</figcaption>
      <div className="flex items-center gap-2.5 px-3 py-2.5"><Avatar name={username} /><span className="truncate text-sm font-semibold">{username}</span></div>
      {instagramImage}
      <div className="flex gap-3 px-3 pt-2.5 text-slate-800"><Heart className="size-5" aria-hidden="true" /><MessageCircle className="size-5" aria-hidden="true" /><Send className="size-5" aria-hidden="true" /></div>
      <p className="whitespace-pre-wrap break-words px-3 pb-3 pt-1.5 text-sm leading-5" data-testid="preview-instagram-text"><span className="font-semibold">{username}</span> {instagramCaption({ caption: draft.caption, hashtags: draft.hashtags })}</p>
    </figure> : null}
    {draft.toLinkedIn ? <figure className="w-full min-w-0 max-w-[22rem] overflow-hidden rounded-lg border bg-white text-slate-900" data-testid="preview-linkedin" aria-label="Förhandsvisning på LinkedIn">
      <figcaption className="sr-only">LinkedIn</figcaption>
      <div className="flex items-center gap-2.5 px-3 pt-3"><Avatar name={linkedInName} /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{linkedInName}</span><span className="block text-xs text-slate-500">Nu</span></span></div>
      <p className="whitespace-pre-wrap break-words px-3 py-2.5 text-sm leading-5" data-testid="preview-linkedin-text">{linkedInCommentary({ caption: draft.caption, hashtags: draft.hashtags, link: draft.link?.trim() || null })}</p>
      {image}
      <div className="flex justify-around border-t px-3 py-2 text-xs font-medium text-slate-500"><span>Gilla</span><span>Kommentera</span><span>Dela</span><span>Skicka</span></div>
    </figure> : null}
    {draft.toStory && (draft.toFacebook || draft.toInstagram) ? <figure className="w-full min-w-0 max-w-[15rem] overflow-hidden rounded-lg border bg-slate-900 text-white" data-testid="preview-story" aria-label="Förhandsvisning av storyn">
      <figcaption className="px-3 py-2 text-xs font-medium">Story{draft.toFacebook && draft.toInstagram ? " på Facebook och Instagram" : draft.toFacebook ? " på Facebook" : " på Instagram"}</figcaption>
      {/* eslint-disable-next-line @next/next/no-img-element -- a picture drawn by the app's own server, as a blob address. */}
      {storyPicture ? <img src={storyPicture} alt="Storyns bild" className="block aspect-[9/16] w-full object-cover" data-testid="post-story-picture" /> : <div className="aspect-[9/16] w-full animate-pulse bg-slate-700" aria-label="Storybilden ritas" />}
    </figure> : null}
  </div></div>;
}
