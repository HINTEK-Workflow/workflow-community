"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Compass, LogOut, Sparkles, X } from "lucide-react";
import { AppShell, type View } from "@/components/app-shell";
import { WorkspaceActionsProvider } from "@/components/workspace-actions";
import { Button } from "@/components/ui/button";
import { Workspace } from "@/features/kfid/workspace";
import { Panel } from "@/features/kfid/ui";
import { personInitials, personSolidTone } from "@/features/workflow/person-tone";
import { cn } from "@/lib/utils";
import { demoCurrentUser, demoDatabase, installDemoBackend, onDemoUserChange, setDemoUser } from "./demo-backend";
import { DEMO_ADMIN_ID, DEMO_COMPANY, type DemoUserId } from "./demo-data";

export const DEMO_EXIT_HREF = "/demo?exit=1";

type TourStep = { view: View; href: string; title: string; text: string; asAdmin?: boolean };
// Guided tour (2026-09-26): Översikt, Mina uppgifter, a project, Planering, Tidrapport and the company page.
const tour: TourStep[] = [
  { view: "stats", href: "/?view=stats", title: "Översikt", text: "Nyckeltalen visar teamets läge den här veckan. Under dem ligger de mest angelägna uppgifterna och projekten – belysningsbytet hos Strömkraft är försenat. Byt användare med Visa som för att se samma arbetsyta som medarbetare eller arbetsledare." },
  { view: "tasks", href: "/?view=tasks", title: "Mina uppgifter", text: "Här ser varje användare sitt eget arbete: arbetsorder, riskbedömningar och kontroller före idrifttagning. Öppna en uppgift för att dokumentera, starta tidtagning eller slutföra med signering." },
  { view: "project", href: "/?view=project&projectId=demo-project-laddplatser", title: "Projekt", text: "Projektet är ramen: tidsram, kund, anläggning, uppgifter av alla tre typerna, planering, tid och beslutslogg. Laddplatserna följer tidsramen – kontrollen stannar på 95 % tills den är slutförd. Revision ställverk S1 ligger efter och Ny elcentral är klar att avsluta." },
  { view: "planning", href: "/?view=planning", title: "Planering", text: "Kalendern visar teamets planerade arbete i färg per person. På onsdag är Elis dubbelbokad med byggmötet – krocken varnar men stoppar inte. Planering utanför projektets tidsram spärras. Dra en aktivitet till en annan dag för att flytta den." },
  { view: "time", href: "/?view=time", title: "Tidrapport", text: "Registrera tid direkt eller med start och paus i uppgiften; kontroller får manuell tid. Min vecka jämför rapporterad tid med veckomålet, och en företagsadministratör ser och kan korrigera teamets tid med kommentar och historik." },
  { view: "customers", href: "/?view=customers&customerId=demo-customer-stromkraft", title: "Kundkort", text: "Kundkortet samlar kundens projekt, alla uppgifter, anläggningar och kontaktuppgifter. Strömkraft har två anläggningar: kontorshuset och ställverket." },
  { view: "administration", href: "/?view=administration", title: "Mitt företag och användare", text: "Företagsadministratören styr användare och deras rättigheter per modul. Elis och Elon har Utföra arbete och Elna Läsa och rapportera. Rundturen är klar – utforska vidare eller avsluta demon.", asAdmin: true },
];

const store = { step: 0 as number | null, listeners: new Set<() => void>() };
const setTourStep = (step: number | null) => { store.step = step; store.listeners.forEach((listener) => listener()); };
const subscribeTour = (listener: () => void) => { store.listeners.add(listener); return () => { store.listeners.delete(listener); }; };
const useTourStep = () => useSyncExternalStore(subscribeTour, () => store.step, () => null);
const useDemoUser = () => useSyncExternalStore(onDemoUserChange, () => demoCurrentUser().id, () => DEMO_ADMIN_ID);

function exitDemo() {
  // A full navigation lets the route clear the demo cookie and drops the in-memory demo data.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- /demo is a route handler, not a page.
  window.location.assign(DEMO_EXIT_HREF);
}

