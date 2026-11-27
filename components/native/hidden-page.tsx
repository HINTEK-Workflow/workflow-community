"use client";

import { MonitorSmartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListGroup, ListRow, NativePage } from "./list";

/**
 * A heavy desktop page opened at level 1 (2026-10-09: level 1 is for field work). The page is not drawn; it is one
 * choice away. On a phone, which always shows the app (A2, 2026-10-22), "Visa sidan" turns on Visa mer for the page and
 * the page is drawn in the app (`phone`); in the app column of a tablet or a computer "Byt visning" switches the device to
 * display level 2. Display only: the person's rights are the same, and the server decides every call.
 */
export function NativeHiddenPage({ title, onSwitch, busy = false, phone = false }: { title: string; onSwitch: () => void; busy?: boolean; phone?: boolean }) {
  return <NativePage testId="native-hidden-page">
    {/* The top bar names the page (M1); no large title repeats it. */}
    {phone ? <ListGroup>
      <ListRow type="neutral" icon={MonitorSmartphone} title="Sidan är gjord för en större skärm" subtitle="Den går att öppna här också" chevron={false} wrap />
    </ListGroup> : <ListGroup footer="Sidan finns i visning 2 (Lagom). Byt under Mer → Visning.">
      <ListRow type="neutral" icon={MonitorSmartphone} title={`${title} finns i visning 2`} subtitle="Byt visning för att öppna den här" chevron={false} wrap />
    </ListGroup>}
    <div className="px-1 pt-4">
      <Button type="button" size="lg" className="w-full" onClick={onSwitch} data-testid="native-hidden-switch" busy={busy} busyLabel="Byter…">{phone ? "Visa sidan" : "Byt visning"}</Button>
    </div>
  </NativePage>;
}
