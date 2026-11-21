"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Calculator, RotateCcw } from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/features/kfid/ui";
import { Segmented } from "@/features/workflow/work-list";
import { OPEN_CALCULATOR_EVENT } from "@/lib/workflow/shell-events";
import { calcHref } from "@/lib/calculators/kalkylator/navigation";
import { cn } from "@/lib/utils";
import {
  enterThreePhase, initialThreePhase, resetThreePhase, restoreThreePhase, setPowerUnit, solveThreePhase, THREE_PHASE_LABEL,
  THREE_PHASE_STORAGE_KEY, type PowerUnit, type ThreePhaseField, type ThreePhaseQuantity, type ThreePhaseState,
} from "@/lib/calculators/three-phase";
import { IconButton } from "@/components/ui/icon-button";

/**
 * The compact calculator in the top bar (2026-10-08): a calculator icon beside Sök on every width, in Cloud,
 * Local and the demo (they share the shell's top bar). On a computer it opens as a small popover anchored to the
 * button, on a phone as a sheet from below. Trefaseffekt, P = √3 × U × I × cos φ: two typed, the third calculated, no
 * button to press. The unit and the last values stay on this device only (localStorage), never on the server.
 *
 * Kalkylator (2026-10-12): the calculators are one page of their own (features/calculators/calculators-page.tsx), where this
 * one is the first part of "Effekt och ström" (ThreePhaseBody, unchanged). The icon here still opens it quickly as a popover or
 * sheet and links to the page; Mer → Verktyg → Kalkylator (OPEN_CALCULATOR_EVENT) opens the page.
 */
const NARROW = "(max-width: 639px)";
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(NARROW);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const useNarrowScreen = () => useSyncExternalStore(subscribe, () => window.matchMedia(NARROW).matches, () => false);

function readSaved(): ThreePhaseState {
  try { return restoreThreePhase(JSON.parse(window.localStorage.getItem(THREE_PHASE_STORAGE_KEY) ?? "null")); } catch { return initialThreePhase(); }
}
function writeSaved(state: ThreePhaseState) {
  try { window.localStorage.setItem(THREE_PHASE_STORAGE_KEY, JSON.stringify(state)); } catch { /* Private window or blocked storage: remembering is only a convenience. */ }
}

export function ThreePhaseCalculator() {
  const [open, setOpen] = useState(false);
  const narrow = useNarrowScreen();
  const router = useRouter();
  // Mer → Kalkylator at level 1 on a phone, where the top bar has no calculator icon (2026-10-09): the page with the list.
  useEffect(() => {
    const show = () => router.push(calcHref());
    window.addEventListener(OPEN_CALCULATOR_EVENT, show);
    return () => window.removeEventListener(OPEN_CALCULATOR_EVENT, show);
  }, [router]);
  const more = <Link href={calcHref()} onClick={() => setOpen(false)} className="mt-3 flex min-h-10 items-center justify-center rounded-lg border text-sm font-medium text-primary hover:bg-secondary/60" data-testid="calculator-all">Alla kalkylatorer</Link>;
  const trigger = (
    <IconButton label="Kalkylator" title="Kalkylator – trefaseffekt" variant="outline" size="default" className="workspace-calculator-button size-10 px-0" aria-expanded={open} aria-haspopup="dialog" onClick={narrow ? () => setOpen(true) : undefined} data-testid="calculator-button">
      <Calculator className="size-4" />
    </IconButton>
  );
  if (narrow) {
    return <>
      {trigger}
      <Modal open={open} onOpenChange={setOpen} title="Trefaseffekt" className="max-w-md">
        {open ? <><ThreePhaseBody />{more}</> : null}
      </Modal>
    </>;
  }
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>{trigger}</Popover.Trigger>
    <Popover.Portal>
      <Popover.Content align="end" sideOffset={8} collisionPadding={16} aria-label="Trefaseffekt" className="z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg" data-testid="calculator-popover">
        <Popover.Arrow className="fill-border" />
        <p className="flex items-center gap-2 text-sm font-semibold"><span className="flex size-7 items-center justify-center rounded-lg bg-secondary text-primary"><Calculator className="size-4" /></span>Trefaseffekt</p>
        <ThreePhaseBody />
        {more}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}

