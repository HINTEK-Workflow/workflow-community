"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, Newspaper, Pencil, Pin, PinOff, Plus, Save, Send, Trash2, UserRound } from "lucide-react";
import { AreaIcon } from "@/components/area-icon";
import { useEntryState } from "@/components/history-nav";
import { ListCard, ListCardGrid, ListFilterBar, useListPrefs } from "@/components/list-filter-bar";
import { ListEmpty, ListGroup, ListRow, NativeActions, NativeLargeTitle, NativePage, useNativeTopBar } from "@/components/native";
import { PageBackButton, PageHeader, PageSkeleton, usePageTrail } from "@/components/page-shell";
import { RowChevron } from "@/components/row-chevron";
import { DelayedSkeleton } from "@/components/skeleton";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { CheckField, DialogActions, Empty, Field, FormPage, FormPanel, NoPermission, Panel, RowsSkeleton } from "@/features/kfid/ui";
import { indicatorBadge, PILL_FIXED_WIDTH } from "@/features/workflow/indicator-tone";
import { useNativeMode } from "@/features/workflow/use-detail-level";
import { formatSwedish } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import { cn } from "@/lib/utils";
import {
  NEWS_BODY_MAX, NEWS_FILTERS, NEWS_STATUS_LABEL, NEWS_TITLE_MAX, NEWS_VIEW, newsHref, newsPublishProblem, type NewsFilter, type NewsPostView,
} from "@/lib/news/model";

/**
 * Nyheter (2026-11-21; Lista-mallen 2026-11-22, the product owner: "sida nyheter skall följa övriga struktur som finns på liknande sidor"):
 * Mer › Nyheter, the company's internal news, built as Tavlor and the other lists (docs/ui-system.md 2, Lista):
 *  - the list: PageHeader with Ny nyhet top right, the shared filter row (Publicerade | Utkast for the admin, the search, Rader | Kort),
 *    rows or cards in the full width, pinned first and newest first, a page at a time with Visa fler, and the shared empty box;
 *  - one post opens as its own page (`&post=`), its name as the heading, Tillbaka and – for the admin – Ta bort, Fäst överst and
 *    Redigera top right;
 *  - Ny nyhet (`&new=1`) and Redigera (`&edit=1`) are a form page (FormPage): Avbryt, Spara utkast and Publicera top right, the fields
 *    in one card; on the phone the app's screen with Avbryt and Publicera in the top bar.
 * Every member reads; only the company's admin writes, and publishing tells the others in the bell. The server decides every call
 * (lib/news/server.ts).
 */
type Listing = { items: NewsPostView[]; next: string | null; drafts: number; canWrite: boolean; moduleOn: boolean };

const DAY = { dateStyle: "medium" } as const;
const WHEN = { dateStyle: "medium", timeStyle: "short" } as const;
const NEW_HREF = `${NEWS_VIEW}&new=1`;
const SORTS = ["updated"] as const;
const dateOf = (post: NewsPostView) => post.publishedAt ?? post.updatedAt;
const metaLine = (post: NewsPostView) => [post.pinned ? "Fäst överst" : "", post.author, formatSwedish(dateOf(post), DAY)].filter(Boolean).join(" · ");
const editHref = (id: string) => `${newsHref(id)}&edit=1`;

export function NewsPage({ personId }: { personId: string }) {
  const params = useSearchParams();
  const chosen = params.get("post");
  const list = <NewsList personId={personId} />;
  if (chosen && params.get("edit") === "1") return <NewsEditPage id={chosen} behind={list} />;
  if (chosen) return <NewsPost key={chosen} id={chosen} />;
  if (params.get("new") === "1") return <NewsCreatePage behind={list} />;
  return list;
}

function NewsPill({ post }: { post: NewsPostView }) {
  return <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", PILL_FIXED_WIDTH, indicatorBadge(post.status === "draft" ? "neutral" : "success"))}>{NEWS_STATUS_LABEL[post.status]}</span>;
}

