"use client";

import { DEMO_OPERATOR_COMPANY, DEMO_OPERATOR_HINT, demoOperatorApi } from "@/features/demo/demo-operator";
import { DemoConnectedOperator } from "@/features/demo/machine/operator-terminal";
import { OperatorApp } from "./operator-app";

/** /operator/demo: the operator page with invented accounts, answered in this browser only (features/demo/demo-operator.ts). */
export function DemoOperatorApp({ machine, niva, connected = false }: { machine: string | null; niva: string | null; /** Demokopplingen: the terminal of the demo machine, in touch with the demo's Workflow window. */ connected?: boolean }) {
  if (connected) return <DemoConnectedOperator machine={machine} niva={niva} />;
  return <OperatorApp pageKey="demo" company={DEMO_OPERATOR_COMPANY} initial={null} microsoft={false} error="" machine={machine} niva={niva} api={demoOperatorApi} demoHint={DEMO_OPERATOR_HINT} />;
}
