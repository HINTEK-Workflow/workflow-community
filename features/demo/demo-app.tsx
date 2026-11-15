"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Home, Info, X } from "lucide-react";
import { ListGroup, ListRow, NativeActions, NativePage } from "@/components/native";
import { AppShell, type View } from "@/components/app-shell";
import { WorkspaceActionsProvider } from "@/components/workspace-actions";
import { Button } from "@/components/ui/button";
import { Workspace } from "@/features/kfid/workspace";
import { Panel } from "@/features/kfid/ui";
import { PageHeader } from "@/components/page-shell";
import { nativeHidesView } from "@/lib/workflow/native-mode";
import { VIEW_LABEL } from "@/lib/workflow/navigation";
import { DEMO_REPORTS_UNAVAILABLE, demoCurrentUser, demoDatabase, installDemoBackend, onDemoUserChange, sendDemoEvent, setDemoReporting, setDemoUser } from "./demo-backend";
import { demoTimeKey, demoViewKey } from "@/lib/analytics/catalog";
import { announce } from "@/lib/workflow/toast";
import { useDetailLevel, useNativeMode } from "@/features/workflow/use-detail-level";
import { DEMO_ADMIN_ID, DEMO_COMPANY, type DemoUserId } from "./demo-data";
import { IconButton } from "@/components/ui/icon-button";
import { DEMO_PAGE_HREF } from "@/lib/demo";
import { installDemoMachineHub } from "./machine/hub";
import { DemoPage } from "./demo-page";
import { useTaskNotificationFeed } from "@/features/workflow/task-notifications";
import { effectiveWorkProfile, readWorkProfile } from "@/lib/workflow/work-profile";

export const DEMO_EXIT_HREF = "/demo?exit=1";

/** The profile the demo's person has, in the form the shell gets on a real page (app/page.tsx). The rights are the demo user's own, unchanged. */
function demoWorkProfile(permissions: unknown) {
  const admin = { profile: readWorkProfile(permissions), view: null };
  return { admin, effective: effectiveWorkProfile(admin, null) };
}

type TourStep = { view: View; href: string; title: string; text: string; asAdmin?: boolean };
// Guided tour (2026-09-26): Översikt, Uppgifter, a project, Planering's Kalender, Tid and the company page (names as the menu, 2026-10-23).
const tour: TourStep[] = [
  { view: "stats", href: "/?view=stats", title: "Översikt", text: "Nyckeltalen visar hur teamet ligger till den här veckan. Under dem finns de mest brådskande uppgifterna och projekten. Belysningsbytet hos Strömkraft är förfallet. Byt person under Visa som på sidan Demo för att se arbetsytan som medarbetare eller arbetsledare." },
  { view: "tasks", href: "/?view=tasks", title: "Uppgifter", text: "Här ser var och en sitt eget arbete: arbetsordrar, riskbedömningar och kontroller före idrifttagning. Öppna en uppgift för att dokumentera, ta tid eller signera och slutföra den." },
  { view: "project", href: "/?view=project&projectId=demo-project-laddplatser", title: "Projekt", text: "Projektet håller ihop allt: tidsram, kund, anläggning, uppgifter av alla tre typer, planering, tid och beslutslogg. Laddplatserna följer tidsramen. Kontrollen står på 95 % tills den är slutförd. Revision ställverk S1 ligger efter, och Ny elcentral är klar att avsluta." },
  { view: "planning", href: "/?view=planning", title: "Planering", text: "Kalendern under Planering visar teamets planerade arbete, med en färg per person. På onsdag är Elis dubbelbokad med byggmötet. Krocken ger en varning men stoppar inget, och den syns både i kalendern och under Kapacitet. Det går inte att planera utanför projektets tidsram. Dra en aktivitet till en annan dag för att flytta den." },
  { view: "time", href: "/?view=time", title: "Tid", text: "Registrera tid direkt, eller med start och paus i uppgiften. För kontroller fylls tiden i för hand. Min vecka jämför den rapporterade tiden med veckomålet. En företagsadministratör ser teamets tid och kan rätta den med kommentar och historik." },
  { view: "customers", href: "/?view=customers&customerId=demo-customer-stromkraft", title: "Kundkort", text: "Kundkortet samlar kundens projekt, uppgifter, anläggningar och kontaktuppgifter. Strömkraft har två anläggningar: kontorshuset och ställverket." },
  { view: "administration", href: "/?view=administration", title: "Användare", text: "Företagsadministratören styr användarna och deras behörigheter per modul. Elis och Elon har Utföra arbete, och Elna har Läsa och rapportera med Teamet. Rundturen är klar. Utforska vidare eller avsluta demon.", asAdmin: true },
];

