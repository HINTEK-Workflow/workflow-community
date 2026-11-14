"use client";

import { useMemo, useRef, useState } from "react";
import { BookOpen, FilePlus2, PackagePlus, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CUSTOMERS, INITIAL_PURCHASE_ROWS, PROJECTS, SUPPLIERS, UNITS, kronor, parseAmount, type PurchaseRow } from "./data";
import { Bar, LabCard, LabField, LabSelect, Notice, PhoneGroup, PhoneRow, PhoneTopBar, Pill, useLab, useLookOnly } from "./parts";
import s from "./design-lab.module.css";

/**
 * Inköp (Lovable "Nytt inköp", 2026-10-16): basics, an article table that runs edge to edge in its card, and a
 * right-hand summary that follows the scroll (total, Spara, the sum per supplier, the rows without a price). Example data
 * in memory only.
 */
export function PurchaseDemo() {
  const { view, toast } = useLab();
  const lookOnly = useLookOnly();
  const [name, setName] = useState("Material trapphus plan 2–4");
  const [project, setProject] = useState(PROJECTS[2]);
  const [customer, setCustomer] = useState(CUSTOMERS[1]);
  const [note, setNote] = useState("Leverans till arbetsplatsen före kl. 7. Ring arbetsledaren vid ankomst.");
  const [rows, setRows] = useState<PurchaseRow[]>(INITIAL_PURCHASE_ROWS);
  const [editing, setEditing] = useState<PurchaseRow | null>(null);
  const counter = useRef(INITIAL_PURCHASE_ROWS.length);
  const tableRef = useRef<HTMLDivElement>(null);

  const totals = useMemo(() => {
    const perSupplier = new Map<string, { sum: number; count: number }>();
    let total = 0;
    let missing = 0;
    for (const row of rows) {
      const price = parseAmount(row.price);
      const qty = parseAmount(row.qty) ?? 0;
      const entry = perSupplier.get(row.supplier) ?? { sum: 0, count: 0 };
      entry.count += 1;
      if (price === null) missing += 1;
      else { entry.sum += price * qty; total += price * qty; }
      perSupplier.set(row.supplier, entry);
    }
    return { total, missing, perSupplier: [...perSupplier.entries()] };
  }, [rows]);

  const update = (id: string, patch: Partial<PurchaseRow>) => setRows((list) => list.map((row) => row.id === id ? { ...row, ...patch } : row));
  const addRow = () => {
    counter.current += 1;
    const row: PurchaseRow = { id: `r${counter.current}`, artNo: "", name: "", supplier: SUPPLIERS[0], qty: "1", unit: "st", price: "" };
    setRows((list) => [...list, row]);
    if (view === 1) setEditing(row);
    // The new row stands under the table's last row and gets the focus (the app's rule: new items under the add button's list).
    else requestAnimationFrame(() => tableRef.current?.querySelector<HTMLInputElement>(`[data-row="${row.id}"] input[data-first]`)?.focus());
  };
  const removeRow = (id: string) => {
    const index = rows.findIndex((row) => row.id === id);
    const removed = rows[index];
    if (!removed) return;
    setRows((list) => list.filter((row) => row.id !== id));
    toast(`Raden ${removed.name || "utan benämning"} togs bort.`, { label: "Ångra", run: () => setRows((list) => [...list.slice(0, index), removed, ...list.slice(index)]) });
  };
  const save = () => toast("Sparas inte – designlabbet visar bara exempeldata.");

  const rowLine = (row: PurchaseRow) => {
    const price = parseAmount(row.price);
    const qty = parseAmount(row.qty) ?? 0;
    return price === null ? null : price * qty;
  };

  const summary = <div className={s.summaryCard} data-testid="lab-purchase-total">
    <p className={s.summaryLabel}>Totalt inköp exkl. moms</p>
    <p className={s.figure}>{kronor(totals.total)}</p>
    <p className={s.summaryMeta}>{rows.length} {rows.length === 1 ? "rad" : "rader"}</p>
    <Button className={s.btnBlock} onClick={save}>Spara</Button>
  </div>;
  const perSupplier = <LabCard title="Summa per leverantör" testId="lab-supplier-sums">
    <ul className={s.supplierList}>
      {totals.perSupplier.map(([supplier, entry]) => <li key={supplier}>
        <div className={s.supplierLine}><span>{supplier} <span className={s.muted}>({entry.count})</span></span><span className={s.num}>{kronor(entry.sum)}</span></div>
        <Bar value={totals.total ? (entry.sum / totals.total) * 100 : 0} label={`Andel för ${supplier}`} tone="muted" />
      </li>)}
    </ul>
    <p className={s.footnote}>Kunden ser aldrig leverantör, inköpspris eller rabatt.</p>
  </LabCard>;
  const missingNotice = totals.missing ? <Notice testId="lab-missing-price">{totals.missing} {totals.missing === 1 ? "rad saknar" : "rader saknar"} inköpspris och ingår inte i summan.</Notice> : null;

  // ---------- Display level 1: the app look on the phone ----------
  if (view === 1) {
    if (editing) {
      const current = rows.find((row) => row.id === editing.id) ?? editing;
      const done = () => setEditing(null);
      const cancel = () => { setRows((list) => list.map((row) => row.id === editing.id ? editing : row)); setEditing(null); };
      return <div className={s.phoneScreen} data-testid="lab-row-sheet">
        <PhoneTopBar title={current.name || "Ny rad"} cancel onBack={cancel} action="Klar" onAction={done} />
        <div className={s.phoneBody}>
          <PhoneGroup title="Artikel">
            <div className={s.phoneForm}>
              <LabField label="Benämning"><Input className={s.input} value={current.name} placeholder="Vad som köps" onChange={(event) => update(current.id, { name: event.target.value })} /></LabField>
              <LabField label="Art.nr"><Input className={s.input} value={current.artNo} placeholder="Valfritt" onChange={(event) => update(current.id, { artNo: event.target.value })} /></LabField>
              <LabField label="Leverantör"><LabSelect value={current.supplier} options={SUPPLIERS} onChange={(supplier) => update(current.id, { supplier })} /></LabField>
              <div className={s.fieldRow2}>
                <LabField label="Antal"><Input className={s.input} inputMode="decimal" value={current.qty} onChange={(event) => update(current.id, { qty: event.target.value })} /></LabField>
                <LabField label="Enhet"><LabSelect value={current.unit} options={UNITS} onChange={(unit) => update(current.id, { unit })} /></LabField>
              </div>
              <LabField label="Inköpspris (kr)"><Input className={s.input} inputMode="decimal" value={current.price} placeholder="Inget pris" onChange={(event) => update(current.id, { price: event.target.value })} /></LabField>
            </div>
          </PhoneGroup>
          <PhoneGroup><button type="button" className={s.phoneDanger} onClick={() => { setEditing(null); removeRow(current.id); }}>Ta bort raden</button></PhoneGroup>
        </div>
      </div>;
    }
    return <div className={s.phoneScreen} data-testid="lab-purchase">
      <PhoneTopBar title="Nytt inköp" back="Inköp" onBack={lookOnly("Tillbaka")} action="Spara" onAction={save} />
      <div className={s.phoneBody}>
        <div className={s.phoneLead}>
          {/* The top bar names the screen (no double titles at level 1); the heading is for screen readers. */}
          <h1 className={s.srOnly}>Nytt inköp</h1>
          <p className={s.phoneLeadMeta}>{project}</p>
          <Pill tone="draft">Utkast</Pill>
        </div>
        <PhoneGroup title="Grunduppgifter">
          <div className={s.phoneForm}>
            <LabField label="Namn"><Input className={s.input} value={name} onChange={(event) => setName(event.target.value)} /></LabField>
            <LabField label="Projekt"><LabSelect value={project} options={PROJECTS} onChange={setProject} /></LabField>
            <LabField label="Kund"><LabSelect value={customer} options={CUSTOMERS} onChange={setCustomer} /></LabField>
            <LabField label="Anteckning"><textarea className={s.textarea} value={note} onChange={(event) => setNote(event.target.value)} rows={3} /></LabField>
          </div>
        </PhoneGroup>
        <PhoneGroup title={`Artiklar (${rows.length})`}>
          {rows.map((row) => {
            const line = rowLine(row);
            return <PhoneRow key={row.id} title={row.name || "Ny rad"} subtitle={`${row.qty || 0} ${row.unit} · ${row.supplier}`} value={line === null ? <span className={s.muted}>Inget pris</span> : kronor(line)} onClick={() => setEditing(row)} testId="lab-phone-article" />;
          })}
          <button type="button" className={s.phoneAdd} onClick={addRow}><Plus aria-hidden="true" />Lägg till rad</button>
        </PhoneGroup>
        <PhoneGroup title="Summa" footer="Kunden ser aldrig leverantör, inköpspris eller rabatt.">
          <PhoneRow title="Totalt exkl. moms" value={<strong>{kronor(totals.total)}</strong>} />
          {totals.perSupplier.map(([supplier, entry]) => <PhoneRow key={supplier} title={supplier} subtitle={`${entry.count} ${entry.count === 1 ? "rad" : "rader"}`} value={kronor(entry.sum)} />)}
        </PhoneGroup>
        {missingNotice ? <div className={s.phoneInset}>{missingNotice}</div> : null}
        <PhoneGroup title="Mer">
          <PhoneRow icon={Send} title="Till grossist" onClick={lookOnly("Till grossist")} />
          <PhoneRow icon={FilePlus2} title="Lägg i offert" onClick={lookOnly("Lägg i offert")} />
          <PhoneRow icon={PackagePlus} title="Lägg som material" onClick={lookOnly("Lägg som material")} />
        </PhoneGroup>
      </div>
      <div className={s.phoneFlow}><Button className={s.btnBlock} onClick={save}>Spara inköpet</Button></div>
    </div>;
  }

  // ---------- Display levels 2 and 3 ----------
  const header = <header className={s.pageHeader} data-testid="lab-page-header">
    <div className={s.minw0}>
      <h1 className={s.pageTitle}>Nytt inköp <Pill tone="draft" testId="lab-status">Utkast</Pill></h1>
      <p className={s.pageSub}>{project} · {customer}</p>
    </div>
    <div className={s.headerActions}>
      <Button variant="outline" className={s.btn} onClick={lookOnly("Till grossist")}><Send />Till grossist</Button>
      <Button variant="outline" className={s.btn} onClick={lookOnly("Lägg i offert")}><FilePlus2 />Lägg i offert</Button>
      <Button variant="outline" className={s.btn} onClick={lookOnly("Lägg som material")}><PackagePlus />Lägg som material</Button>
      {view === 2 ? <Button className={s.btn} onClick={save}>Spara</Button> : null}
    </div>
  </header>;

  const basics = <LabCard title="Grunduppgifter" description="Vad som köps in och till vilket jobb." testId="lab-basics" collapsible={view === 2} defaultOpen>
    <div className={s.formGrid3}>
      <LabField label="Namn"><Input className={s.input} value={name} onChange={(event) => setName(event.target.value)} /></LabField>
      <LabField label="Projekt"><LabSelect value={project} options={PROJECTS} onChange={setProject} /></LabField>
      <LabField label="Kund"><LabSelect value={customer} options={CUSTOMERS} onChange={setCustomer} /></LabField>
      <LabField label="Anteckning" wide><textarea className={s.textarea} value={note} placeholder="Till exempel leveransadress eller märkning" onChange={(event) => setNote(event.target.value)} rows={3} /></LabField>
    </div>
  </LabCard>;

  const articles = <LabCard title="Artiklar" description="Inköpspriset syns bara internt. Rader utan pris räknas inte in i summan." flush testId="lab-articles"
    actions={<>
      <Button variant="outline" className={s.btn} onClick={lookOnly("Bläddra bland artiklar")}><BookOpen />Bläddra</Button>
      <Button variant="secondary" className={s.btnSoft} onClick={addRow} data-testid="lab-add-row"><Plus />Lägg till rad</Button>
    </>}>
    <div className={s.tableBox} ref={tableRef}>
      <div role="table" aria-label="Artiklar" className={s.table} data-kind="articles">
        <div role="row" className={s.tableHead}>
          {["Art.nr", "Benämning", "Leverantör", "Antal", "Enhet", "Inköpspris", "Belopp"].map((label, index) => <span key={label} role="columnheader" className={index >= 5 ? s.right : undefined}>{label}</span>)}
          <span role="columnheader" className={s.srOnly}>Ta bort</span>
        </div>
        {rows.map((row) => {
          const line = rowLine(row);
          return <div role="row" key={row.id} className={s.tableRow} data-row={row.id} data-testid="lab-article-row">
            <label role="cell" className={s.cell}><span className={s.cellLabel}>Art.nr</span><Input data-first="" className={s.cellInput} value={row.artNo} placeholder="—" onChange={(event) => update(row.id, { artNo: event.target.value })} /></label>
            <label role="cell" className={s.cell}><span className={s.cellLabel}>Benämning</span><Input className={s.cellInput} value={row.name} placeholder="Benämning" onChange={(event) => update(row.id, { name: event.target.value })} /></label>
            <label role="cell" className={s.cell}><span className={s.cellLabel}>Leverantör</span><LabSelect value={row.supplier} options={SUPPLIERS} onChange={(supplier) => update(row.id, { supplier })} /></label>
            <label role="cell" className={s.cell}><span className={s.cellLabel}>Antal</span><Input className={s.cellInput} inputMode="decimal" value={row.qty} onChange={(event) => update(row.id, { qty: event.target.value })} /></label>
            <label role="cell" className={s.cell}><span className={s.cellLabel}>Enhet</span><LabSelect value={row.unit} options={UNITS} onChange={(unit) => update(row.id, { unit })} /></label>
            <label role="cell" className={s.cell}><span className={s.cellLabel}>Inköpspris</span><Input className={`${s.cellInput} ${s.right}`} inputMode="decimal" value={row.price} placeholder="Inget pris" onChange={(event) => update(row.id, { price: event.target.value })} /></label>
            <span role="cell" className={`${s.cell} ${s.amount}`}><span className={s.cellLabel}>Belopp</span>{line === null ? <span className={s.muted}>Inget pris</span> : <span className={s.num}>{kronor(line)}</span>}</span>
            <span role="cell" className={`${s.cell} ${s.cellEnd}`}><button type="button" className={s.iconButton} aria-label={`Ta bort ${row.name || "raden"}`} onClick={() => removeRow(row.id)}><Trash2 aria-hidden="true" /></button></span>
          </div>;
        })}
        {rows.length === 0 ? <p className={s.empty}>Inga rader ännu. Lägg till en rad eller bläddra bland artiklarna.</p> : null}
      </div>
    </div>
  </LabCard>;

  if (view === 2) {
    return <div className={s.page} data-testid="lab-purchase">
      {header}
      <div className={s.strip} data-testid="lab-purchase-total">
        <div><p className={s.summaryLabel}>Totalt inköp exkl. moms</p><p className={s.stripFigure}>{kronor(totals.total)}</p></div>
        <div><p className={s.summaryLabel}>Rader</p><p className={s.stripFigure}>{rows.length}</p></div>
        <div><p className={s.summaryLabel}>Utan pris</p><p className={s.stripFigure}>{totals.missing}</p></div>
      </div>
      <div className={s.stack}>
        {basics}
        {articles}
        {missingNotice}
        {perSupplier}
      </div>
    </div>;
  }

  return <div className={s.page} data-testid="lab-purchase">
    <div className={s.withAside}>
      <div className={s.stack}>
        {header}
        {basics}
        {articles}
      </div>
      <aside className={s.aside} aria-label="Sammanfattning" data-testid="lab-summary">
        {summary}
        {perSupplier}
        {missingNotice}
      </aside>
    </div>
  </div>;
}
