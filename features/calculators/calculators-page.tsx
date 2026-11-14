"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Cable, Calculator as CalculatorIcon, Cpu, Ruler, Scale, Timer, TrendingDown, Zap, ZapOff, type LucideIcon } from "lucide-react";
import { useVisitHistory } from "@/components/history-nav";
import { Button } from "@/components/ui/button";
import { NativeLead, NativeMenuPage, useNativeTopBar, type NativeMenuGroup } from "@/components/native";
import { PageHeader, usePageTrail } from "@/components/page-shell";
import { useDetailLevel, useNativeMode } from "@/features/workflow/use-detail-level";
import { companyCalcData } from "@/lib/calculators/company-data";
import { CALC_ENTRIES, type CalcEntry } from "@/lib/calculators/kalkylator/list";
import { calcHref, COMPANY_VALUES_TOOL, companyValuesOpen, readSelection, readSelectionOrDefault } from "@/lib/calculators/kalkylator/navigation";
import type { CalcContext } from "@/lib/calculators/types";
import { cn } from "@/lib/utils";
import { VIEW_LABEL } from "@/lib/workflow/navigation";
import { CalculatorScreen, type ModuleStates } from "./calculator-screen";
import { useCompanyCalcValues } from "./company-calc-values";
import { CalculatorValuesPanel } from "./company-values-panel";

/**
 * Kalkylator (2026-10-12): the list of calculators and each calculator as a page of its own, Verktyg → Kalkylator.
 * On a phone at display level 1 it follows the app's patterns: the list is a menu page (M2: the first two as big tiles, the
 * rest as rows), a calculator is a screen with the top bar's ‹ Kalkylator and the main figures in a bar under the fields.
 * At level 2–3 and on a computer the list is a row of tabs over the open calculator. The calculators are plain functions in
 * the browser (lib/calculators/engine, nothing is sent or stored); the company's own values – reactance, limit, voltage
 * factors, Iz tables and its protective devices with Ia – come from Värden och referenser, in Cloud and the demo from the
 * server, in Local from the open file. Workflow delivers no table and no limit.
 */
const ICONS: Record<string, LucideIcon> = { power: Zap, transformer: Cpu, "short-circuit": ZapOff, disconnection: Timer, "voltage-drop": TrendingDown, "branch-length": Ruler, "cable-sizing": Cable };
const iconOf = (entry: CalcEntry) => ICONS[entry.id] ?? CalculatorIcon;
const VALUES_TITLE = "Företagets värden";