// One thing at a time (2026-10-07: the demo opened with four layers at once): the tour only when the visitor starts it from
// Rundtur on the Demo page.
const store = { step: null as number | null, listeners: new Set<() => void>() };
const setTourStep = (step: number | null) => {
  store.step = step;
  store.listeners.forEach((listener) => listener());
};
const subscribeTour = (listener: () => void) => { store.listeners.add(listener); return () => { store.listeners.delete(listener); }; };
const useTourStep = () => useSyncExternalStore(subscribeTour, () => store.step, () => null);
const useDemoUser = () => useSyncExternalStore(onDemoUserChange, () => demoCurrentUser().id, () => DEMO_ADMIN_ID);

// Approximate time in the demo (Beteendeanalys, 2026-11-04): one of four buckets, sent once when the visit ends. The clock is a
// number in memory for this page load only; nothing is stored and the exact time is never sent.
const visit = { startedAt: typeof performance === "undefined" ? 0 : performance.now(), reported: false };
function reportTime() {
  if (visit.reported) return;
  visit.reported = true;
  sendDemoEvent(demoTimeKey((performance.now() - visit.startedAt) / 1000));
}

function exitDemo() {
  sendDemoEvent("flow_exit");
  reportTime();
  // A full navigation lets the route clear the demo cookie and drops the in-memory demo data. Inside the app column's
  // frame (plan 1P) the whole window leaves, not only the frame.
  (window.parent !== window ? window.parent : window).location.assign(DEMO_EXIT_HREF);
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
        <IconButton label="Hoppa över rundturen" onClick={() => setTourStep(null)}><X /></IconButton>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{current.text}</p>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${((step + 1) / tour.length) * 100}%` }} /></div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setTourStep(null)}>Hoppa över</Button>
        <div className="flex gap-2">
          {step > 0 ? <Button type="button" size="sm" variant="outline" onClick={() => { setTourStep(step - 1); onGo(tour[step - 1]); }}><ArrowLeft />Föregående</Button> : null}
          {last
            ? <Button type="button" size="sm" onClick={() => { sendDemoEvent("flow_tour_done"); setTourStep(null); }}>Klar</Button>
            : <Button type="button" size="sm" onClick={() => { setTourStep(step + 1); onGo(tour[step + 1]); }}>Nästa</Button>}
        </div>
      </div>
    </section>
  );
}

/**
 * A page the demo does not have keeps its address and says so, with the way back (2026-10-10: it fell back to Översikt in
 * silence while the address stayed).
 */
function NotInDemo({ view }: { view: View }) {
  const title = VIEW_LABEL[view as keyof typeof VIEW_LABEL] ?? "Sidan";
  const native = useNativeMode();
  // Level 1 (audit 2026-10-12): the top bar names the page; one list row says why, and Hem is the way back.
  if (native) return <NativePage testId="demo-unavailable">
    <ListGroup footer="Demon har påhittade uppgifter i webbläsaren. Den här sidan behöver ett riktigt konto och en server.">
      <ListRow type="neutral" icon={Info} title={`${title} finns inte i demon`} chevron={false} wrap />
    </ListGroup>
    <NativeActions><Link href="/?view=stats" data-testid="demo-unavailable-home"><Home />Hem</Link></NativeActions>
  </NativePage>;
  return <div data-testid="demo-unavailable">
    <PageHeader title={title} />
    <Panel title="Inte i demon">
      <p className="text-sm leading-6 text-muted-foreground">{title} går inte att prova i demon. Demon har påhittade uppgifter i webbläsaren, och den här sidan behöver ett riktigt konto och en server.</p>
      <div className="mt-4 flex flex-wrap gap-3"><Button asChild><Link href="/?view=stats">Till Översikt</Link></Button></div>
    </Panel>
  </div>;
}

/**
 * The public demo: the real Cloud workspace rendered against the in-browser demo backend, with "Visa som"
 * for the four invented users and a guided tour. No login, identity, server storage or e-mail is involved.
 */
export function DemoApp({ view, unavailable = false, report = false, customerId, projectId, taskId, taskType, timeTaskId }: {
  /** Report the visit (which pages, how long) as anonymous numbers; false where the installation cannot count them. */
  report?: boolean;
  view: View; customerId?: string; projectId?: string; taskId?: string; taskType?: string; timeTaskId?: string;
  /** A page of Workflow that the demo does not have (Import, Workflow AI, Abonnemang …): it says so. */
  unavailable?: boolean;
}) {
  const router = useRouter();
  // Installed during render so that the first requests from child effects already go to the demo backend. A report or
  // file the person asks for says it is not made in the demo as a toast, where they are (2026-10-10).
  installDemoBackend(() => announce(DEMO_REPORTS_UNAVAILABLE));
  // The window the simulator's Demokoppling talks to. Alive on every page of the demo, so an alarm arrives wherever the visitor is.
  useEffect(() => { installDemoMachineHub(); }, []);
  setDemoReporting(report);
  const userId = useDemoUser();
  const tourStep = useTourStep();
  const native = useNativeMode();
  const content = useDetailLevel();
  const searchParams = useSearchParams();
  const user = demoDatabase().users.find((item) => item.id === userId)!;
  const admin = user.role === "ADMIN";
  // Stable between renders: the workspace reads again whenever its user object changes, so a new object on every address
  // change (a page opened over the page, a tab) would reload it and drop what is open.
  const shellUser = useMemo(() => ({ id: user.id, name: user.name, email: user.email, role: "USER", memberRole: user.role, workflowPermissions: user.permissions, organizationName: DEMO_COMPANY, invoicingOn: true, workProfile: demoWorkProfile(user.permissions) }), [user]);
  // Which page is shown, and the time when the visit ends (the page is hidden or left).
  useEffect(() => { sendDemoEvent(demoViewKey(view)); }, [view]);
  useEffect(() => {
    const leave = () => { if (document.visibilityState === "hidden") reportTime(); };
    document.addEventListener("visibilitychange", leave);
    window.addEventListener("pagehide", reportTime);
    return () => { document.removeEventListener("visibilitychange", leave); window.removeEventListener("pagehide", reportTime); };
  }, []);
  const switchUser = (id: DemoUserId) => {
    sendDemoEvent("flow_user_switch");
    setDemoUser(id);
  };
  const startTour = () => {
    sendDemoEvent("flow_tour_start");
    setTourStep(0);
    router.push(tour[0].href);
  };
  const go = (step: TourStep) => {
    if (step.asAdmin && !admin) setDemoUser(DEMO_ADMIN_ID);
    router.push(step.href);
  };
  return (
    <WorkspaceActionsProvider>
      <AppShell user={shellUser} view={view} branding={{ companyName: DEMO_COMPANY, isHintek: false, logoUrl: null }} demo={{ onExit: exitDemo }}>
        {/* At level 1 a page made for a larger screen says it is in display level 2 first, as in Workflow. */}
        {view === "demo" ? <><DemoBellFeed resetKey={userId} /><DemoPage userId={userId} touring={tourStep !== null} onUser={switchUser} onTour={startTour} onExit={exitDemo} /></>
          : unavailable && !nativeHidesView(native, content, view, searchParams) ? <NotInDemo view={view} />
          : (view === "administration" || view === "operator_accounts" || view === "company" || view === "company_features") && !admin
          ? <Panel title="Bara för företagsadministratören"><p className="text-sm text-muted-foreground">Byt till Elin under <Link href={DEMO_PAGE_HREF} className="underline underline-offset-2">Demo</Link> för att se företagssidan.</p></Panel>
          : <Workspace key={userId} demo user={shellUser} view={view} customerId={customerId} projectId={projectId} taskId={taskId} taskType={taskType} timeTaskId={timeTaskId} />}
        <TourCard onGo={go} />
      </AppShell>
    </WorkspaceActionsProvider>
  );
}

/** The Demo page is drawn outside the workspace, so the bell reads its notices here; otherwise it shows no figure until another page opens. */
function DemoBellFeed({ resetKey }: { resetKey: string }) {
  useTaskNotificationFeed({ enabled: true, resetKey });
  return null;
}
