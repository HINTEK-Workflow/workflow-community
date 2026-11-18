"use client";

import { Compass, LogOut, Users } from "lucide-react";
import { PageHeader } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Panel } from "@/features/kfid/ui";
import { personInitials, personSolidTone } from "@/features/workflow/person-tone";
import { demoVersionText } from "@/lib/demo";
import { currentAppVersion } from "@/lib/release-notes";
import { cn } from "@/lib/utils";
import { demoDatabase } from "./demo-backend";
import { DEMO_COMPANY, type DemoUserId } from "./demo-data";
import { DemoMachinePage } from "./machine/machine-page";
import { DemoPhoneStart } from "./machine/phone-start";
import { DemoStartCard } from "./machine/start-card";
import { usePhoneScreen } from "./machine/use-phone-screen";
import { InstallApp } from "@/features/workflow/install-app";

// The Demo page (2026-11-05: "där görs alla val och information och koppling mot PLC osv så inte översikt sidan förstörs"):
// what the visit is, who it is seen as, the three windows and the machine connection. Every other page of the demo looks as in a real company.
// A phone (2026-11-16) starts with its own short start and a compact Visa som after it; a computer's layout is unchanged.
export function DemoPage({ userId, touring, onUser, onTour, onExit }: { userId: string; touring: boolean; onUser: (id: DemoUserId) => void; onTour: () => void; onExit: () => void }) {
  const phone = usePhoneScreen();
  const users = <Panel icon={Users} title="Visa som" description="Byt person för att se vad varje roll ser.">
    <div className="flex flex-wrap gap-2" role="group" aria-label="Visa som" data-testid="demo-users">
      {demoDatabase().users.map((user) => <Button key={user.id} type="button" variant={userId === user.id ? "default" : "outline"} size={phone ? "sm" : undefined} className={cn("h-auto justify-start gap-2 text-left", phone ? "min-h-10 py-1" : "min-h-11 py-1.5")} aria-pressed={userId === user.id} title={phone ? `${user.name}, ${user.title}` : undefined} onClick={() => onUser(user.id)}>
        <span className={cn("flex shrink-0 items-center justify-center rounded-full font-semibold text-white", phone ? "size-6 text-[0.65rem]" : "size-7 text-xs", personSolidTone(user.id))} aria-hidden="true">{personInitials(user.name)}</span>
        <span className="min-w-0"><span className="block font-medium">{phone ? user.name.split(" ")[0] : user.name}</span>{phone ? null : <span className="block text-xs font-normal opacity-80">{user.title}</span>}</span>
      </Button>)}
    </div>
  </Panel>;
  return <div className="space-y-6" data-testid="demo-page">
    <PageHeader title="Demo" actions={<>
        {phone ? null : <Button type="button" disabled={touring} onClick={onTour} data-testid="demo-tour-start"><Compass />Rundtur</Button>}
        <Button type="button" variant="outline" onClick={onExit} data-testid="demo-exit"><LogOut />Avsluta demon</Button>
      </>} />
    {/* Under the heading instead of as its description: a phone hides a page's description, and this has to be read there too. */}
    <p className="text-sm leading-6 text-muted-foreground" data-testid="demo-info">{DEMO_COMPANY}. {/* The side menu says the rest from 1024 px (resa 5, 2026-11-06: the same text three times); a phone has no side menu. */}<span className="lg:hidden">Påhittade uppgifter. Inget sparas, och allt nollställs när sidan laddas om. </span>Ingen e-post skickas. <span data-testid="demo-version">{demoVersionText(currentAppVersion())}.</span></p>
    {phone ? <>
      <DemoPhoneStart touring={touring} onTour={onTour} />
      {users}
    </> : <>
      {users}
      <Panel icon={Compass} title="Börja här" description="Tre fönster som hör ihop. Följ stegen i ordning.">
        <DemoStartCard />
      </Panel>
    </>}
    {/* A phone or tablet opened through an ad (2026-11-08): the way to put the demo on the home screen, said for that device. */}
    <div className="md:hidden" data-testid="demo-install"><InstallApp /></div>
    <DemoMachinePage canOpenEvents={demoDatabase().users.find((user) => user.id === userId)?.role === "ADMIN"} />
  </div>;
}