const FIELD_LABEL: Record<ThreePhaseField, string> = { p: "P – aktiv effekt", u: "U – huvudspänning", i: "I – ström", pf: "cos φ – effektfaktor" };
const UNIT: Record<ThreePhaseQuantity, string> = { p: "", u: "V", i: "A" };
/** A grey example in an empty field, so the calculator does not look unused before the first value (audit 2026-10-12). */
const EXAMPLE: Record<ThreePhaseField, (unit: PowerUnit) => string> = { p: (unit) => `t.ex. ${unit === "kW" ? "11,1" : "11085"}`, u: () => "t.ex. 400", i: () => "t.ex. 16", pf: () => "1" };

/** The fields and the result line; mounted only while the calculator is open, so the saved state is read then. */
export function ThreePhaseBody() {
  const [state, setState] = useState<ThreePhaseState>(readSaved);
  const id = useId();
  useEffect(() => { writeSaved(state); }, [state]);
  const outcome = solveThreePhase(state);
  const enter = (field: ThreePhaseField) => (event: React.ChangeEvent<HTMLInputElement>) => setState((current) => enterThreePhase(current, field, event.target.value));
  const field = (key: ThreePhaseField) => {
    const computed = outcome.result === key;
    const unit = key === "pf" ? "" : key === "p" ? state.unit : UNIT[key];
    const issue = outcome.invalid[key];
    return <div key={key} className="field-stack">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`${id}-${key}`} className="field-label text-xs font-semibold">{FIELD_LABEL[key]}{unit ? ` (${unit})` : ""}</label>
        {computed ? <span className="rounded-md bg-primary/10 px-1.5 text-[0.6875rem] font-semibold leading-5 text-primary" data-testid={`three-phase-computed-${key}`}>Beräknat</span> : null}
      </div>
      <Input id={`${id}-${key}`} inputMode="decimal" autoComplete="off" value={computed ? (outcome.text ? outcome.text.split(" ")[0] : "") : state.texts[key]} onChange={computed ? undefined : enter(key)} readOnly={computed}
        aria-readonly={computed || undefined} aria-invalid={issue ? true : undefined} aria-describedby={key === "pf" ? `${id}-pf-help` : issue ? `${id}-${key}-issue` : undefined} placeholder={computed ? "Beräknas" : EXAMPLE[key](state.unit)}
        className={cn(computed && "border-primary/40 bg-background font-semibold text-primary")} data-testid={`three-phase-${key}`} />
      {key === "pf" ? <p id={`${id}-pf-help`} className="text-xs text-muted-foreground">Antagande – ändra vid behov.</p> : null}
      {issue ? <p id={`${id}-${key}-issue`} className="text-xs text-destructive">{issue}</p> : null}
    </div>;
  };
  return <div className="mt-3 space-y-3">
    <p className="text-xs text-muted-foreground">P = √3 × U × I × cos φ. Fyll i två av P, U och I – det tredje beräknas.</p>
    <div className="field-group space-y-3 rounded-xl border p-3">
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0 flex-1">{field("p")}</div>
        <Segmented<PowerUnit> label="Enhet för P" value={state.unit} onChange={(unit) => setState((current) => setPowerUnit(current, unit))} testId="three-phase-unit" options={[{ value: "W", label: "W" }, { value: "kW", label: "kW" }]} />
      </div>
      {field("u")}
      {field("i")}
      {field("pf")}
    </div>
    {!outcome.result && !outcome.note ? <p className="text-xs text-muted-foreground" data-testid="three-phase-example">Exempel: U = 400 V och I = 16 A ger P ≈ 11,1 kW.</p> : null}
    <div className="flex items-center justify-between gap-3">
      <p role="status" aria-live="polite" className={cn("min-w-0 text-sm", outcome.note ? "text-destructive" : outcome.text ? "font-semibold" : "text-muted-foreground")} data-testid="three-phase-result">
        {outcome.note ?? (outcome.result && outcome.text ? `${THREE_PHASE_LABEL[outcome.result]} = ${outcome.text}` : "Fyll i två av P, U och I.")}
      </p>
      <Button type="button" variant="outline" onClick={() => setState(resetThreePhase())} data-testid="three-phase-reset"><RotateCcw />Återställ</Button>
    </div>
  </div>;
}
