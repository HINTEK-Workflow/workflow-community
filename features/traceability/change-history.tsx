"use client";

import { useCallback, useEffect, useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/features/kfid/api";
import { Panel, ShowMore, useOpenWhenReady } from "@/features/kfid/ui";
import { formatSwedish } from "@/lib/swedish-time";
import { CHANGE_ENTITY_WORD, type ChangeEntityType, type ChangeEntryView } from "@/lib/traceability/record-changes";

/**
 * Ändringshistorik (K3.2, 2026-11-27): who changed what on the record, when, and from what to what – newest first,
 * 20 at a time with Visa fler. Read only when it is opened (the card folds with the arrow, as Händelser and Statistik), so a
 * record's page loads as before. The server decides who may read it (app/api/record-changes) and names people and places.
 *
 *  - `ChangeHistoryPanel`: its own card on a record's page (a work order, a protocol, a deviation).
 *  - `ChangeHistorySection` (`bare`): inside a card that is already the record's (a machine's Historik tab, a plan's row),
 *    with a small heading and a Visa ändringshistorik button instead of a card of its own.
 */
type Page = { entries: ChangeEntryView[]; total: number; next: string | null };

function useChangeHistory(type: ChangeEntityType, id: string, asked: boolean) {
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const url = useCallback((after?: string | null) => `/api/record-changes?type=${type}&id=${encodeURIComponent(id)}${after ? `&after=${encodeURIComponent(after)}` : ""}`, [type, id]);
  useEffect(() => {
    if (!asked) return;
    let active = true;
    api<Page>(url(), { cache: "no-store" })
      .then((result) => { if (active) { setPage(result); setError(""); } })
      .catch((cause) => { if (active) setError((cause as Error).message); });
    return () => { active = false; };
  }, [asked, url]);
  const more = async () => {
    if (!page?.next) return;
    setBusy(true);
    try {
      const result = await api<Page>(url(page.next), { cache: "no-store" });
      setPage((current) => current ? { entries: [...current.entries, ...result.entries.filter((entry) => !current.entries.some((seen) => seen.id === entry.id))], total: result.total, next: result.next } : result);
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  };
  return { page, error, busy, more };
}

function Value({ text }: { text: string | null }) {
  return text === null ? <span className="text-muted-foreground">–</span> : <span className="[overflow-wrap:anywhere]">{text}</span>;
}

function Entries({ type, page, error, busy, onMore }: { type: ChangeEntityType; page: Page | null; error: string; busy: boolean; onMore: () => void }) {
  if (error) return <p role="alert" className="notice text-destructive">{error}</p>;
  if (!page) return <p className="text-sm text-muted-foreground" role="status">Hämtar ändringshistoriken…</p>;
  if (!page.entries.length) return <p className="text-sm text-muted-foreground" data-testid="change-history-empty">Inga ändringar sparade än. Ändringar av {CHANGE_ENTITY_WORD[type]} hamnar här.</p>;
  return <div className="space-y-2">
    <ol className="divide-y rounded-lg border text-sm" data-testid="change-history">{page.entries.map((entry) => <li key={entry.id} className="space-y-1.5 px-3 py-2.5" data-testid="change-history-entry" data-action={entry.action}>
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span><span className="font-medium">{entry.actor}</span> <span className="text-muted-foreground">{entry.changes.length ? "ändrade" : entry.actionLabel.toLowerCase()}</span></span>
        <time className="text-xs tabular-nums text-muted-foreground" dateTime={entry.at}>{formatSwedish(entry.at, { dateStyle: "medium", timeStyle: "short" })}</time>
      </p>
      {entry.changes.length ? <dl className="grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[10rem_minmax(0,1fr)]">{entry.changes.map((change) => <div key={change.field} className="contents">
        <dt className="font-medium text-muted-foreground">{change.label}</dt>
        <dd className="flex flex-wrap items-center gap-x-1.5" data-testid="change-history-line">{change.hidden ? <span className="text-muted-foreground">Ändrades</span> : <>
          <Value text={change.from} /><span className="text-muted-foreground" aria-label="till">→</span><Value text={change.to} />
        </>}</dd>
      </div>)}</dl> : null}
    </li>)}</ol>
    <ShowMore shown={page.entries.length} total={page.total} busy={busy} onMore={onMore} testId="change-history-more" />
  </div>;
}

const DESCRIPTION = "Vem som ändrade vad och när, och från vad till vad.";

/** Its own card on a record's page, folded until it is opened. */
export function ChangeHistoryPanel({ type, id }: { type: ChangeEntityType; id: string }) {
  const [ready, setReady] = useState(false);
  const fold = useOpenWhenReady(ready, "change-history");
  const history = useChangeHistory(type, id, fold.asked);
  if (!ready && (history.page || history.error)) setReady(true);
  return <Panel icon={History} title="Ändringshistorik" description={DESCRIPTION} collapsible collapsed={fold.collapsed} onCollapsedChange={fold.onCollapsedChange} opening={fold.opening}
    count={history.page?.total || undefined}>
    <div data-testid="change-history-panel"><Entries type={type} page={history.page} error={history.error} busy={history.busy} onMore={() => void history.more()} /></div>
  </Panel>;
}

/** Inside a card that is the record's own: a small heading and a button that reads the history. */
export function ChangeHistorySection({ type, id, compact = false }: { type: ChangeEntityType; id: string; /** A row in a list (a plan): only the button until it is pressed. */ compact?: boolean }) {
  const [asked, setAsked] = useState(false);
  const history = useChangeHistory(type, id, asked);
  if (!asked) return <div className={compact ? "" : "space-y-1"} data-testid="change-history-section">
    {compact ? null : <p className="text-sm font-semibold">Ändringshistorik</p>}
    <Button type="button" size="sm" variant="ghost" onClick={() => setAsked(true)} data-testid="change-history-open"><History />Visa ändringshistorik</Button>
  </div>;
  return <section className="space-y-2" aria-label="Ändringshistorik" data-testid="change-history-section">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-semibold">Ändringshistorik</p>
      <Button type="button" size="sm" variant="ghost" onClick={() => setAsked(false)}>Dölj</Button>
    </div>
    <p className="text-xs text-muted-foreground">{DESCRIPTION}</p>
    <Entries type={type} page={history.page} error={history.error} busy={history.busy} onMore={() => void history.more()} />
  </section>;
}
