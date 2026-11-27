"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Pencil, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { Badge } from "@/components/ui/badge";
import { ListEmpty, ListGroup, ListRow } from "@/components/native";
import { api } from "@/features/kfid/api";
import { useConfirm } from "@/features/kfid/confirm";
import { DialogActions, Empty, Field, Modal, Panel, RowsSkeleton, ShowMore } from "@/features/kfid/ui";
import { indicatorBadge } from "@/features/workflow/indicator-tone";
import { announce } from "@/lib/workflow/toast";
import { formatSwedish } from "@/lib/swedish-time";
import { useLoadEffect } from "@/lib/use-load-effect";
import {
  DOCUMENT_PREVIEW, DOCUMENT_SCAN_PILL, DOCUMENT_SCAN_TONE, documentKindLabel, documentSizeLabel, type DocumentView,
} from "@/lib/documents/model";

/**
 * Dokument (0.87.0): the customer's and a place's documents, one component for every place they are shown – the customer's page
 * (`variant="panel"`, a card like Projekt and Uppgifter), the open place beside the tree (`"inline"`, a section of its card) and
 * level 1 on a phone (`"native"`, the app's rows). Ladda upp top right of the card, and per row Ladda ner, Byt namn and Ta bort
 * (to the papperskorg, with Ångra). A file is downloaded only once the virus scan says it is clean; until then its row says so.
 * The server decides every call (lib/documents/server.ts); without the right to edit the buttons are simply not drawn.
 */
export type DocumentListing = { items: DocumentView[]; total: number; page: number; pages: number; counts: { all: number; pending: number; trash: number }; canEdit: boolean; canPurge?: boolean; scan: "clamav" | "off" };

export const DOCUMENT_ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,.txt,.docx,.xlsx";
const DAY = { dateStyle: "medium" } as const;
/** How often a list with a waiting file is read again, and how many times. */
const POLL_MS = 4000;
const POLL_TIMES = 15;

export function documentMeta(item: DocumentView, options: { place?: boolean; customer?: boolean } = {}) {
  return [documentKindLabel(item.name), documentSizeLabel(item.size), options.customer ? item.customerName : "", options.place && item.placeName ? item.placeName : "", item.uploadedBy, formatSwedish(item.createdAt, DAY)].filter(Boolean).join(" · ");
}

/** The scan's pill, shown only when the file is not simply clean. */
export function DocumentScanPill({ item }: { item: DocumentView }) {
  if (item.scanStatus === "clean") return null;
  return <Badge variant="outline" className={indicatorBadge(DOCUMENT_SCAN_TONE[item.scanStatus])} title={item.scanLabel} data-testid="document-scan">{DOCUMENT_SCAN_PILL[item.scanStatus]}</Badge>;
}

