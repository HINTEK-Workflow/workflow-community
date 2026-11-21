"use client";

import { BellRing, Compass, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/features/kfid/ui";
import { tripDemoAlarmHere } from "./hub";

/** The id of the alarms on the Demo page, which the phone's start scrolls to. */
export const DEMO_ALARMS_ID = "demo-machine-alarms";
/** The phone's line about the two windows that need a computer (2026-11-16). */
export const PHONE_COMPUTER_TEXT = "PLC-simulatorn och operatörsfönstret fungerar bäst på en dator.";

/**
 * The Demo page's start on a phone (2026-11-16: "Den som besöker med mobilen får ju eventuellt en liten sämre upplevelse"):
 * the tour as the main way in, an alarm that becomes a work order on this same screen, and one line about what needs a computer.
 * A computer keeps the three windows of Börja här.
 */
export function DemoPhoneStart({ touring, onTour }: { touring: boolean; onTour: () => void }) {
  const showAlarm = () => {
    tripDemoAlarmHere();
    // After the alarm row is drawn.
    window.setTimeout(() => document.getElementById(DEMO_ALARMS_ID)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  return <Panel icon={Smartphone} title="Börja här" description="Två sätt att prova i mobilen.">
    <div className="grid gap-2" data-testid="demo-phone-start">
      <Button type="button" className="h-auto min-h-11 justify-start py-2" disabled={touring} onClick={onTour} data-testid="demo-phone-tour"><Compass />Ta rundturen</Button>
      <Button type="button" variant="outline" className="h-auto min-h-11 justify-start py-2 text-left" onClick={showAlarm} data-testid="demo-phone-alarm"><BellRing />Se ett larm bli en arbetsorder</Button>
      <p className="text-xs leading-5 text-muted-foreground" data-testid="demo-phone-computer">{PHONE_COMPUTER_TEXT}</p>
    </div>
  </Panel>;
}
