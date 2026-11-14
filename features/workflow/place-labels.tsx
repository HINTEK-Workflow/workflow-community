"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Printer, QrCode, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Panel } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { ListEmpty, ListGroup, ListSkeleton, NativeActions, NativePage, NativePickerRow, useNativeTopBar } from "@/components/native";
import { PLACE_KIND_LABELS, placeKindOf, placeName, placePath, placeTree } from "@/lib/workflow/customer-facility";
import type { ScheduleView } from "@/lib/workflow/form-schedule";
import { roundLabelsHref } from "@/lib/workflow/navigation";
import { PageHeader } from "@/components/page-shell";
import { useNativeMode } from "./use-detail-level";

const SIZES = { small: { label: "Små, tre per rad", columns: 3, qr: "28mm" }, large: { label: "Stora, två per rad", columns: 2, qr: "45mm" } } as const;
type Size = keyof typeof SIZES;
/** The round as the sheet reads it (`?labels=`): its place is the one of the work order that holds it now (2026-10-27 kväll). */
type Round = { id: string; title: string; customerId: string | null; facilityId: string | null; facilityName: string; customerName: string; workOrder?: { id: string; title: string } | null };
/** A point of the round as `/api/form-schedules?labels=` gives it: only what the label prints. */
type LabelPlace = { id: string; parentId: string | null; name: string; code: string; kind: string };

/**
 * Printing shows only the sheet (2026-10-23, also from the phone's app): a copy of the sheet lies directly in <body> and is
 * the only thing printed, so the app's frame (top bar, tab bar, scroll box) neither shows nor cuts the sheet; the phone's
 * print dialog also saves it as PDF or shares it. On a narrow screen the preview is one label per row; paper keeps the size's columns.
 */
const PRINT_CSS = `.label-sheet { grid-template-columns: repeat(var(--label-cols), minmax(0, 1fr)); }
@media screen and (max-width: 639px) { .label-sheet { grid-template-columns: minmax(0, 1fr); } }
@media print { html, body { height: auto !important; overflow: visible !important; background: #fff !important; } body > *:not(.label-print) { display: none !important; } .label-print { display: block !important; } @page { size: A4; margin: 10mm; } }`;

/**
 * QR-etiketter för en driftrond (2026-10-22, ersätter 2026-10-04): QR hör till driftronden – the labels are printed
 * from the round, for its place – the place of the work order that holds it now (2026-10-27 kväll) – and the objects under it, several on one sheet, and each label names the round. Each code is
 * made on this server and holds only the place's address (`/p/<id>`); scanned, it opens the round protocol made beforehand
 * at that place, a short choice when there are several, or the place with "Inget planerat jobb här" – a scan never creates a
 * job (lib/workflow/place-scan.ts). Not in Kundregister and not in Ny arbetsorder. Also in the phone's app (
 * 2026-10-23: "QR kod borde kunna skrivas ut även på telefon"). The round and its points are read together within the
 * round's visibility (`?labels=`), so a person who sees the round but not the customer register still gets the sheet.
 */