/** Ladda ner: the browser fetches the file itself (an attachment, never shown in the page). */
export function downloadDocument(item: DocumentView) {
  if (!item.href) {
    announce(item.scanStatus === "infected" ? "Filen innehöll skadlig kod och har tagits bort." : item.scanStatus === "pending" ? "Filen väntar på virussökning och kan laddas ner när den är klar." : "Filen kan inte laddas ner här.", true);
    return;
  }
  const link = document.createElement("a");
  link.href = item.href;
  link.download = item.name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Uploads the chosen files one at a time and says how it went. */
export async function uploadDocuments(files: readonly File[], target: { customerId: string; placeId?: string | null }) {
  let waiting = 0, done = 0;
  for (const file of files) {
    const form = new FormData();
    form.set("customerId", target.customerId);
    if (target.placeId) form.set("placeId", target.placeId);
    form.set("file", file);
    const saved = await api<DocumentView>("/api/documents", { method: "POST", body: form });
    done += 1;
    if (saved.scanStatus === "pending") waiting += 1;
    if (saved.scanStatus === "infected") announce(`${file.name} innehöll skadlig kod och togs bort.`, true);
  }
  if (done) announce(waiting ? `${done === 1 ? "Filen är uppladdad" : `${done} filer är uppladdade`} och virussöks. Den kan laddas ner när sökningen är klar.` : done === 1 ? "Filen är uppladdad." : `${done} filer är uppladdade.`);
}

/** The list of one customer (all its documents, with the place on each row) or one place. */
function useDocumentList(customerId: string, placeId: string | null) {
  const [listing, setListing] = useState<DocumentListing | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const address = useCallback((upTo: number) => `/api/documents?${new URLSearchParams({ customerId, ...(placeId ? { placeId } : {}), limit: String(Math.min(100, upTo * 25)) })}`, [customerId, placeId]);
  const load = useCallback(async (upTo = page) => {
    try { setListing(await api<DocumentListing>(address(upTo), { cache: "no-store" })); setError(""); }
    catch (cause) { setError((cause as Error).message); }
  }, [address, page]);
  useLoadEffect(load);
  // A waiting file is read again a few times, so its row turns clean (or is removed) without a reload.
  const polls = useRef(0);
  const waiting = Boolean(listing?.items.some((item) => item.scanStatus === "pending")) && listing?.scan === "clamav";
  useEffect(() => {
    if (!waiting || polls.current >= POLL_TIMES) return;
    const timer = window.setTimeout(() => { polls.current += 1; void load(); }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [waiting, listing, load]);
  const more = () => { const next = page + 1; setPage(next); void load(next); };
  return { listing, error, load: () => { polls.current = 0; return load(); }, more };
}

export function DocumentsSection({ customerId, placeId = null, variant, readOnly = false, title = "Dokument", description }: {
  customerId: string;
  /** One place's documents; without it the customer's, with the place on each row. */
  placeId?: string | null;
  variant: "panel" | "inline" | "native";
  /** The customer is in the papperskorg: the documents are read, nothing is added or changed. */
  readOnly?: boolean;
  title?: string;
  description?: string;
}) {
  const { listing, error, load, more } = useDocumentList(customerId, placeId);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<DocumentView | null>(null);
  const [confirm, confirmElement] = useConfirm();
  const chooser = useRef<HTMLInputElement | null>(null);
  const canEdit = Boolean(listing?.canEdit) && !readOnly;
  const items = listing?.items ?? [];
  const [all, setAll] = useState(false);
  const shown = variant === "panel" && !all ? items.slice(0, DOCUMENT_PREVIEW) : items;

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try { await uploadDocuments([...files], { customerId, placeId }); }
    catch (cause) { announce((cause as Error).message, true); }
    finally { setBusy(false); await load(); }
  };
  const remove = async (item: DocumentView) => {
    if (!(await confirm({ title: "Flytta dokumentet till papperskorgen?", message: `${item.name} kan återställas från papperskorgen under Mer › Dokument.`, confirmLabel: "Flytta till papperskorgen", tone: "danger" }))) return;
    setBusy(true);
    try {
      await api(`/api/documents/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      announce("Dokumentet ligger i papperskorgen.", false, [{ label: "Ångra", run: () => void restore(item) }]);
    } catch (cause) { announce((cause as Error).message, true); }
    finally { setBusy(false); await load(); }
  };
  const restore = async (item: DocumentView) => {
    try { await api(`/api/documents/${encodeURIComponent(item.id)}`, { method: "PATCH", body: JSON.stringify({ action: "restore" }) }); announce("Dokumentet är återställt."); }
    catch (cause) { announce((cause as Error).message, true); }
    finally { await load(); }
  };

  const picker = <input ref={chooser} type="file" multiple accept={DOCUMENT_ACCEPT} className="sr-only" tabIndex={-1} aria-label="Välj filer att ladda upp" data-testid="document-file-input"
    onChange={(event) => { const files = event.target.files; void upload(files).then(() => { if (chooser.current) chooser.current.value = ""; }); }} />;
  const uploadButton = canEdit ? <Button type="button" variant="outline" size={variant === "inline" ? "sm" : "default"} disabled={busy} onClick={() => chooser.current?.click()} data-testid="document-upload"><Upload aria-hidden="true" />{busy ? "Laddar upp…" : "Ladda upp"}</Button> : null;
  const scanOff = listing?.scan === "off" ? <p className="text-xs text-muted-foreground" data-testid="document-scan-off">Virussökning är inte påslagen på den här installationen. Filerna märks Inte virussökt.</p> : null;
  const rename = renaming ? <RenameDialog item={renaming} onClose={() => setRenaming(null)} onSaved={() => { setRenaming(null); void load(); }} /> : null;
  const actions = (item: DocumentView) => <>
    <IconButton label={`Ladda ner ${item.name}`} title="Ladda ner" disabled={!item.downloadable} onClick={() => downloadDocument(item)} data-testid="document-download"><Download aria-hidden="true" /></IconButton>
    {canEdit ? <IconButton label={`Byt namn på ${item.name}`} title="Byt namn" disabled={busy} onClick={() => setRenaming(item)} data-testid="document-rename"><Pencil aria-hidden="true" /></IconButton> : null}
    {canEdit ? <RemoveButton label={`Ta bort ${item.name}`} disabled={busy} onClick={() => void remove(item)} data-testid="document-remove" /> : null}
  </>;

  if (variant === "native") return <div data-testid="documents-section">
    {confirmElement}{picker}{rename}
    {canEdit ? <ListGroup><ListRow type="new" icon={Upload} title={busy ? "Laddar upp…" : "Ladda upp"} chevron={false} onClick={() => { if (!busy) chooser.current?.click(); }} testId="document-upload" /></ListGroup> : null}
    <ListGroup testId="documents-list" footer={listing?.scan === "off" ? "Virussökning är inte påslagen. Filerna märks Inte virussökt." : "En fil kan laddas ner när virussökningen är klar."}>
      {error && !listing ? <ListEmpty><span className="text-destructive" role="alert">{error}</span></ListEmpty>
        : !listing ? <ListEmpty>Hämtar dokumenten…</ListEmpty>
        : items.length ? items.map((item) => <ListRow key={item.id} type="customer" icon={FileText} title={item.name} twoLines subtitle={documentMeta(item, { place: !placeId })} testId={`document-row-${item.id}`}
          pill={item.scanStatus === "clean" ? null : { label: DOCUMENT_SCAN_PILL[item.scanStatus], tone: DOCUMENT_SCAN_TONE[item.scanStatus] }}
          onClick={() => downloadDocument(item)} chevron={false} accessory={canEdit ? <>
            <IconButton label={`Byt namn på ${item.name}`} title="Byt namn" onClick={() => setRenaming(item)} data-testid="document-rename"><Pencil aria-hidden="true" /></IconButton>
            <RemoveButton label={`Ta bort ${item.name}`} onClick={() => void remove(item)} data-testid="document-remove" />
          </> : undefined} />)
        : <ListEmpty>Inga dokument ännu.</ListEmpty>}
      {listing && items.length < listing.total ? <ListRow title={<span className="text-primary">Visa fler</span>} chevron={false} onClick={more} testId="documents-more" /> : null}
    </ListGroup>
  </div>;

  const list = error && !listing ? <p role="alert" className="text-sm text-destructive">{error}</p>
    : !listing ? <RowsSkeleton rows={2} dense label="Hämtar dokumenten…" />
    : items.length ? <ul className="divide-y" data-testid="documents-list">{shown.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0" data-testid={`document-row-${item.id}`}>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            {item.downloadable ? <button type="button" className="block max-w-full truncate text-left text-sm font-medium hover:text-primary hover:underline" onClick={() => downloadDocument(item)} data-testid="document-name">{item.name}</button>
              : <span className="block truncate text-sm font-medium" data-testid="document-name">{item.name}</span>}
            <span className="block truncate text-xs text-muted-foreground">{documentMeta(item, { place: !placeId })}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1"><DocumentScanPill item={item} />{actions(item)}</span>
      </li>)}</ul>
    : variant === "inline" ? <p className="mt-1 text-sm text-muted-foreground">Inga dokument här ännu.</p>
    : <Empty compact title="Inga dokument" description={canEdit ? "Ladda upp ritningar, intyg, avtal och andra filer som hör till kunden." : "Kunden har inga dokument ännu."} />;
  const footer = <>
    {variant === "panel" && items.length > DOCUMENT_PREVIEW ? <div className="mt-3 flex justify-center"><Button type="button" size="sm" variant="outline" aria-expanded={all} onClick={() => setAll(!all)} data-testid="documents-all">{all ? "Visa färre" : `Visa alla (${listing?.total ?? items.length})`}</Button></div> : null}
    {listing && (variant !== "panel" || all) ? <ShowMore shown={items.length} total={listing.total} onMore={more} testId="documents-more" /> : null}
  </>;

  if (variant === "inline") return <section aria-label={title} data-testid="documents-section" className="space-y-1.5">
    {confirmElement}{picker}{rename}
    <div className="flex items-center justify-between gap-2"><h4 className="text-xs font-semibold text-muted-foreground">{title}{listing?.total ? ` (${listing.total})` : ""}</h4>{uploadButton}</div>
    {list}{footer}{items.length ? scanOff : null}
  </section>;
  return <div data-testid="documents-section">
    {confirmElement}{picker}{rename}
    <Panel icon={FileText} title={title} description={description ?? "Ritningar, intyg, avtal och andra filer. En fil kan laddas ner när virussökningen är klar."} actions={uploadButton} count={listing?.total}>
      <div className="space-y-2">{list}{footer}{scanOff}</div>
    </Panel>
  </div>;
}

/** Byt namn: a small dialog with the name; the extension stays (the server keeps it too). */
export function RenameDialog({ item, onClose, onSaved }: { item: DocumentView; onClose: () => void; onSaved: (document: DocumentView) => void }) {
  const [name, setName] = useState(item.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!name.trim()) { setError("Skriv ett namn på dokumentet."); return; }
    setBusy(true);
    try {
      const answer = await api<{ document: DocumentView }>(`/api/documents/${encodeURIComponent(item.id)}`, { method: "PATCH", body: JSON.stringify({ action: "rename", name }) });
      announce("Namnet är ändrat.");
      onSaved(answer.document);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title="Byt namn" size="compact" nativeScreen>
    <form noValidate className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="document-rename-dialog">
      <Field label="Namn" value={name} onChange={(value) => { setName(String(value)); setError(""); }} id="document-name" error={error} help="Filens ändelse behålls, så att den öppnas med rätt program." />
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara", type: "submit", busy, busyLabel: "Sparar…", testId: "document-rename-save" }} />
    </form>
  </Modal>;
}

/** Återställ from the papperskorg (Mer › Dokument). */
export function RestoreButton({ onRestore, busy }: { onRestore: () => void; busy: boolean }) {
  return <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRestore} data-testid="document-restore"><RotateCcw aria-hidden="true" />Återställ</Button>;
}
