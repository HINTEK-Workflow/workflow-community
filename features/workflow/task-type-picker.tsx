"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useVisitHistory } from "@/components/history-nav";
import { useEffect, useState, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ChevronLeft, ChevronRight, ClipboardList, Eye, EyeOff, FilePlus2, GripVertical, RotateCcw, Scale, Search, SlidersHorizontal, Star, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { FAVORITES, arrangeTaskCards, emptyTaskCardLayout, firstFreeSlot, moveCardToSlot, placeTaskCards, saveableTaskCardLayout, slotId, slotsOfPlacement, type TaskCardLayout } from "@/lib/workflow/task-card-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-shell";
import { api } from "@/features/kfid/api";
import { useReturnTo } from "@/features/kfid/use-return-to";
import { companyValuesHref } from "@/lib/workflow/company-values-view";
import { WORKFLOW_TASK_TYPES } from "./task-types";
import { indicatorBadge } from "./indicator-tone";
import { CardFoot, FormTypeCardContent, type FormCardData } from "./form-card";
import { FormShareActions } from "./form-share-actions";
import { FORM_CATEGORIES, formCategory, formCategoryLabel } from "@/lib/workflow/form-publish";
import { formPermissionArea, hasWorkflowPermission, normalizeWorkflowPermissionProfile, workflowSubjectForTask, type WorkflowPermissionProfile } from "@/lib/workflow/permissions";
import { TASK_TYPE_OF_ORIGINAL } from "@/lib/workflow/builtin-originals";
import { useRiskLevels } from "@/features/self-inspection/work";
import { RiskClassDialog } from "@/features/self-inspection/risk-class-setting";
import { announce } from "@/lib/workflow/toast";
import { linkedTaskNotice } from "@/lib/workflow/new-choices";
import { effectiveRiskClass, formRiskKey, proposedRiskClass, type RiskClass } from "@/lib/self-inspection/levels";
import { ListEmpty, ListGroup, ListRow, NativeLargeTitle, NativePage, NativeSearch, ShowMoreMarker, useNativeTopBar } from "@/components/native";
import { useNativeMode, useNativeReduced } from "./use-detail-level";
import { IconButton } from "@/components/ui/icon-button";

type PublishedForm = { risk?: FormCardData["risk"]; onRiskClass?: () => void; id: string; version: number; name: string; description: string; color: string; icon: string; category: string; allowStandalone: boolean; allowInProject: boolean; publisher?: string; own?: boolean; baseId?: string | null; area?: string; origin?: "original" | "companyVersion"; hintek?: boolean; source?: string; author?: string; /** How many limits the form declares. */ limits?: number };
// Workflow's built-in inspection types first, in the order an electrician meets them (2026-09-26).
const BUILTIN_ORDER = ["hintek-kontroll-fore-idrifttagning", "hintek-termografering", "hintek-fortlopande-kontroll", "hintek-isolationsmatning-ebr", "hintek-foljelinematning-ebr", "hintek-driftrond-vattenkraft", "hintek-reservkraft", "hintek-pumpstation", "hintek-riskbedomning", "hintek-skyddsrond"];
/** Search and category filter appear once the library has more cards than fit at a glance (2026-09-28). */
const SEARCH_FROM = 7;
const plain = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const builtinOrder = (id: string) => { const index = BUILTIN_ORDER.indexOf(id); return index < 0 ? BUILTIN_ORDER.length : index; };
const categoryOrder = (category: string) => { const index = FORM_CATEGORIES.findIndex(([value]) => value === category); return index < 0 ? FORM_CATEGORIES.length : index; };

const cardClass = "group relative flex min-h-52 flex-col rounded-lg border bg-card p-5 transition-colors hover:border-[var(--workflow-card-border-hover)] hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function TaskTypePicker({ projectId, customerId, permissions, admin = false, superadmin = false, canBuildForms = superadmin, canEditValues = false, riskLevels = true, layout = emptyTaskCardLayout, onLayoutChange }: { projectId?: string; customerId?: string; permissions?: WorkflowPermissionProfile; admin?: boolean; superadmin?: boolean; canBuildForms?: boolean;
/** Whoever may enter the company's values (Värden och referenser) gets the shortcut on a card. */ canEditValues?: boolean; /** Read the server's roles and risk classes; off in Local, whose programme lives in its file (2026-10-07: a 409 in the console). */ riskLevels?: boolean; layout?: TaskCardLayout; onLayoutChange?: (layout: TaskCardLayout) => Promise<void> }) {
  const searchParams = useSearchParams();
  // Nivå 1 på mobil (2026-10-09): the types as a list of rows with search; Anpassa, Export and Import are desktop tools.
  // On a phone Visa mer draws the ordinary page with them in the app (A2); the top bar stays the app's.
  const native = useNativeMode();
  const reduced = useNativeReduced();
  // Level 1 (audit 2026-10-12): a choice page to leave, so Avbryt in the top bar (never asks); it goes back where the person came from.
  const router = useRouter();
  const { canBack, back } = useVisitHistory();
  const profile = normalizeWorkflowPermissionProfile(permissions);
  // Arbetsorder has its own menu group (2026-09-26) and is no longer a card here.
  // A form is created with its permission area (2026-09-27): Formulär, or Kontroll före idrifttagning /
  // Riskbedömning for Workflow's originals of those types and a company's own versions of them.
  const canCreateArea = (area?: string) => admin || hasWorkflowPermission(profile, formPermissionArea(area), "create");
  const canCreateForms = canCreateArea("forms") || canCreateArea("kfid") || canCreateArea("risk-assessment");
  // Published forms from Workflow (2026-09-26): each is its own task type under Ny uppgift.
  const [forms, setForms] = useState<PublishedForm[]>([]);
  // Each card carries its risk class (2026-10-07): the company's own, else Workflow's proposal, marked as one.
  const { levels, set: setRiskClass } = useRiskLevels(riskLevels && (canCreateForms || superadmin));
  // The company's admin changes the class from the card's mark.
  const [riskEditing, setRiskEditing] = useState<{ key: string; name: string; current: RiskClass | null; proposal: RiskClass } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  // Anpassa (2026-09-27): move the cards around and choose which are shown; saved per person.
  const [editing, setEditing] = useState(false);
  const [draftSlots, setDraftSlots] = useState<Record<string, string>>({});
  const [draftHidden, setDraftHidden] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // In the app with Visa mer (A2), Anpassa is the ordinary page's: the top bar's Avbryt ends it and Klar saves it, so the
  // page has one Avbryt (it was there twice: the bar's left the page, the header's ended the arranging).
  useNativeTopBar(native ? (editing ? { title: "Ny uppgift", cancel: { onClick: () => setEditing(false) }, save: { label: "Klar", busy: saving, disabled: saving, onClick: () => void finishEditing() } }
    : { title: "Ny uppgift", cancel: { onClick: () => { if (canBack) back(); else router.push("/?view=tasks"); } } }) : null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("ALL");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  useEffect(() => {
    if (!canCreateForms && !superadmin) return;
    let active = true;
    api<{ forms: PublishedForm[] }>("/api/forms").then((result) => { if (active) setForms(result.forms); }).catch(() => { if (active) setForms([]); });
    return () => { active = false; };
  }, [canCreateForms, superadmin]);
  // "Ta bort" unpublishes the form for everyone; protocols, their data and PDFs remain (superadmin only).
  async function unpublish(form: PublishedForm) {
    try {
      await api("/api/forms/admin", { method: "POST", body: JSON.stringify({ action: "unpublish", id: form.id }) });
      setForms((current) => current.filter((item) => item.id !== form.id));
      setNotice(`${form.name} är borttaget från Ny uppgift. Befintliga protokoll finns kvar och kan publiceras igen under Skapa formulär.`);
    } catch (issue) { setNotice((issue as Error).message); } finally { setConfirming(null); }
  }
  // A facility chosen on the customer card follows every card (2026-09-30), like the project and the customer.
  const facilityId = searchParams.get("facilityId");
  const context = `${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}${customerId ? `&customerId=${encodeURIComponent(customerId)}` : ""}${facilityId ? `&facilityId=${encodeURIComponent(facilityId)}` : ""}`;
  // "Ny uppgift till denna arbetsorder" (Fas 2): every card but a new work order carries the order the task belongs to.
  const workOrderId = searchParams.get("workOrderId");
  // Samband (2026-10-26): opened from a page (a work order's Ny uppgift) the way back follows the chosen type, so the
  // new task leads back there; Avbryt goes one step back to it.
  const way = useReturnTo();
  const taskContext = `${context}${workOrderId ? `&workOrderId=${encodeURIComponent(workOrderId)}` : ""}${way ? `&returnTo=${encodeURIComponent(way.returnTo)}` : ""}`;
  // A form that may not be used in a project is not offered from a project (decision 2); sorted by category, then name.
  const shownForms = forms.filter((form) => canCreateArea(form.area) && (!projectId || form.allowInProject !== false))
    .sort((a, b) => builtinOrder(a.baseId ?? a.id) - builtinOrder(b.baseId ?? b.id) || categoryOrder(a.category) - categoryOrder(b.category) || a.name.localeCompare(b.name, "sv"));

  // A published original of a built-in type takes that type's card and place (the switch-over, 2026-09-27).
  // A company's own version wins over Workflow's original when both are published.
  const replacedBy = new Map(shownForms.filter((form) => TASK_TYPE_OF_ORIGINAL[form.baseId ?? form.id]).sort((a, b) => Number(Boolean(a.baseId)) - Number(Boolean(b.baseId))).map((form) => [TASK_TYPE_OF_ORIGINAL[form.baseId ?? form.id], form] as const));
  // The card says what it is (2026-09-28): Workflow's original of a built-in type, or the company's own version of one.
  const origin = (form: PublishedForm): PublishedForm["origin"] => form.baseId ? "companyVersion" : TASK_TYPE_OF_ORIGINAL[form.id] ? "original" : undefined;
  const formCard = (form: PublishedForm, key: string): TaskCard => ({
    key, name: form.name, form: { ...form, origin: origin(form), risk: levels ? effectiveRiskClass({ kind: "FORM", formId: form.baseId ?? form.id, category: form.category, name: form.name }, levels.riskClasses) : null,
      onRiskClass: admin && levels ? () => { const formId = form.baseId ?? form.id; const own = levels.riskClasses[formRiskKey(formId)]; setRiskEditing({ key: formRiskKey(formId), name: form.name, current: own === 1 || own === 2 || own === 3 ? own : null, proposal: proposedRiskClass({ kind: "FORM", formId, category: form.category }) }); } : undefined },
    href: `/?view=workflow_task&taskType=FORM&formId=${encodeURIComponent(form.id)}${taskContext}`,
    content: null,
    linkLabel: "Skapa protokoll",
  });
  // The built-in control and risk assessment exist only as Workflow's originals now (2026-09-28): an unpublished
  // original leaves no card behind – it waits as a draft under Skapa formulär until it is published again or deleted.
  const originalTypes = new Set<string>(Object.values(TASK_TYPE_OF_ORIGINAL));
  const activeTypes = WORKFLOW_TASK_TYPES.filter((item) => item.id !== "WORK_ORDER" && item.available && !originalTypes.has(item.id) && !replacedBy.has(item.id as never) && (admin || hasWorkflowPermission(profile, workflowSubjectForTask(item.id), "create")));

  // Every card the person may create from here, in the default order; the person's own layout arranges them.
  const cards: TaskCard[] = [
    ...[...replacedBy].map(([type, form]) => formCard(form, `type:${type}`)),
    ...activeTypes.map((taskType): TaskCard => ({
      key: `type:${taskType.id}`, name: taskType.label,
      href: taskType.id === "COMMISSIONING_CONTROL" ? `/?view=new${taskContext}` : `/?view=workflow_task&taskType=${taskType.id}${taskContext}`,
      content: <>
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-feature-control-soft text-feature-control"><taskType.icon className="size-5" /></span>
          <Badge variant="outline" className={indicatorBadge("success")}>Inbyggd</Badge>
        </div>
        <h2 className="section-title mt-5 truncate group-hover:text-primary" title={taskType.label} data-card-title="">{taskType.label}</h2>
        <p className="mt-2 line-clamp-3 flex-1 text-sm leading-6 text-muted-foreground" title={taskType.description}>{taskType.description}</p>
      </>,
      linkLabel: "Skapa uppgift",
    })),
    // A company's version of a Workflow original keeps the original's place (2026-09-27).
    ...shownForms.filter((form) => !TASK_TYPE_OF_ORIGINAL[form.baseId ?? form.id]).map((form) => formCard(form, `form:${form.baseId ?? form.id}`)),
  ];
  const arranged = arrangeTaskCards(cards, layout);
  // Free placement (2026-09-29): 3 favourite places, then 6 places per category, in the person's own layout.
  const categoryOf = (card: TaskCard) => card.form ? formCategory(card.form.category) : "OTHER";
  const categoryValues = FORM_CATEGORIES.map(([value]) => value as string);
  const placement = editing
    ? placeTaskCards(cards, { slots: draftSlots }, categoryOf, categoryValues)
    : placeTaskCards(cards, layout, categoryOf, categoryValues);
  const sectionLabel = (section: string) => section === FAVORITES ? "Favoriter" : formCategoryLabel(section);
  function startEditing() {
    setDraftSlots(slotsOfPlacement(placeTaskCards(cards, layout, categoryOf, categoryValues)));
    setDraftHidden(new Set(arranged.hidden.map((card) => card.key)));
    setConfirming(null);
    setEditing(true);
  }
  async function finishEditing() {
    if (!onLayoutChange) { setEditing(false); return; }
    setSaving(true);
    try {
      const keys = placement.flatMap((section) => section.slots.flatMap((card) => card ? [card.key] : []));
      await onLayoutChange(saveableTaskCardLayout(keys, draftHidden, layout, draftSlots));
      setEditing(false);
      setNotice("");
    } catch (issue) { setNotice((issue as Error).message); } finally { setSaving(false); }
  }
  // Every place in the order it is shown, so the arrows move a card one place, also into the next category.
  const allSlots = placement.flatMap(({ section, slots }) => slots.map((_, index) => slotId(section, index)));
  const moveTo = (key: string, target: string | null) => { if (target) setDraftSlots((current) => moveCardToSlot(current, key, target)); };
  const toggleHidden = (key: string) => setDraftHidden((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const onDragEnd = ({ active, over }: DragEndEvent) => { if (over) moveTo(String(active.id), String(over.id)); };
  const canArrange = Boolean(onLayoutChange) && cards.length > 1;
  // The control library (2026-09-28): searchable, and filtered by the section a card is placed in.
  const words = plain(query).split(/\s+/).filter(Boolean);
  const matches = (card: TaskCard, section: string) => (category === "ALL" || category === section)
    && words.every((word) => plain(`${card.name} ${card.form?.description ?? ""} ${formCategoryLabel(categoryOf(card))} ${sectionLabel(section)} ${card.form?.publisher ?? ""}`).includes(word));
  const hiddenKeys = new Set(layout.hidden);
  const visibleSections = placement.map(({ section, slots }) => [section, slots.filter((card): card is TaskCard => card !== null && !hiddenKeys.has(card.key))] as const).filter(([, list]) => list.length);
  const presentCategories = visibleSections.map(([section]) => section);
  const groups = visibleSections.map(([section, list]) => [section, list.filter((card) => matches(card, section))] as const).filter(([, list]) => list.length);
  const shownCards = visibleSections.flatMap(([, list]) => list);

  // Uppgifter får skapas först (2026-10-27, replaces 2026-10-26's "Vilken arbetsorder?" first): Ny uppgift goes
  // straight to the cards; the task is linked to a work order on its own page (Koppla till arbetsorder) before the work
  // starts. Opened from a work order, the cards carry it on.
  if (reduced) {
    const typeDescription = (card: TaskCard) => card.form?.description ?? WORKFLOW_TASK_TYPES.find((item) => `type:${item.id}` === card.key)?.description ?? "";
    return <NativePage testId="native-task-types">
      <ShowMoreMarker when={canArrange || canBuildForms} />
      <NativeLargeTitle inBar>Ny uppgift</NativeLargeTitle>
      {workOrderId ? <p className="notice mb-2 text-sm" data-testid="linked-task-target">{linkedTaskNotice(searchParams.get("workOrderTitle"))}</p> : null}
      {!activeTypes.length && !shownForms.length ? <p className="notice">Du saknar behörighet att skapa uppgifter. En företagsadministratör kan ändra dina behörigheter.</p> : null}
      {notice ? <p role="status" className="notice">{notice}</p> : null}
      {cards.length >= SEARCH_FROM ? <NativeSearch value={query} onChange={setQuery} label="Sök uppgiftstyp" placeholder="Sök uppgiftstyp" /> : null}
      {groups.map(([groupCategory, groupCards], index) => <ListGroup key={groupCategory} title={sectionLabel(groupCategory)} testId="task-category"
        footer={index === groups.length - 1 && !canBuildForms && shownCards.length ? "Saknas en uppgiftstyp? Företagets administratör kan skapa egna formulär. De visas här när de är publicerade och du har behörighet till dem." : undefined}>
        {groupCards.map((card) => <ListRow key={card.key} href={card.href} type={card.form?.area === "risk-assessment" || card.key === "type:RISK_ASSESSMENT" ? "risk" : "control"} title={card.name}
          subtitle={typeDescription(card) || undefined} testId="native-task-type" ariaLabel={`${card.linkLabel}: ${card.name}`} />)}
      </ListGroup>)}
      {groups.length === 0 && shownCards.length ? <ListGroup><ListEmpty>Ingen uppgiftstyp matchar sökningen.</ListEmpty></ListGroup> : null}
    </NativePage>;
  }

  return (
    <div className="space-y-7">
      {/* The shared page header (docs/ui-system.md): on a phone the buttons wrap onto their own row under the title. */}
      <PageHeader title="Ny uppgift"
        description={editing ? "Dra korten eller använd pilarna. Välj vilka kort som visas." : "Välj typ av uppgift. Den läggs i arbetsordern."}
        actions={editing ? <>
          <Button type="button" variant="ghost" disabled={saving} onClick={() => { setDraftSlots(slotsOfPlacement(placeTaskCards(cards, {}, categoryOf, categoryValues))); setDraftHidden(new Set()); }}><RotateCcw />Återställ</Button>
          {native ? null : <>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setEditing(false)}>Avbryt</Button>
            <Button type="button" onClick={() => void finishEditing()} busy={saving} busyLabel="Sparar…">Klar</Button>
          </>}
        </> : canArrange || canBuildForms || way ? <>
          {/* Export and import of forms sit next to Anpassa (2026-09-27), for those who build forms. */}
          {canBuildForms ? <FormShareActions /> : null}
          {canArrange ? <Button type="button" variant="outline" onClick={startEditing}><SlidersHorizontal />Anpassa{arranged.hidden.length ? ` (${arranged.hidden.length} dolda)` : ""}</Button> : null}
          {way && !native ? <Button type="button" variant="outline" onClick={way.cancel} data-testid="task-types-cancel">Avbryt</Button> : null}
        </> : null} />

      {/* Fas 4A: a work order is started from the menu, the project's Nytt jobb or a follow-up, not from here. Opened
          from a work order, the page says where the new task goes. */}
      {workOrderId ? <p className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card px-4 py-3 text-sm" data-testid="linked-task-target">
        <ClipboardList className="size-4 text-feature-control" aria-hidden="true" />
        <span>{linkedTaskNotice(searchParams.get("workOrderTitle"))}</span>
      </p> : null}
      {!activeTypes.length && !shownForms.length && <p className="notice">Du saknar behörighet att skapa uppgifter. En företagsadministratör kan ändra dina behörigheter.</p>}
      {notice ? <p role="status" className="notice">{notice}</p> : null}
      {riskEditing ? <RiskClassDialog name={riskEditing.name} current={riskEditing.current} proposal={riskEditing.proposal} onClose={() => setRiskEditing(null)}
        onSave={async (value) => { await setRiskClass(riskEditing.key, value); announce(value ? "Krävd nivå är sparad." : "Krävd nivå återgick till Workflows förslag."); }} /> : null}
      {!editing && cards.length > 0 && !arranged.visible.length ? <p className="notice">Alla kort är dolda. Välj Anpassa för att visa dem igen.</p> : null}
      {editing ? (
        <DndContext sensors={sensors} collisionDetection={slotCollision} onDragEnd={onDragEnd} accessibility={{ screenReaderInstructions: { draggable: "Mellanslag lyfter kortet, piltangenterna flyttar det, mellanslag släpper det. Escape avbryter." } }}>
          <div className="grid gap-6" role="list" aria-label="Ordna uppgiftstyper">
            {placement.map(({ section, slots }) => <section key={section} role="listitem" aria-label={sectionLabel(section)} className="space-y-3" data-testid="arrange-section" data-section={section}>
              <p role="heading" aria-level={2} className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {section === FAVORITES ? <Star className="size-3.5" aria-hidden="true" /> : null}{sectionLabel(section)}
                <span className="font-normal normal-case tracking-normal">· {slots.filter(Boolean).length} av {slots.length} platser</span>
              </p>
              <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
                {slots.map((card, index) => {
                  const id = slotId(section, index);
                  const at = allSlots.indexOf(id);
                  return <Slot key={id} id={id} label={`${sectionLabel(section)}, plats ${index + 1}`}>
                    {card ? <PlacedCard card={card} hidden={draftHidden.has(card.key)} here={section} first={at === 0} last={at === allSlots.length - 1}
                      onEarlier={() => moveTo(card.key, allSlots[at - 1] ?? null)} onLater={() => moveTo(card.key, allSlots[at + 1] ?? null)}
                      onToggle={() => toggleHidden(card.key)}
                      sections={placement.map((item) => ({ section: item.section, label: sectionLabel(item.section), free: firstFreeSlot(draftSlots, item.section) }))}
                      onMoveToSection={(target) => moveTo(card.key, firstFreeSlot(draftSlots, target))} /> : null}
                  </Slot>;
                })}
              </ul>
            </section>)}
          </div>
        </DndContext>
      ) : (
      <>
      {cards.length >= SEARCH_FROM ? <div className="flex flex-wrap items-center gap-2" data-testid="task-library-filter">
        <label className="relative min-w-56 flex-1 sm:max-w-sm"><span className="sr-only">Sök uppgiftstyp</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="pl-9" placeholder="Sök uppgiftstyp" value={query} onChange={(event) => setQuery(event.target.value)} data-testid="task-library-search" />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kategori">
          {["ALL", ...presentCategories].map((value) => <Button key={value} type="button" size="sm" variant={category === value ? "secondary" : "outline"} aria-pressed={category === value} onClick={() => setCategory(value)}>{value === "ALL" ? "Alla" : sectionLabel(value)}</Button>)}
        </div>
        {query || category !== "ALL" ? <Button type="button" size="sm" variant="ghost" onClick={() => { setQuery(""); setCategory("ALL"); }}><X />Rensa</Button> : null}
      </div> : null}
      {groups.length === 0 && shownCards.length ? <p className="notice" data-testid="task-library-empty">Ingen uppgiftstyp matchar sökningen.</p> : null}
      <div className="grid gap-6" aria-label="Välj uppgiftstyp">
      {groups.map(([groupCategory, groupCards]) => <section key={groupCategory} aria-label={sectionLabel(groupCategory)} className="space-y-3" data-testid="task-category" data-category={groupCategory}>
        {/* A group label, not an h2: the cards' own titles are the page's h2 headings. */}
        <p role="heading" aria-level={2} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{groupCategory === FAVORITES ? <Star className="mr-1.5 inline size-3.5 align-[-2px]" aria-hidden="true" /> : null}{sectionLabel(groupCategory)}</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
        {groupCards.map((card) => card.form ? (
          <div key={card.key} className={cardClass} data-testid="form-type-card">
            <FormTypeCardContent form={card.form} corner={(superadmin ? !card.form.own : canBuildForms && card.form.own) ? confirming === card.form.id
                ? <span className="flex gap-1"><Button type="button" size="sm" variant="destructive" onClick={() => void unpublish(card.form!)}>Ta bort för alla</Button><Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(null)}>Avbryt</Button></span>
                : <Button type="button" size="sm" variant="ghost" className="text-destructive" aria-label={`Ta bort ${card.form.name} från Ny uppgift`} onClick={() => setConfirming(card.form!.id)}><Trash2 />Ta bort</Button>
                : undefined}
              /* The company's values for this control (2026-10-07), for whoever may enter them and only when the form has limits. */
              meta={canEditValues && (card.form.limits ?? 0) > 0 ? <Link href={companyValuesHref(card.form.id)} className="relative z-10 inline-flex shrink-0 items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-primary" aria-label="Värden för den här kontrollen" title="Värden för den här kontrollen" data-testid="form-values-link"><Scale className="size-3.5" aria-hidden="true" />Värden</Link> : undefined}>
              {/* Named after the card, so a screen reader hears which protocol – not ten links called Skapa protokoll.
                  The card's own link comes first; the values shortcut on the last line follows it. */}
              <Link href={card.href} aria-label={`${card.linkLabel}: ${card.name}`} className="mt-5 inline-flex w-fit items-center gap-2 text-sm font-medium text-primary after:absolute after:inset-0 after:content-['']">
                {card.linkLabel}
              </Link>
            </FormTypeCardContent>
          </div>
        ) : (
          <Link key={card.key} href={card.href} className={cardClass}>
            {card.content}
            <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary">
              {card.linkLabel}
            </span>
            {/* The same last line as the form cards, so the links in a row of cards line up; a built-in type is Workflow's own. */}
            <CardFoot label="HINTEK Original" />
          </Link>
        ))}
      </div></section>)}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
        {/* The last card leads to Skapa formulär (2026-09-27): a new task type is a new form. Workflow and company
            admins build forms; employees get the same card as an explanation instead of a page they cannot use. Since
            2026-10-06 the superadmin too builds in the active organization (a form becomes global only through
            "Publicera som Workflow-original"), so the card says "Endast ert företag" for everyone. */}
        {canBuildForms ? (
          <Link href="/?view=forms&new=1" className={`${cardClass} border-dashed bg-card/60`} data-testid="create-form-card">
            <div className="flex items-start justify-between gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-secondary text-primary"><FilePlus2 className="size-5" /></span>
              <Badge variant="outline">Bara ert företag</Badge>
            </div>
            <h2 className="section-title mt-5 truncate group-hover:text-primary" data-card-title="">Ny uppgiftstyp</h2>
            <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">Bygg ett formulär. När det publiceras blir det en egen uppgiftstyp här.</p>
            <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary">Skapa formulär</span>
          </Link>
        ) : activeTypes.length || shownForms.length ? (
          <div className="flex min-h-52 flex-col rounded-xl border border-dashed bg-card/45 p-5" data-testid="create-form-card">
            <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground"><FilePlus2 className="size-5" /></span>
            <h2 className="section-title mt-5 truncate" data-card-title="">Saknas en uppgiftstyp?</h2>
            <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">Företagets administratör kan skapa egna formulär. De visas här när de är publicerade och du har behörighet till dem.</p>
          </div>
        ) : null}
      </div>
      </div>
      </>
      )}
    </div>
  );
}

type TaskCard = { key: string; name: string; href: string; content: ReactNode; linkLabel: string; form?: PublishedForm };

/** Drop on the place under the pointer; with the keyboard, the place the card overlaps most. */
const slotCollision: CollisionDetection = (args) => { const hits = pointerWithin(args); return hits.length ? hits : rectIntersection(args); };

/** One place in Anpassa: a card, or an empty place that a card can be dropped on. Empty places are only shown here. */
function Slot({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const empty = !children;
  return <li ref={setNodeRef} aria-label={empty ? `${label}, tom` : undefined} data-testid="arrange-slot" data-slot={id} data-empty={empty ? "true" : undefined}
    className={cn("min-h-28 rounded-xl", empty && "flex items-center justify-center border border-dashed bg-card/40 text-xs text-muted-foreground", isOver && "ring-2 ring-primary/60 ring-offset-2 ring-offset-background")}>
    {empty ? "Tom plats" : children}
  </li>;
}

/** A card on its place in Anpassa: drag handle, one place earlier/later, Flytta till a section, and whether it is shown. */
function PlacedCard({ card, hidden, here, first, last, sections, onEarlier, onLater, onToggle, onMoveToSection }: {
  card: TaskCard; hidden: boolean; here: string; first: boolean; last: boolean; sections: { section: string; label: string; free: string | null }[];
  onEarlier: () => void; onLater: () => void; onToggle: () => void; onMoveToSection: (section: string) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({ id: card.key });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform) }} data-testid="arrange-card" data-card={card.key} data-hidden={hidden ? "true" : undefined}
      className={cn("relative flex h-full min-h-52 flex-col rounded-xl border bg-card p-5 shadow-xs", hidden && "border-dashed bg-card/50", isDragging && "z-20 shadow-lg ring-2 ring-primary/40")}>
      <div className="mb-3 flex items-center justify-between gap-2 border-b pb-3">
        <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Flytta ${card.name}`} className="flex h-8 cursor-grab touch-none items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary active:cursor-grabbing">
          <GripVertical className="size-4" />Dra
        </button>
        <div className="flex items-center gap-1">
          {/* On a computer dragging is enough (2026-09-30); the arrows and Flytta till are for touch and narrow screens. */}
          <span className="arrange-touch-only items-center gap-1">
            <IconButton label={`Flytta ${card.name} tidigare`} disabled={first} onClick={onEarlier}><ChevronLeft /></IconButton>
            <IconButton label={`Flytta ${card.name} senare`} disabled={last} onClick={onLater}><ChevronRight /></IconButton>
          </span>
          <Button type="button" size="sm" variant={hidden ? "outline" : "secondary"} aria-pressed={!hidden} aria-label={`${hidden ? "Visa" : "Dölj"} ${card.name}`} onClick={onToggle}>
            {hidden ? <EyeOff /> : <Eye />}{hidden ? "Dold" : "Visas"}
          </Button>
        </div>
      </div>
      <label className="arrange-touch-only mb-3 items-center gap-2 text-xs text-muted-foreground">
        <span className="shrink-0">Flytta till</span>
        <select className="form-select h-8 min-w-0 flex-1 text-xs" value="" aria-label={`Flytta ${card.name} till`} onChange={(event) => { if (event.target.value) onMoveToSection(event.target.value); }}>
          <option value="">Välj plats…</option>
          {sections.filter((item) => item.section !== here).map((item) => <option key={item.section} value={item.section} disabled={!item.free}>{item.label}{item.free ? "" : " (full)"}</option>)}
        </select>
      </label>
      <div className={cn("pointer-events-none flex flex-1 flex-col select-none", hidden && "opacity-50")} aria-hidden="true">
        {card.form ? <FormTypeCardContent form={card.form} /> : card.content}
      </div>
    </div>
  );
}