/** The list (Lista): the filter row, then rows or cards, and Visa fler. */
function NewsList({ personId }: { personId: string }) {
  const native = useNativeMode();
  const prefs = useListPrefs("news", personId, { sorts: SORTS });
  const [filter, setFilter] = useEntryState<NewsFilter>("news.filter", "published");
  const [query, setQuery] = useEntryState("news.q", "");
  const [search, setSearch] = useState(query.trim());
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);

  // The search is sent when the person stops typing.
  useEffect(() => { const timer = window.setTimeout(() => setSearch(query.trim()), 300); return () => window.clearTimeout(timer); }, [query]);
  const address = useCallback((cursor?: string | null) => `/api/news?filter=${filter}${search ? `&q=${encodeURIComponent(search)}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, [filter, search]);
  const load = useCallback(async () => {
    try { setListing(await api<Listing>(address(), { cache: "no-store" })); setError(""); }
    catch (cause) { setError((cause as Error).message); }
  }, [address]);
  useLoadEffect(load);
  const loadMore = async () => {
    if (!listing?.next) return;
    setMore(true);
    try { const page = await api<Listing>(address(listing.next), { cache: "no-store" }); setListing((current) => current ? { ...page, items: [...current.items, ...page.items] } : page); }
    catch (cause) { setError((cause as Error).message); }
    finally { setMore(false); }
  };

  const canWrite = Boolean(listing?.canWrite);
  // A member has no drafts to choose: the list is the published posts.
  const shown: NewsFilter = canWrite ? filter : "published";
  const items = listing?.items ?? [];
  const chips = canWrite ? { label: "Visa nyheter", value: filter, onChange: setFilter, testId: "news-chips",
    chips: NEWS_FILTERS.map((item) => ({ value: item.key, label: item.label, count: item.key === "draft" ? listing?.drafts ?? null : null })) } : undefined;
  const filterBar = <ListFilterBar testId="news-filter" label="Sök och filtrera nyheter" chips={chips}
    search={{ label: "Sök nyhet", placeholder: "Sök i rubrik och text", value: query, onChange: setQuery, testId: "news-search" }}
    view={{ value: prefs.view, onChange: prefs.setView }} />;
  const emptyText = search ? "Ingen nyhet matchar sökningen" : shown === "draft" ? "Inga utkast" : "Inga nyheter ännu";

  if (native) return <NativePage testId="native-news">
    <NativeNewsTop />
    {canWrite ? <ListGroup><ListRow type="tools" icon={Plus} title={<span className="text-primary">Ny nyhet</span>} href={NEW_HREF} testId="news-new" /></ListGroup> : null}
    {filterBar}
    {error && !listing ? <ListGroup><ListEmpty><span className="text-destructive" role="alert">{error}</span></ListEmpty></ListGroup>
      : !listing ? <ListGroup><ListEmpty>Hämtar nyheterna…</ListEmpty></ListGroup>
      : !items.length ? <ListGroup testId="news-empty"><ListEmpty>{emptyText}.</ListEmpty></ListGroup>
      : <ListGroup testId="native-news-list">{items.map((item) => <ListRow key={item.id} type="tools" icon={item.pinned ? Pin : Newspaper} title={item.title} twoLines
        subtitle={`${item.author} · ${formatSwedish(dateOf(item), DAY)}`} href={newsHref(item.id)} testId={`news-row-${item.id}`} pill={item.status === "draft" ? { label: "Utkast", tone: "neutral" } : item.pinned ? { label: "Fäst", tone: "info" } : null} />)}</ListGroup>}
    {listing?.next ? <ListGroup><ListRow title={<span className="text-primary">{more ? "Hämtar…" : "Visa fler nyheter"}</span>} chevron={false} onClick={() => void loadMore()} testId="news-more" /></ListGroup> : null}
  </NativePage>;

  const newButton = canWrite ? <Button asChild><Link href={NEW_HREF} data-testid="news-new"><Plus aria-hidden="true" />Ny nyhet</Link></Button> : null;
  return <div className="space-y-5" data-testid="news-page" data-view={prefs.view}>
    <PageHeader title="Nyheter" description="Det som händer i företaget. En ny nyhet syns också i klockan och på tavlorna." actions={newButton} />
    {error ? <p className="notice text-destructive" role="alert">{error}</p> : null}
    {filterBar}
    {!listing ? <DelayedSkeleton testId="news-loading"><div className="rounded-xl border bg-card px-3.5 py-3"><RowsSkeleton rows={5} label="Hämtar nyheterna…" /></div></DelayedSkeleton>
      : !items.length ? (search
        ? <div className="notice" data-testid="news-empty">Inget matchar urvalet. Ändra filter eller sökning.</div>
        : <div className="rounded-xl border bg-card" data-testid="news-empty"><Empty title={emptyText}
          description={shown === "draft" ? "Ett utkast sparas när du trycker Spara utkast. Ingen annan ser det förrän det är publicerat." : canWrite ? "En nyhet når alla i företaget, i listan, i klockan och på tavlorna." : "Här visas företagets nyheter när de har publicerats."}>
          {canWrite ? <Button asChild><Link href={NEW_HREF}><Plus aria-hidden="true" />Ny nyhet</Link></Button> : null}
        </Empty></div>)
      : prefs.view === "cards" ? <ListCardGrid testId="news-cards">{items.map((item) => <ListCard key={item.id} testId={`news-row-${item.id}`} href={newsHref(item.id)}
          icon={<AreaIcon area="tools" icon={item.pinned ? Pin : Newspaper} />} title={item.title} subtitle={item.excerpt || undefined}
          badges={<><NewsPill post={item} />{item.pinned ? <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", indicatorBadge("info"))}>Fäst överst</span> : null}</>}
          facts={[{ icon: UserRound, label: "Skriven av", value: item.author }, { icon: CalendarClock, label: item.status === "draft" ? "Ändrad" : "Publicerad", value: formatSwedish(dateOf(item), DAY) }]} />)}</ListCardGrid>
      : <div role="table" aria-label="Nyheter" className="overflow-hidden rounded-xl border bg-card shadow-xs" data-testid="news-table">
        <div role="row" className="hidden gap-x-3 bg-[var(--panel-header)] px-3.5 py-2.5 text-xs font-semibold text-muted-foreground md:grid md:grid-cols-[minmax(0,1fr)_7rem_17rem_2.5rem]">
          <span role="columnheader">Nyhet</span><span role="columnheader">Status</span><span role="columnheader">Skriven</span><span role="columnheader"><span className="sr-only">Öppna</span></span>
        </div>
        <div role="rowgroup" className="divide-y">{items.map((item) => <div key={item.id} role="row" className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3.5 py-3 text-sm transition-colors hover:bg-secondary/50 md:grid-cols-[minmax(0,1fr)_7rem_17rem_2.5rem]" data-testid={`news-row-${item.id}`}>
          <span role="cell" className="flex min-w-0 items-center gap-3">
            <AreaIcon area="tools" icon={item.pinned ? Pin : Newspaper} />
            <span className="min-w-0"><Link href={newsHref(item.id)} className="stretched-link block truncate font-semibold hover:text-primary">{item.title}</Link>
              <span className="block truncate text-xs text-muted-foreground">{item.excerpt || (item.pinned ? "Fäst överst" : "")}</span>
              <span className="block truncate text-xs text-muted-foreground md:hidden">{metaLine(item)}</span></span>
          </span>
          <span role="cell" className="flex justify-end md:justify-start"><NewsPill post={item} /></span>
          <span role="cell" className="truncate text-xs text-muted-foreground max-md:hidden">{metaLine(item)}</span>
          <span role="cell" className="hidden justify-end md:flex"><RowChevron /></span>
        </div>)}</div>
      </div>}
    {listing?.next ? <div className="flex justify-center"><Button type="button" variant="outline" size="sm" disabled={more} onClick={() => void loadMore()} data-testid="news-more">{more ? "Hämtar…" : "Visa fler nyheter"}</Button></div> : null}
  </div>;
}

/** Level 1 on a phone: the top bar's title and Mer as the way back. */
function NativeNewsTop() {
  useNativeTopBar({ title: "Nyheter", back: { label: "Mer" } });
  return <NativeLargeTitle inBar>Nyheter</NativeLargeTitle>;
}

/** One post as its own page: read it; the admin has Ta bort, Fäst överst and Redigera top right. */
function NewsPost({ id }: { id: string }) {
  const router = useRouter();
  const native = useNativeMode();
  const [post, setPost] = useState<NewsPostView | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, confirmElement] = useConfirm();
  const load = useCallback(async () => {
    try { const answer = await api<{ post: NewsPostView; canWrite: boolean }>(`/api/news?id=${encodeURIComponent(id)}`, { cache: "no-store" }); setPost(answer.post); setCanWrite(answer.canWrite); setError(""); }
    catch (cause) { setError((cause as Error).message); }
  }, [id]);
  useLoadEffect(load);
  usePageTrail({ heading: post?.title });
  useNativeTopBar(native ? { title: post?.title || "Nyhet", back: { label: "Nyheter" } } : null);

  const act = async (input: Record<string, unknown>) => {
    setBusy(true); setError("");
    try { return await api<{ post?: NewsPostView; removed?: string }>("/api/news", { method: "POST", body: JSON.stringify(input) }); }
    catch (cause) { setError((cause as Error).message); return null; }
    finally { setBusy(false); }
  };
  const pin = async () => { if (!post) return; const answer = await act({ action: "pin", id: post.id, pinned: !post.pinned }); if (answer?.post) setPost(answer.post); };
  const remove = async () => {
    if (!post || !(await confirm({ title: "Ta bort nyheten?", message: "Nyheten tas bort för alla i företaget. Det går inte att ångra.", confirmLabel: "Ta bort", tone: "danger" }))) return;
    if ((await act({ action: "delete", id: post.id }))?.removed) router.push(NEWS_VIEW);
  };

  const back = <PageBackButton href={NEWS_VIEW} testId="news-back" />;
  if (error && !post) return native ? <NativePage testId="native-news-post"><ListGroup><ListEmpty><span className="text-destructive" role="alert" data-testid="news-error">{error}</span></ListEmpty></ListGroup></NativePage>
    : <div className="space-y-4"><PageHeader title="Nyhet" actions={back} /><p className="notice text-destructive" role="alert" data-testid="news-error">{error}</p></div>;
  if (!post) return native ? <NativePage><ListGroup><ListEmpty>Hämtar nyheten…</ListEmpty></ListGroup></NativePage> : <PageSkeleton label="Hämtar nyheten…" panels={1} />;

  const when = post.status === "published" ? `Publicerad ${formatSwedish(dateOf(post), WHEN)}` : `Utkast, ändrat ${formatSwedish(post.updatedAt, WHEN)}`;
  const meta = <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-testid="news-meta">
    <span data-testid="news-author">{post.author}</span>
    <span aria-hidden="true">·</span>
    <time dateTime={dateOf(post)}>{when}</time>
    {post.pinned ? <span className={cn("rounded-full px-2.5 py-0.5 font-medium", indicatorBadge("info"))}>Fäst överst</span> : null}
  </p>;
  const text = post.body ? <p className="whitespace-pre-line text-sm leading-6 [overflow-wrap:anywhere]" data-testid="news-body">{post.body}</p>
    : <p className="text-sm text-muted-foreground">Nyheten har ingen text.</p>;
  const pinLabel = post.pinned ? <><PinOff aria-hidden="true" />Lossa</> : <><Pin aria-hidden="true" />Fäst överst</>;

  if (native) return <NativePage testId="native-news-post">
    {confirmElement}
    <article className="pt-3" data-testid="news-post">
      {error ? <p className="notice text-destructive" role="alert">{error}</p> : null}
      <Panel icon={Newspaper} title={post.title}><div className="space-y-3">{meta}{text}</div></Panel>
    </article>
    {canWrite ? <NativeActions testId="news-actions">
      <Button asChild variant="ghost"><Link href={editHref(post.id)} data-testid="news-edit"><Pencil aria-hidden="true" />Redigera</Link></Button>
      <Button type="button" variant="ghost" disabled={busy} onClick={() => void pin()} data-testid="news-pin">{pinLabel}</Button>
      <Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={() => void remove()} data-testid="news-delete"><Trash2 aria-hidden="true" />Ta bort</Button>
    </NativeActions> : null}
  </NativePage>;

  return <article className="space-y-4" data-testid="news-post">
    {confirmElement}
    <PageHeader title={post.title} actions={<>
      {canWrite ? <Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={() => void remove()} data-testid="news-delete"><Trash2 aria-hidden="true" />Ta bort</Button> : null}
      {back}
      {canWrite ? <Button type="button" variant="outline" disabled={busy} onClick={() => void pin()} data-testid="news-pin">{pinLabel}</Button> : null}
      {canWrite ? <Button asChild><Link href={editHref(post.id)} data-testid="news-edit"><Pencil aria-hidden="true" />Redigera</Link></Button> : null}
    </>}>{meta}</PageHeader>
    {error ? <p className="notice text-destructive" role="alert">{error}</p> : null}
    <Panel icon={Newspaper} title="Nyheten">{text}</Panel>
  </article>;
}

