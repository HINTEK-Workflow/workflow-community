"use client";

import { type MouseEvent, useSyncExternalStore } from "react";
import Link from "next/link";
import { ClipboardList, Cpu, type LucideIcon, MonitorSmartphone } from "lucide-react";
import { DEMO_MACHINE_HREF, DEMO_OPERATOR_HREF, DEMO_START_ITEMS, DEMO_START_STEPS, type DemoStartKey, demoSimulatorHref } from "@/lib/demo";
import { demoMachineSnapshot, subscribeDemoMachine } from "./hub";
import { PHONE_SIMULATOR_TEXT, usePhoneScreen } from "./use-phone-screen";

// The three ways in on the Demo page and the order they go in (2026-11-04; on the Demo page since 2026-11-05, so Översikt is the real one).

const ICONS: Record<DemoStartKey, LucideIcon> = { workflow: ClipboardList, simulator: Cpu, operator: MonitorSmartphone };
const ITEM = "flex min-w-0 items-start gap-3 rounded-lg border bg-background p-3 transition-colors hover:bg-accent";

function Body({ item }: { item: { key: DemoStartKey; title: string; line: string } }) {
  const Icon = ICONS[item.key];
  return <>
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Icon aria-hidden="true" className="size-4" /></span>
    <span className="min-w-0"><span className="block text-sm font-semibold">{item.title}</span><span className="block text-xs leading-5 text-muted-foreground">{item.line}</span></span>
  </>;
}

export function DemoStartCard() {
  const { session } = useSyncExternalStore(subscribeDemoMachine, demoMachineSnapshot, demoMachineSnapshot);
  const windowed = (href: string) => (event: MouseEvent) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    window.open(href, "_blank", "noopener,popup,width=1360,height=900");
  };
  const simulatorHref = demoSimulatorHref(session);
  const phone = usePhoneScreen();
  return <div data-testid="demo-start">
    <div className="@container/start">
      <div className="grid gap-2 @2xl/start:grid-cols-3">
        {DEMO_START_ITEMS.map((item) => item.key === "workflow"
          ? <Link key={item.key} href={DEMO_MACHINE_HREF} className={ITEM} data-testid="demo-start-workflow"><Body item={item} /></Link>
          : phone && item.key === "simulator" ? <div key={item.key} className={`${ITEM} opacity-80 hover:bg-background`} data-testid="demo-start-simulator-phone"><Body item={{ ...item, line: PHONE_SIMULATOR_TEXT }} /></div>
          : <a key={item.key} href={item.key === "simulator" ? simulatorHref : DEMO_OPERATOR_HREF} target="_blank" rel="noopener" onClick={windowed(item.key === "simulator" ? simulatorHref : DEMO_OPERATOR_HREF)} className={ITEM} data-testid={`demo-start-${item.key}`}><Body item={item} /></a>)}
      </div>
      <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="demo-start-steps">
        {DEMO_START_STEPS.map((step, index) => <li key={step}><span className="font-semibold text-foreground">{index + 1}</span> {step}</li>)}
      </ol>
    </div>
  </div>;
}