export function CalculatorsPage({ admin, local, notify }: { admin: boolean; local: boolean; notify: (text: string, error?: boolean) => void }) {
  const native = useNativeMode();
  const level = useDetailLevel();
  const router = useRouter();
  const params = useSearchParams();
  const values = useCompanyCalcValues(local);
  const ctx = useMemo<CalcContext>(() => ({ company: companyCalcData(values.values) }), [values.values]);
  // Every input stays when the person moves between calculators (and between the list and a calculator).
  const [states, setStates] = useState<ModuleStates>({});
  const selected = native ? readSelection(params) : readSelectionOrDefault(params);
  const entry = selected.entry;
  const part = selected.part;
  // Företagets värden as a screen of its own at level 1 (2026-10-12), for the one who may change them.
  const valuesScreen = native && companyValuesOpen(params) && values.canEdit;
  // Levels 2 and 3 (UX-granskningen C5, 2026-10-22): the same values inside Kalkylatorn, no longer on Värden och referenser.
  const valuesPage = !native && companyValuesOpen(params) && values.canEdit;
  usePageTrail({ calculator: valuesPage ? VALUES_TITLE : entry?.name ?? (valuesScreen ? VALUES_TITLE : undefined) }, { tool: valuesPage ? COMPANY_VALUES_TOOL : entry?.id ?? (valuesScreen ? COMPANY_VALUES_TOOL : null) });
  // M1: the screen of a calculator names itself and goes back to the list.
  // Företagets värden draws its own bar (Avbryt/Spara) from the panel.
  useNativeTopBar(native && entry ? { title: entry.name, back: { label: VIEW_LABEL.calculators } } : null);
  const { canBack, back } = useVisitHistory();
  const closeValues = () => { if (canBack) back(); else router.push(calcHref()); };

  // A step of its own (2026-11-02): Tillbaka goes to the calculator before, not past them all.
  const show = (entryId: string, partId?: string) => router.push(calcHref(entryId, partId), { scroll: false });
  const notice = values.status === "unavailable" || values.status === "closed"
    ? <p className="notice" role="status" data-testid="calc-values-status">{values.message}{values.status === "unavailable" ? " Kalkylatorerna fungerar ändå med dina egna värden." : ""}</p> : null;

  if (native) {
    if (valuesScreen) {
      // M4: the same panel as Inställningar → Värden och referenser, saved the same way; title, Avbryt and Spara in the top bar.
      return <div className="native-screen pb-4" data-testid="calculators-page" data-entry={COMPANY_VALUES_TOOL}>
        <NativeLead>
          <CalculatorValuesPanel values={values.values} canEdit={values.canEdit} screen={{ title: VALUES_TITLE, onClose: closeValues }}
            onSave={async (inputs) => {
              try { await values.save(inputs); notify(inputs.length === 1 ? "Värdet är sparat." : `${inputs.length} värden är sparade.`); return true; }
              catch (cause) { notify((cause as Error).message, true); return false; }
            }} />
        </NativeLead>
      </div>;
    }
    if (!entry || !part) {
      // M2: the two first calculators as tiles, the others as rows; the title is the top bar's. Last, Företagets värden
      // (Mina skyddsapparater, Iz-tabeller): a screen for the one who may change them, a line that says who does for the rest.
      const [first, second, ...rest] = CALC_ENTRIES;
      const open = (item: CalcEntry) => ({ title: item.name, type: item.type, icon: iconOf(item), href: calcHref(item.id), testId: `calc-open-${item.id}` });
      const valuesRow: NativeMenuGroup["rows"][number] = values.canEdit
        ? { key: COMPANY_VALUES_TOOL, title: VALUES_TITLE, subtitle: "Mina skyddsapparater, Iz-tabeller och förval.", type: "tools", icon: Scale, href: calcHref(COMPANY_VALUES_TOOL), testId: "calc-open-company-values" }
        : { key: COMPANY_VALUES_TOOL, title: VALUES_TITLE, subtitle: "Mina skyddsapparater och Iz-tabeller läggs in av en företagsadministratör.", type: "tools", icon: Scale, chevron: false, testId: "calc-company-values-info" };
      return <div data-testid="calculators-page">
        {notice}
        <NativeMenuPage testId="calculators-list" tiles={[first!, second!].map(open)}
          groups={[{ rows: [...rest.map((item) => ({ key: item.id, ...open(item), subtitle: item.summary })), valuesRow] }]} />
      </div>;
    }
    return <div className="pb-4" data-testid="calculators-page" data-entry={entry.id}>
      {notice}
      <CalculatorScreen entry={entry} part={part} onPart={(id) => show(entry.id, id)} ctx={ctx} admin={admin} notify={notify} native states={states} setStates={setStates} compact />
    </div>;
  }

  const saveValues = async (inputs: Parameters<typeof values.save>[0]) => {
    try { await values.save(inputs); notify(inputs.length === 1 ? "Värdet är sparat." : `${inputs.length} värden är sparade.`); return true; }
    catch (cause) { notify((cause as Error).message, true); return false; }
  };
  if (valuesPage) return <div className="space-y-6" data-testid="calculators-page" data-entry={COMPANY_VALUES_TOOL}>
    <PageHeader title={VALUES_TITLE} description="Kabel och beräkningsvillkor, belastbarhet och Mina skyddsapparater – används av kalkylatorerna."
      actions={<Button asChild variant="outline"><Link href={calcHref()} data-testid="calc-close-values"><CalculatorIcon />Till kalkylatorerna</Link></Button>} />
    {notice}
    <CalculatorValuesPanel values={values.values} canEdit={values.canEdit} onSave={saveValues} />
  </div>;

  return <div className="space-y-6" data-testid="calculators-page" data-entry={entry!.id}>
    <PageHeader title={VIEW_LABEL.calculators}
      description={level === 3 ? "Effekt, transformator, kortslutning, frånkoppling, spänningsfall, gruppledningslängd och kabeldimensionering. Resultaten är beräkningsunderlag – dimensionering och säkerhetsbeslut fattas av en behörig person." : undefined}
      actions={admin && values.canEdit ? <Button asChild variant="outline"><Link href={calcHref(COMPANY_VALUES_TOOL)} data-testid="calc-open-values"><Scale />Företagets värden</Link></Button> : null} />
    {notice}
    <ToolPicker current={entry!.id} onSelect={(id) => show(id)} />
    <CalculatorScreen entry={entry!} part={part!} onPart={(id) => show(entry!.id, id)} ctx={ctx} admin={admin} notify={notify} native={false} states={states} setStates={setStates} compact={level < 3} />
  </div>;
}

function ToolPicker({ current, onSelect }: { current: string; onSelect: (id: string) => void }) {
  return <div>
    <label className="block sm:hidden">
      <span className="sr-only">Kalkylator</span>
      <select className="form-select" aria-label="Kalkylator" value={current} onChange={(event) => onSelect(event.target.value)} data-testid="calc-picker">
        {CALC_ENTRIES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    <nav aria-label="Kalkylator" className="hidden flex-wrap gap-2 border-b pb-4 sm:flex" data-testid="calc-tabs">
      {CALC_ENTRIES.map((item) => {
        const Icon = iconOf(item);
        const active = item.id === current;
        return <button key={item.id} type="button" onClick={() => onSelect(item.id)} aria-pressed={active} data-testid={`calc-tab-${item.id}`}
          className={cn("flex h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors", active ? "border-primary/30 bg-secondary font-medium text-secondary-foreground ring-1 ring-primary/15" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground")}>
          <Icon className={cn("size-4", active ? "text-primary" : "")} aria-hidden="true" />{item.name}
        </button>;
      })}
    </nav>
  </div>;
}