/** Ny nyhet: a form page for the admin; anyone else meets the shared box for no permission. */
function NewsCreatePage({ behind }: { behind: ReactNode }) {
  const [canWrite, setCanWrite] = useState<boolean | null>(null);
  const load = useCallback(async () => {
    try { setCanWrite((await api<Listing>("/api/news?filter=published", { cache: "no-store" })).canWrite); } catch { setCanWrite(false); }
  }, []);
  useLoadEffect(load);
  if (canWrite === false) return <NoPermission page />;
  return <NewsFormPage post={null} ready={canWrite === true} behind={behind} />;
}

/** Redigera: the post is read first, then the same form page. */
function NewsEditPage({ id, behind }: { id: string; behind: ReactNode }) {
  const [answer, setAnswer] = useState<{ post: NewsPostView; canWrite: boolean } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setAnswer(await api<{ post: NewsPostView; canWrite: boolean }>(`/api/news?id=${encodeURIComponent(id)}`, { cache: "no-store" })); setError(""); }
    catch (cause) { setError((cause as Error).message); }
  }, [id]);
  useLoadEffect(load);
  usePageTrail({ heading: answer?.post.title });
  if (error) return <div className="space-y-4"><PageHeader title="Nyhet" actions={<PageBackButton href={NEWS_VIEW} testId="news-back" />} /><p className="notice text-destructive" role="alert" data-testid="news-error">{error}</p></div>;
  if (answer && !answer.canWrite) return <NoPermission page />;
  return <NewsFormPage key={answer?.post.id ?? "loading"} post={answer?.post ?? null} editing ready={Boolean(answer)} behind={behind} />;
}