export function PlaceLabels({ roundId }: { roundId: string }) {
  const native = useNativeMode();
  const [round, setRound] = useState<Round | null>(null);
  const [places, setPlaces] = useState<LabelPlace[] | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [size, setSize] = useState<Size>("small");
  const [error, setError] = useState("");
  useNativeTopBar(native ? { title: "QR-etiketter", back: { label: "Driftronder" } } : null);
  useEffect(() => {
    void (async () => {
      try {
        const result = await api<{ round: Round; places: LabelPlace[] }>(`/api/form-schedules?labels=${encodeURIComponent(roundId)}`);
        setRound(result.round);
        setPlaces(result.places);
        // Without a choice every place of the round gets a label.
        setSelected((current) => current ?? new Set(result.places.map((place) => place.id)));
      } catch (issue) { setError((issue as Error).message); }
    })();
  }, [roundId]);
  const rows = useMemo(() => places ? placeTree(places) : [], [places]);
  const chosen = rows.filter(({ place }) => selected?.has(place.id)).map(({ place }) => place);
  const toggle = (id: string, on: boolean) => setSelected((current) => { const next = new Set(current ?? []); if (on) next.add(id); else next.delete(id); return next; });
  const format = SIZES[size];
  const customerName = round?.customerName ?? "";
  // Where the round is done comes with its work order (2026-10-27 kväll): without one, or one without a place, no labels.
  const noPlace = round && !round.workOrder ? "Ingen arbetsorder håller ronden nu. Skapa arbetsorder för ronden under Driftronder och välj platsen där."
    : "Arbetsordern som håller ronden har ingen plats ur kundregistret. Välj platsen i arbetsordern. Etiketterna sätts vid platsen och objekten under den.";
  const sheet = (print: boolean) => <div className={print ? "label-print hidden" : undefined} aria-hidden={print || undefined}>
    <div className="label-sheet grid gap-[4mm] bg-white text-black" data-testid={print ? undefined : "label-sheet"} style={{ "--label-cols": format.columns } as CSSProperties}>
      {chosen.map((place) => <div key={place.id} data-testid={print ? undefined : "place-label"} className="flex items-center gap-3 rounded border border-black/30 p-[3mm]" style={{ breakInside: "avoid" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- an SVG from our own server, printed as it is */}
        <img src={`/api/places/qr?id=${encodeURIComponent(place.id)}`} alt={print ? "" : `QR-kod för ${placeName(place)}`} style={{ width: format.qr, height: format.qr }} className="shrink-0" />
        <div className="min-w-0">
          <p className="text-[13pt] font-bold leading-tight [overflow-wrap:anywhere]">{placeName(place)}</p>
          <p className="mt-1 text-[7.5pt] leading-tight text-black/70">{[customerName, placePath(places ?? [], place.parentId ?? null)].filter(Boolean).join(" › ")}</p>
          {round ? <p className="mt-0.5 text-[7.5pt] leading-tight text-black/70" data-testid={print ? undefined : "place-label-round"}>Rond: {round.title}</p> : null}
        </div>
      </div>)}
    </div>
  </div>;
  const printing = <>
    <style>{PRINT_CSS}</style>
    {/* Only after the points are read (never in the first, server-drawn frame), so document.body is there. */}
    {chosen.length > 0 && typeof document !== "undefined" ? createPortal(sheet(true), document.body) : null}
  </>;
  const sizeChoice = (className?: string) => <select aria-label="Storlek" className={className} value={size} onChange={(event) => setSize(event.target.value as Size)}>{(Object.keys(SIZES) as Size[]).map((key) => <option key={key} value={key}>{SIZES[key].label}</option>)}</select>;
  const printButton = <Button type="button" onClick={() => window.print()} disabled={!chosen.length} data-testid="labels-print"><Printer />Skriv ut</Button>;

  // The phone's app: the round's points as rows to tick, the size, Skriv ut as the page's own button, and the sheet below.
  if (native) {
    if (error) return <NativePage testId="place-labels"><ListGroup><div role="alert"><ListEmpty>{error}</ListEmpty></div></ListGroup></NativePage>;
    if (!round || !places) return <NativePage testId="place-labels"><ListSkeleton rows={3} label="Hämtar ronden…" /></NativePage>;
    if (!places.length) return <NativePage testId="place-labels"><ListGroup title={round.title}><div data-testid="labels-no-place"><ListEmpty>{noPlace}</ListEmpty></div></ListGroup></NativePage>;
    return <NativePage testId="place-labels">
      {printing}
      <ListGroup title={round.title} footer={`${chosen.length} av ${places.length} valda. Skanningen öppnar rondens protokoll vid punkten.`} testId="labels-points">
        {rows.map(({ place, depth }) => <label key={place.id} role="listitem" className="native-row" data-plain style={{ paddingLeft: `${0.875 + depth * 1.1}rem` }}>
          <Checkbox checked={Boolean(selected?.has(place.id))} onCheckedChange={(value) => toggle(place.id, value === true)} aria-label={`Etikett för ${placeName(place)}`} />
          <span className="min-w-0 flex-1 truncate text-[0.9375rem] leading-5">{placeName(place)}</span>
          <span className="shrink-0 text-[0.8125rem] text-muted-foreground">{PLACE_KIND_LABELS[placeKindOf(place)]}</span>
        </label>)}
      </ListGroup>
      <ListGroup>
        <NativePickerRow label="Storlek" display={format.label}>{sizeChoice()}</NativePickerRow>
      </ListGroup>
      <NativeActions footer="Skrivardialogen kan också spara etiketterna som PDF eller dela dem.">{printButton}</NativeActions>
      <div className="mt-4 overflow-hidden rounded-[.875rem] bg-white p-3">{sheet(false)}</div>
    </NativePage>;
  }

  if (error) return <Panel title="Etiketterna kunde inte hämtas"><p role="alert" className="text-sm text-destructive">{error}</p></Panel>;
  if (round && places && !places.length) return <>
    <PageHeader title="QR-etiketter" description={round.title} />
    <Panel title={round.workOrder ? "Ronden har ingen plats" : "Ingen arbetsorder"}><p className="text-sm text-muted-foreground" data-testid="labels-no-place">{noPlace}</p></Panel>
  </>;
  return <div className="space-y-6" data-testid="place-labels">
    {printing}
    <PageHeader title="QR-etiketter" description={round ? `${round.title}. Välj punkter och skriv ut. Skanningen öppnar rondens protokoll vid punkten.` : "Hämtar ronden…"} />
    <Panel icon={QrCode} title="Punkter" description={places ? `${chosen.length} av ${places.length} valda.` : "Hämtar platser…"}
      actions={<div className="flex flex-wrap gap-2">{sizeChoice("form-select h-9 w-auto")}{printButton}</div>}>
      <ul className="grid gap-1">{rows.map(({ place, depth }) => <li key={place.id} style={{ paddingLeft: `${depth * 1.1}rem` }}>
        <label className="flex items-center gap-2 text-sm touch:min-h-11"><Checkbox checked={Boolean(selected?.has(place.id))} onCheckedChange={(value) => toggle(place.id, value === true)} aria-label={`Etikett för ${placeName(place)}`} />{placeName(place)}<span className="text-xs text-muted-foreground">{PLACE_KIND_LABELS[placeKindOf(place)]}</span></label>
      </li>)}</ul>
    </Panel>
    {sheet(false)}
  </div>;
}

/**
 * An older address of the label sheet (`?view=place_labels&customerId=…[&placeIds=…]`, the customer register before
 * 2026-10-22): the labels now belong to the round. With one round at the places asked for (or, without places, one round at
 * the customer) it opens that round's sheet; otherwise a short explanation and the customer's rounds to choose from.
 */
export function PlaceLabelsMoved({ customerId, placeIds }: { customerId: string; placeIds: string[] }) {
  const router = useRouter();
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const wanted = placeIds.join(",");
  useEffect(() => {
    const asked = wanted ? wanted.split(",") : [];
    api<{ schedules: Pick<ScheduleView, "id" | "title" | "holder">[] }>("/api/form-schedules")
      .then((result) => {
        // A round's place is its work order's (2026-10-27 kväll): the one that holds it now.
        const own: Round[] = result.schedules.flatMap((item) => item.holder?.facilityId && (!customerId || item.holder.customerId === customerId)
          ? [{ id: item.id, title: item.title, customerId: item.holder.customerId ?? null, facilityId: item.holder.facilityId, facilityName: item.holder.facilityName ?? "", customerName: item.holder.customerName ?? "" }] : []);
        const atPlaces = asked.length ? own.filter((item) => asked.includes(item.facilityId!)) : [];
        const target = atPlaces.length === 1 ? atPlaces[0] : !asked.length && own.length === 1 ? own[0] : null;
        if (target) { router.replace(roundLabelsHref(target.id)); return; }
        setRounds(atPlaces.length ? atPlaces : own);
      })
      .catch(() => setRounds([]));
  }, [customerId, wanted, router]);
  return <>
    <PageHeader title="QR-etiketter" description="QR-etiketterna skrivs ut från driftronden, för platsen i arbetsordern som håller ronden och objekten under den." />
    <Panel title="Etiketterna skrivs ut från ronden" icon={QrCode}
      actions={<Button asChild variant="outline"><Link href="/?view=rounds" data-testid="labels-to-rounds"><Repeat />Driftronder</Link></Button>}>
      {!rounds ? <p role="status" className="text-sm text-muted-foreground">Letar efter kundens ronder…</p>
        : rounds.length ? <ul className="divide-y" data-testid="labels-rounds">{rounds.map((item) => <li key={item.id} className="py-2.5 first:pt-0 last:pb-0">
          <Link className="font-medium hover:text-primary" href={roundLabelsHref(item.id)}>{item.title}</Link>
          <p className="text-xs text-muted-foreground">{[item.facilityName, item.customerName].filter(Boolean).join(" · ")}</p>
        </li>)}</ul>
        : <p className="text-sm text-muted-foreground" data-testid="labels-moved">Ingen driftrond vid kundens platser. Planera en rond under Driftronder och skriv ut etiketterna därifrån.</p>}
    </Panel>
  </>;
}