function DemoBar({ onUser }: { onUser: (id: DemoUserId) => void }) {
  const userId = useDemoUser();
  const step = useTourStep();
  const users = demoDatabase().users;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-primary/20 bg-secondary px-4 py-3" role="region" aria-label="Demo">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Sparkles className="size-4" /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Demo · {DEMO_COMPANY}</p>
          <p className="text-xs text-muted-foreground">Påhittade uppgifter. Inget sparas och inga mejl skickas – allt nollställs när sidan laddas om.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-full border bg-card p-1" role="group" aria-label="Visa som">
          <span className="hidden px-2 text-xs text-muted-foreground sm:inline">Visa som</span>
          {users.map((user) => {
            return (
              <Button key={user.id} type="button" size="sm" variant={userId === user.id ? "default" : "ghost"} className="h-7 gap-1.5 rounded-full px-2.5" aria-pressed={userId === user.id} title={user.title} onClick={() => onUser(user.id)}>
                <span className={cn("flex size-5 items-center justify-center rounded-full text-[0.625rem] font-semibold text-white", personSolidTone(user.id))} aria-hidden="true">{personInitials(user.name)}</span>
                {user.name.split(" ")[0]}
                <span className="sr-only">, {user.title.toLocaleLowerCase("sv-SE")}</span>
              </Button>
            );
          })}
        </div>
        {step === null ? <Button type="button" size="sm" variant="outline" onClick={() => setTourStep(0)}><Compass />Rundtur</Button> : null}
        <Button type="button" size="sm" variant="ghost" onClick={exitDemo}><LogOut />Avsluta demon</Button>
      </div>
    </div>
  );
}

function TourCard({ onGo }: { onGo: (step: TourStep) => void }) {
  const step = useTourStep();
  if (step === null) return null;
  const current = tour[step];
  const last = step === tour.length - 1;
  return (
    <section aria-labelledby="demo-tour-title" className="fixed inset-x-3 bottom-24 z-40 rounded-xl border bg-card p-4 shadow-lg sm:inset-x-auto sm:right-6 sm:w-96 lg:bottom-6" data-testid="demo-tour">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-primary">Rundtur · steg {step + 1} av {tour.length}</p>
          <h2 id="demo-tour-title" className="mt-0.5 text-base font-semibold">{current.title}</h2>
        </div>
        <Button type="button" size="icon" variant="ghost" className="size-8" aria-label="Hoppa över rundturen" onClick={() => setTourStep(null)}><X /></Button>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{current.text}</p>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${((step + 1) / tour.length) * 100}%` }} /></div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setTourStep(null)}>Hoppa över</Button>
        <div className="flex gap-2">
          {step > 0 ? <Button type="button" size="sm" variant="outline" onClick={() => { setTourStep(step - 1); onGo(tour[step - 1]); }}><ArrowLeft />Föregående</Button> : null}
          {last
            ? <Button type="button" size="sm" onClick={() => setTourStep(null)}>Klar</Button>
            : <Button type="button" size="sm" onClick={() => { setTourStep(step + 1); onGo(tour[step + 1]); }}>Nästa<ArrowRight /></Button>}
        </div>
      </div>
    </section>
  );
}

/**
 * The public demo: the real Cloud workspace rendered against the in-browser demo backend, with "Visa som"
 * for the four invented users and a guided tour. No login, identity, server storage or e-mail is involved.
 */
export function DemoApp({ view, controlId, customerId, projectId, taskId, taskType, timeTaskId }: {
  view: View; controlId?: string; customerId?: string; projectId?: string; taskId?: string; taskType?: string; timeTaskId?: string;
}) {
  const router = useRouter();
  const [blocked, setBlocked] = useState(false);
  // Installed during render so that the first requests from child effects already go to the demo backend.
  installDemoBackend(() => setBlocked(true));
  const userId = useDemoUser();
  const user = demoDatabase().users.find((item) => item.id === userId)!;
  const admin = user.role === "ADMIN";
  useEffect(() => { if (!blocked) return; const timer = setTimeout(() => setBlocked(false), 6000); return () => clearTimeout(timer); }, [blocked]);
  const shellUser = { name: user.name, email: user.email, role: "USER", memberRole: user.role, workflowPermissions: user.permissions, organizationName: DEMO_COMPANY };
  const switchUser = (id: DemoUserId) => {
    setDemoUser(id);
    if (view === "administration" && demoDatabase().users.find((item) => item.id === id)?.role !== "ADMIN") router.push("/?view=stats");
  };
  const go = (step: TourStep) => {
    if (step.asAdmin && !admin) setDemoUser(DEMO_ADMIN_ID);
    router.push(step.href);
  };
  return (
    <WorkspaceActionsProvider>
      <AppShell user={shellUser} view={view} branding={{ companyName: DEMO_COMPANY, isHintek: false, logoUrl: null }} demo={{ onExit: exitDemo }}>
        <DemoBar onUser={switchUser} />
        {blocked ? <p role="status" className="notice mb-4">Rapporter och filer skapas inte i demon. I Workflow laddas de ned som PDF.</p> : null}
        {view === "administration" && !admin
          ? <Panel title="Endast för företagsadministratör"><p className="text-sm text-muted-foreground">Byt till Elin med Visa som för att se företagssidan.</p></Panel>
          : <Workspace key={userId} user={shellUser} view={view} controlId={controlId} customerId={customerId} projectId={projectId} taskId={taskId} taskType={taskType} timeTaskId={timeTaskId} />}
        <TourCard onGo={go} />
      </AppShell>
    </WorkspaceActionsProvider>
  );
}