type Draft = { title: string; body: string; pinned: boolean };

/**
 * The form page of Ny nyhet and Redigera (FormPage): Rubrik, Text and Fäst överst in one card; Avbryt, Spara utkast and Publicera
 * top right – or Avbryt and Spara for a published post. After saving, the post's own page in the form's place.
 */
function NewsFormPage({ post, editing = false, ready, behind }: { post: NewsPostView | null; editing?: boolean; ready: boolean; behind: ReactNode }) {
  const back = post ? newsHref(post.id) : NEWS_VIEW;
  const published = post?.status === "published";
  return <FormPage title={editing ? "Redigera nyheten" : "Ny nyhet"} back={back} behind={behind}
    description={published ? "Ändringen syns direkt. Ingen ny notis skickas." : "Spara som utkast och publicera när du är klar. Alla i företaget får en notis när nyheten publiceras."}>
    {(form) => ready ? <NewsForm post={post} onCancel={form.cancel} onSaved={(saved) => form.done(newsHref(saved.id))} />
      : <p className="text-sm text-muted-foreground" role="status">Hämtar…</p>}
  </FormPage>;
}

function NewsForm({ post, onSaved, onCancel }: { post: NewsPostView | null; onSaved: (post: NewsPostView) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>({ title: post?.title ?? "", body: post?.body ?? "", pinned: post?.pinned ?? false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, confirmElement] = useConfirm();
  const published = post?.status === "published";
  const titleError = draft.title.trim().length > NEWS_TITLE_MAX ? `Rubriken får vara högst ${NEWS_TITLE_MAX} tecken.` : undefined;
  const bodyError = draft.body.length > NEWS_BODY_MAX ? `Texten får vara högst ${NEWS_BODY_MAX} tecken.` : undefined;
  const problem = newsPublishProblem(draft) ?? titleError ?? bodyError ?? null;
  const save = async (status: "draft" | "published") => {
    if (problem) return;
    if (status === "published" && !published && !(await confirm({ title: "Publicera nyheten?", message: "Alla i företaget kan läsa den, och de får en notis i klockan.", confirmLabel: "Publicera" }))) return;
    setBusy(true); setError("");
    try {
      const body = post ? { action: "save", id: post.id, post: { ...draft, status } } : { action: "create", post: { ...draft, status } };
      onSaved((await api<{ post: NewsPostView }>("/api/news", { method: "POST", body: JSON.stringify(body) })).post);
    } catch (cause) { setError((cause as Error).message); setBusy(false); }
  };
  const reason = busy ? null : problem;
  return <form className="space-y-4" noValidate onSubmit={(event) => { event.preventDefault(); void save("published"); }} data-testid="news-editor">
    {confirmElement}
    {error ? <p className="notice text-destructive" role="alert" data-testid="news-editor-error">{error}</p> : null}
    <FormPanel icon={Newspaper} title="Nyheten">
      <Field id="news-title" label="Rubrik" hint={`${draft.title.length}/${NEWS_TITLE_MAX}`} value={draft.title} error={titleError}
        onChange={(title) => setDraft((current) => ({ ...current, title: title.slice(0, NEWS_TITLE_MAX + 20) }))} />
      <Field id="news-text" label="Text" multiline rows={10} hint={`${draft.body.length}/${NEWS_BODY_MAX}`} value={draft.body} error={bodyError}
        onChange={(body) => setDraft((current) => ({ ...current, body: body.slice(0, NEWS_BODY_MAX + 200) }))} />
      <CheckField id="news-pinned" label="Fäst överst" description="Nyheten står först i listan tills du lossar den." checked={draft.pinned} testId="news-pinned"
        onChange={(pinned) => setDraft((current) => ({ ...current, pinned }))} />
    </FormPanel>
    <DialogActions cancel={{ onClick: onCancel }}
      primary={published ? { label: "Spara", icon: <Save aria-hidden="true" />, type: "submit", busy, busyLabel: "Sparar…", disabledReason: reason, testId: "news-save" }
        : { label: "Publicera", icon: <Send aria-hidden="true" />, type: "submit", busy, busyLabel: "Publicerar…", disabledReason: reason, testId: "news-publish" }}>
      {published ? null : <Button type="button" variant="outline" disabled={busy} disabledReason={reason} onClick={() => void save("draft")} data-testid="news-save-draft"><Save aria-hidden="true" />Spara utkast</Button>}
    </DialogActions>
  </form>;
}
