"use client";

import { useState } from "react";
import { DialogActions, Field, Modal } from "@/features/kfid/ui";
import { ArticleSearchField } from "@/features/workflow/catalogue-picker";
import { announce } from "@/lib/workflow/toast";
import { cn } from "@/lib/utils";
import { nextSeriesStart, partDepth, quantityText, storeLevelName, STORE_LOCATION_KIND_LABELS, STORE_LOCATION_KINDS, subtreeIds, type StoreLocationKind } from "@/lib/maintenance/model";
import { maintenancePost, type StoreArticleCard, type StoreLocationRow } from "./maintenance-api";

/** Förrådets rutor (2026-10-31): förrådet och platserna i det, en ny artikel, en artikels uppgifter, Inleverans och Inventera. */
const chip = (on: boolean) => cn("touch-target h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-sm", on ? "border-primary/30 bg-secondary font-medium" : "text-muted-foreground hover:text-foreground");
const shapedOf = (rows: readonly StoreLocationRow[]) => rows.map((row) => ({ id: row.id, parentId: row.parentId, name: row.name }));

export function LocationDialog({ mode, row, parent, locations, onClose, onSaved }: { mode: "store" | "child" | "edit"; row: StoreLocationRow | null; parent: StoreLocationRow | null; locations: StoreLocationRow[]; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const shaped = shapedOf(locations);
  const atTop = mode === "store" || (mode === "edit" && !row?.parentId);
  const [name, setName] = useState(row?.label ?? "");
  const [kind, setKind] = useState<StoreLocationKind>(row?.kind ?? "STORE");
  const [paused, setPaused] = useState(row ? !row.isActive : false);
  const [parentId, setParentId] = useState(mode === "child" ? parent?.id ?? "" : row?.parentId ?? "");
  const suggested = nextSeriesStart(locations.map((item) => item.seriesStart));
  const [series, setSeries] = useState(String(row?.seriesStart ?? (mode === "store" ? suggested : "")));
  const [busy, setBusy] = useState(false);
  const depth = mode === "child" && parent ? partDepth(shaped, parent.id) + 1 : row ? partDepth(shaped, row.id) : 0;
  const level = storeLevelName(depth, kind);
  const title = mode === "store" ? "Nytt förråd" : mode === "child" ? `Ny ${level.toLowerCase()} under ${parent?.label ?? ""}` : `Redigera ${row?.label ?? ""}`;
  const seriesNumber = series.trim() === "" ? null : Number(series);
  const seriesBad = atTop && seriesNumber !== null && !(Number.isInteger(seriesNumber) && seriesNumber > 0 && seriesNumber <= 999_000_000);
  const below = row ? subtreeIds(shaped, row.id) : [];
  const parentChoices = locations.filter((item) => !below.includes(item.id));
  const save = async () => {
    setBusy(true);
    try {
      const body = { name, kind, isActive: !paused, parentId: mode === "store" ? null : parentId || null, ...(atTop && seriesNumber !== null ? { seriesStart: seriesNumber } : {}) };
      const made = row ? await maintenancePost<{ ok: boolean }>({ action: "update_location", id: row.id, location: body }).then(() => ({ id: row.id })) : await maintenancePost<{ id: string }>({ action: "create_location", location: body });
      announce("Förrådsplatsen är sparad.");
      await onSaved(made.id);
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title={title} size="form">
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="store-location-form">
      <Field id="sl-name" label="Namn" required value={name} placeholder={atTop ? "Till exempel Fabriken" : `Till exempel ${level} 1`} onChange={setName} />
      {mode === "store" || (mode === "edit" && row?.parentId === null) ? <Field id="sl-kind" label="Sort" value={kind} options={[...STORE_LOCATION_KINDS]} optionLabels={STORE_LOCATION_KIND_LABELS} onChange={(next) => setKind(next as StoreLocationKind)} /> : null}
      {atTop ? <Field id="sl-series" label="Nummerserie börjar på" value={series} placeholder={String(suggested)} onChange={setSeries} help="Nya artiklar får nästa lediga nummer. Nummer som redan finns ändras inte." /> : null}
      {mode === "edit" && row ? <Field id="sl-parent" label="Ligger under" value={parentId} options={["", ...parentChoices.map((item) => item.id)]} optionLabels={Object.fromEntries([["", "Översta nivån"], ...parentChoices.map((item) => [item.id, item.name])])} onChange={setParentId} /> : null}
      {row ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={paused} onChange={(event) => setPaused(event.target.checked)} />Pausad</label> : null}
      {seriesBad ? <p role="alert" className="text-sm text-destructive">Nummerserien ska vara ett heltal större än noll.</p> : null}
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara", type: "submit", busy, busyLabel: "Sparar…", disabledReason: !name.trim() ? "Skriv ett namn först." : seriesBad ? "Rätta nummerserien." : null, testId: "store-location-save" }} />
    </form>
  </Modal>;
}

/**
 * Ny artikel: "Sök bland inköpsartiklar" (artikelregistret) eller en egen artikel. Båda får nästa lediga nummer ur förrådets serie;
 * grossistens nummer och leverantör står på raden "Beställs som".
 */
export function AddItemDialog({ locations, storeId, onClose, onSaved }: { locations: StoreLocationRow[]; storeId: string | null; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const stores = locations.filter((row) => !row.parentId && row.isActive);
  const startStore = (() => {
    let current = locations.find((row) => row.id === storeId);
    const seen = new Set<string>();
    while (current?.parentId && !seen.has(current.id)) { seen.add(current.id); current = locations.find((row) => row.id === current!.parentId); }
    return current && stores.some((row) => row.id === current!.id) ? current.id : stores[0]?.id ?? "";
  })();
  const [source, setSource] = useState<"register" | "own">("register");
  const [store, setStore] = useState(startStore);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("st");
  const [picked, setPicked] = useState<{ id: string; orderAs: string } | null>(null);
  const [shelfText, setShelfText] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [articleNo, setArticleNo] = useState("");
  const [busy, setBusy] = useState(false);
  const next = stores.find((row) => row.id === store);
  const save = async () => {
    setBusy(true);
    try {
      const made = await maintenancePost<{ id: string; ownNumber: number | null; created: boolean }>({ action: "add_store_item", article: source === "register" && picked ? { articleRef: picked.id, storeId: store, shelfText } : { name, unit, articleNo, supplierName, shelfText, storeId: store } });
      announce(made.created ? (made.ownNumber ? `Artikeln fick nummer ${made.ownNumber}.` : "Artikeln finns nu i förrådet.") : "Artikeln finns redan i förrådet.");
      await onSaved(made.id);
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  const missing = !stores.length ? "Lägg till ett förråd först." : source === "register" ? (picked ? null : "Välj en artikel först.") : name.trim() ? null : "Skriv en benämning först.";
  return <Modal open onOpenChange={(open) => { if (!open) onClose(); }} title="Ny artikel i förrådet" size="form">
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="store-item-form">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Var artikeln kommer ifrån">
        <button type="button" className={chip(source === "register")} aria-current={source === "register" ? "true" : undefined} onClick={() => setSource("register")} data-testid="store-item-source-register">Sök bland inköpsartiklar</button>
        <button type="button" className={chip(source === "own")} aria-current={source === "own" ? "true" : undefined} onClick={() => { setSource("own"); setPicked(null); }} data-testid="store-item-source-own">Egen artikel</button>
      </div>
      <Field id="si-store" label="Förråd" value={store} options={stores.map((row) => row.id)} optionLabels={Object.fromEntries(stores.map((row) => [row.id, row.label]))} onChange={setStore}
        help={next?.nextNumber ? `Får nummer ${next.nextNumber}.` : "Får nästa lediga nummer i förrådets serie."} />
      {source === "register" ? <ArticleSearchField label="Sök bland inköpsartiklar" value={name} local={false} onChange={(text) => { setName(text); setPicked(null); }}
        onPick={(hit) => { setPicked({ id: hit.id, orderAs: [hit.supplierName, hit.supplierArticleNo || hit.eNumber].filter(Boolean).join(" ") }); setName(hit.name); setUnit(hit.unit || "st"); }} />
        : <>
          <Field id="si-name" label="Benämning" required value={name} onChange={setName} />
          <Field id="si-unit" label="Enhet" value={unit} suggestions={["st", "sats", "m", "l", "kg", "dunk", "förp"]} onChange={setUnit} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="si-supplier" label="Beställs hos" value={supplierName} placeholder="Valfritt" onChange={setSupplierName} />
            <Field id="si-article-no" label="Deras artikelnummer" value={articleNo} placeholder="Valfritt" onChange={setArticleNo} />
          </div>
        </>}
      {source === "register" && picked ? <p className="text-xs text-muted-foreground" data-testid="store-item-order-as-preview">Beställs som: {picked.orderAs || "–"}</p> : null}
      <Field id="si-shelf" label="Hylla" value={shelfText} placeholder="Valfritt, till exempel B3" onChange={setShelfText} />
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Lägg till", type: "submit", busy, busyLabel: "Sparar…", disabledReason: missing, testId: "store-item-save" }} />
    </form>
  </Modal>;
}

/** Hyllan, "Beställs som" och lägsta saldo. Namn, enhet och pris går bara att ändra på en egen artikel; numret ändras aldrig här. */
export function EditItemDialog({ item, pricesVisible, onClose, onSaved }: { item: StoreArticleCard["item"]; pricesVisible: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState({ name: item.name, unit: item.unit, shelfText: item.shelfText, supplierName: item.supplierName, articleNo: item.articleNo, minQuantity: item.minQuantity === null ? "" : quantityText(item.minQuantity), unitPrice: item.ownPrice === null ? "" : quantityText(item.ownPrice) });
  const [busy, setBusy] = useState(false);
  const own = !item.fromRegister;
  const save = async () => {
    setBusy(true);
    try {
      await maintenancePost({ action: "update_store_item", id: item.id, minQuantity: draft.minQuantity.trim() || null, item: { shelfText: draft.shelfText, supplierName: draft.supplierName, articleNo: draft.articleNo, ...(own ? { name: draft.name, unit: draft.unit } : {}), ...(own && pricesVisible ? { unitPrice: draft.unitPrice.trim() || null } : {}) } });
      announce("Artikeln är sparad.");
      await onSaved();
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title={`Redigera ${item.name}`} size="form">
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="store-item-edit-form">
      {own ? <div className="grid gap-4 sm:grid-cols-2">
        <Field id="se-name" label="Benämning" required value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
        <Field id="se-unit" label="Enhet" value={draft.unit} onChange={(unit) => setDraft({ ...draft, unit })} />
      </div> : null}
      <Field id="se-shelf" label="Hylla" value={draft.shelfText} placeholder="Valfritt, till exempel B3" onChange={(shelfText) => setDraft({ ...draft, shelfText })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="se-supplier" label="Beställs hos" value={draft.supplierName} onChange={(supplierName) => setDraft({ ...draft, supplierName })} />
        <Field id="se-article-no" label="Deras artikelnummer" value={draft.articleNo} onChange={(articleNo) => setDraft({ ...draft, articleNo })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="sn-min" label={`Lägsta saldo (${item.unit})`} value={draft.minQuantity} placeholder="Tomt = inget" onChange={(minQuantity) => setDraft({ ...draft, minQuantity })} help="Under den nivån visas Lågt och Beställ." />
        {own && pricesVisible ? <Field id="se-price" label={`Pris per ${item.unit}`} value={draft.unitPrice} placeholder="Valfritt" onChange={(unitPrice) => setDraft({ ...draft, unitPrice })} /> : null}
      </div>
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara", type: "submit", busy, busyLabel: "Sparar…", disabledReason: own && !draft.name.trim() ? "Skriv en benämning först." : null, testId: "store-item-edit-save" }} />
    </form>
  </Modal>;
}

/** Inleverans (more on a place) or Inventering (the counted balance replaces the old; the log keeps the difference). */
export function MoveDialog({ kind, item, balances, locations, onClose, onSaved }: { kind: "receive" | "count"; item: { id: string; name: string; unit: string }; balances: { locationId: string; quantity: number }[]; locations: StoreLocationRow[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const balanceAt = (id: string) => balances.find((row) => row.locationId === id)?.quantity ?? 0;
  // The place that already holds the article first, as that is where it usually goes.
  const startPlace = locations.find((row) => balanceAt(row.id) > 0)?.id ?? locations[0]?.id ?? "";
  const counting = kind === "count";
  const [locationId, setLocationId] = useState(startPlace);
  const [quantity, setQuantity] = useState(counting ? quantityText(balanceAt(startPlace)) : "1");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await maintenancePost(counting ? { action: "count", move: { itemId: item.id, locationId, counted: quantity, note } } : { action: "receive", move: { itemId: item.id, locationId, quantity, note } });
      announce(counting ? "Inventeringen är sparad." : "Inleveransen är sparad.");
      await onSaved();
    } catch (cause) { announce((cause as Error).message, true); } finally { setBusy(false); }
  };
  return <Modal open onOpenChange={(next) => { if (!next) onClose(); }} title={`${counting ? "Inventera" : "Inleverans"} · ${item.name}`} size="form">
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }} data-testid="store-move-form">
      <Field id="sm-location" label="Förrådsplats" value={locationId} options={locations.map((row) => row.id)} optionLabels={Object.fromEntries(locations.map((row) => [row.id, `${row.name} (${quantityText(balanceAt(row.id))} ${item.unit})`]))}
        onChange={(next) => { setLocationId(next); if (counting) setQuantity(quantityText(balanceAt(next))); }} />
      <Field id="sm-qty" label={counting ? `Räknat antal (${item.unit})` : `Antal (${item.unit})`} value={quantity} onChange={setQuantity} />
      <Field id="sm-note" label="Anteckning" value={note} placeholder="Valfritt" onChange={setNote} />
      {counting ? <p className="text-xs text-muted-foreground">Det räknade antalet ersätter saldot. Skillnaden sparas i loggen.</p> : null}
      <DialogActions cancel={{ onClick: onClose }} primary={{ label: "Spara", type: "submit", busy, busyLabel: "Sparar…", disabledReason: locationId ? null : "Välj en förrådsplats.", testId: "store-move-save" }} />
    </form>
  </Modal>;
}
