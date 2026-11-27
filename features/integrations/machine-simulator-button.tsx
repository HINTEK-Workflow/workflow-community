"use client";

import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

// Only the address, so nothing of the simulator comes along in this panel's chunk.
const SIMULATOR_HREF = "/plc-simulator";

/**
 * PLC-simulatorn (2026-11-02) opens in a window of its own and cannot touch this one: noopener leaves it no handle
 * back, and two clicks give two independent PLCs. A real link, so that a middle click or a blocked popup still gets there.
 */
export function MachineSimulatorButton() {
  return <Button asChild variant="outline" size="sm">
    <a href={SIMULATOR_HREF} target="_blank" rel="noopener" data-testid="machine-simulator-open" onClick={(event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      window.open(SIMULATOR_HREF, "_blank", "noopener,popup,width=1360,height=900");
    }}><ExternalLink aria-hidden="true" />Simulator</a>
  </Button>;
}
