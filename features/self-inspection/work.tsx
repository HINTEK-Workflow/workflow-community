"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ShieldCheck, ListChecks, BadgeCheck } from "lucide-react";
import { Field, Panel } from "@/features/kfid/ui";
import { api } from "@/features/kfid/api";
import { announce } from "@/lib/workflow/toast";
import type { ActivityTypeKey, SelfInspectionAction } from "@/lib/self-inspection/model";
import { directoryOfView, levelOf, type LevelsView } from "@/lib/self-inspection/levels";
import { assignmentWarnings, type WorkContext } from "@/lib/self-inspection/work";
import { RiskClassMark } from "./risk-class-mark";
import { Tag } from "./shared";
import { useWorkViewDefaults } from "@/features/workflow/use-work-view";
import { useNativeMode } from "@/features/workflow/use-detail-level";

/**
 * Egenkontroll in the daily work (etapp 2–3, 2026-10-06). Cloud and the demo read /api/self-inspection/work and
 * change through /api/self-inspection; Local provides a backend over the open file (SelfInspectionWorkProvider), so a
 * project or a task does not need to know where the programme is kept.
 *
 * Since 2026-10-07 the panel no longer chooses who performs and who inspects per project or task: roles are given in
 * advance with a level, and the panel tells the task's risk class, the reader's level and the responsible person's.
 */
/** `planning`: a protocol also asks for the scope its project's planning protocol selects (the control's moments, 2026-10-07). */
export type WorkTarget = { projectId?: string | null; taskId?: string | null; planning?: boolean; /** A new protocol: the form it starts from. */ formId?: string | null; /** A new work order or risk assessment. */ kind?: string | null };
export type SelfInspectionWorkBackend = {
  context: (target: WorkTarget) => Promise<WorkContext>;
  act: (input: SelfInspectionAction) => Promise<void>;
  /** Roles with levels and the company's risk classes, for the cards under Ny uppgift. */
  levels: () => Promise<LevelsView>;
};

const cloudBackend: SelfInspectionWorkBackend = {
  context: (target) => api<WorkContext>(`/api/self-inspection/work?${new URLSearchParams({ ...(target.projectId ? { projectId: target.projectId } : {}), ...(target.taskId ? { taskId: target.taskId } : {}),
    ...(target.planning ? { planning: "1" } : {}), ...(target.formId ? { formId: target.formId } : {}), ...(target.kind ? { kind: target.kind } : {}) })}`, { cache: "no-store" }),
  act: async (input) => { await api("/api/self-inspection", { method: "POST", body: JSON.stringify(input) }); },
  levels: () => api<LevelsView>("/api/self-inspection/levels", { cache: "no-store" }),
};
const WorkBackendContext = createContext<SelfInspectionWorkBackend | null>(null);
export const SelfInspectionWorkProvider = WorkBackendContext.Provider;

/** The programme's view of one project or task; null while loading or when it cannot be read (it never blocks the work). */
export function useSelfInspectionWork(target: WorkTarget, enabled = true) {
  const backend = useContext(WorkBackendContext) ?? cloudBackend;
  const [context, setContext] = useState<WorkContext | null>(null);
  const { projectId = null, taskId = null, planning = false, formId = null, kind = null } = target;
  const reload = useCallback(async () => {
    if (!enabled || (!projectId && !taskId && !formId && !kind)) { setContext(null); return; }
    // The programme is a help beside the work: a member without access or a company without it simply sees nothing.
    try { setContext(await backend.context({ projectId, taskId, planning, formId, kind })); } catch { setContext(null); }
  }, [backend, enabled, projectId, taskId, planning, formId, kind]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Read again when the project, task, form or file changes.
  useEffect(() => { void reload(); }, [reload]);
  const act = useCallback(async (input: SelfInspectionAction) => { await backend.act(input); await reload(); }, [backend, reload]);
  return { context, reload, act };
}
export type SelfInspectionWork = ReturnType<typeof useSelfInspectionWork>;

/**
 * The company's levels and risk classes (the cards under Ny uppgift mark each task type); `levels` is null while loading or
 * when unreadable. `set` changes a class (admins; the server checks) and reads the classes again.
 */
export function useRiskLevels(enabled = true) {
  const backend = useContext(WorkBackendContext) ?? cloudBackend;
  const [levels, setLevels] = useState<LevelsView | null>(null);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    backend.levels().then((result) => { if (active) setLevels(result); }).catch(() => { if (active) setLevels(null); });
    return () => { active = false; };
  }, [backend, enabled, reads]);
  const set = useCallback(async (key: string, riskClass: number | null) => { await backend.act({ action: "set_risk_class", key, riskClass }); setReads((count) => count + 1); }, [backend]);
  return { levels, set };
}

/**
 * Egenkontroll on a project or a task (2026-10-06, levels 2026-10-07): the kind of work, the task's risk class with
 * the reader's level and the responsible person's, the competence warnings and the customer's special requirements. The
 * warnings only advise; the levels are enforced on the server and explained here before they are tried.
 */
export function AssignmentPanel({ work, target, canEdit, inspectorInProtocol, responsible }: {
  work: SelfInspectionWork;
  target: { kind: "project" | "task"; id: string };
  canEdit: boolean;
  /** The name written as "Kontrollerat av" in the protocol, checked against the programme's people. */
  inspectorInProtocol?: { inspector: string; performer: string };
  /** The task's responsible person as it stands on the page (also unsaved): the supervisor of someone under supervision. */
  responsible?: { id: string | null; name: string };
}) {
  const { context, act } = work;
  const [busy, setBusy] = useState(false);
  const own = context ? (target.kind === "task" ? context.task : context.project) : null;
  const inherited = target.kind === "task" && context?.project && !context.task;
  const current = own ?? (target.kind === "task" ? context?.effective ?? null : null);
  const responsibleId = responsible?.id ?? null;
  // The Ledande montör work view (2026-10-08) starts the panel open on a task page; display only.
  const openForView = useWorkViewDefaults().openSelfInspection && target.kind === "task";
  // Level 1 on a phone (telefonrapporten 2026-10-10, fynd 18): a screen is already one subject, and a folded panel there is
  // only a small group heading with nothing under it – it read as an empty group. The panel is open on a screen.
  const native = useNativeMode();
  const warnings = useMemo(() => {
    if (!context) return [];
    // Only someone with a role that performs work is matched against the competence data; an office colleague as responsible is not a performer.
    const performer = Boolean(responsibleId && context.performers.some((person) => person.id === responsibleId));
    const inspector = inspectorInProtocol?.inspector.trim() ?? "";
    if (!performer && !inspector) return [];
    return assignmentWarnings(context, { performerId: performer ? responsibleId : null, performerName: inspectorInProtocol?.performer || responsible?.name || "", inspectorName: inspector, activityType: current?.activityType ?? null });
  }, [context, current, inspectorInProtocol, responsibleId, responsible?.name]);
  // The customer's special requirements are the customer card's field (2026-10-07) and are shown also where the company has no programme.
  // A task page shows them in Uppdraget above its panels instead, so no display level folds them away (2026-10-08).
  const requirements = target.kind === "task" ? "" : context?.customerRequirements ?? "";
  if (context && !context.hasProgram && requirements) return <Panel icon={ListChecks} title="Kundens särskilda krav" description="Krav som kunden ställer utöver det vanliga, från kundkortet.">
    <p className="whitespace-pre-line text-sm" data-testid="self-inspection-customer-requirements">{requirements}</p>
  </Panel>;
  if (!context?.hasProgram) return null;
  const levels = context.levels;
  const risk = target.kind === "task" ? context.riskClass : null;
  const me = levels.me;
  const boss = responsibleId ? levelOf(directoryOfView(levels), responsibleId) : null;
  // Kompetenskort v2 (2026-10-08): the responsible person's card, when the reader may read it (an admin, or the person) – it informs, the level decides.
  const responsiblePerson = responsibleId ? [...context.performers, ...context.inspectors].find((person) => person.id === responsibleId && person.card) : undefined;
  const responsibleCard = responsiblePerson?.card ? { name: responsiblePerson.name, card: responsiblePerson.card } : null;
  const save = async (activityType: ActivityTypeKey | null) => {
    setBusy(true);
    try { await act({ action: "set_assignment", target: target.kind, targetId: target.id, activityType }); } catch (issue) { announce((issue as Error).message, true); } finally { setBusy(false); }
  };
  const prefix = `si-work-${target.kind}`;
  return <Panel icon={BadgeCheck} title="Egenkontroll" description={target.kind === "project" ? "Vilken typ av arbete projektet gäller, enligt egenkontrollprogrammet." : "Krävd nivå, nivåer och vilken typ av arbete uppgiften gäller, enligt egenkontrollprogrammet."}
    collapsible={!native} defaultCollapsed={!openForView && !warnings.length && !(risk && levels.enforced)} keepOpen={openForView}>
    <div className="space-y-4" data-testid="self-inspection-assignment">
      {risk ? <div className="space-y-2" data-testid="self-inspection-level-facts">
        <div className="flex flex-wrap items-center gap-2">
          <RiskClassMark value={risk.value} suggested={risk.suggested} />
          {levels.enforced ? <>
            <Tag>{me.level ? `Din nivå ${me.level}` : "Du har ingen roll"}</Tag>
            {me.supervised ? <Tag tone="warning">Under handledning</Tag> : null}
            {boss ? <Tag>{`Ansvarig ${responsible?.name || boss.name || "vald"}: ${boss.level ? `nivå ${boss.level}` : "ingen roll"}`}</Tag> : null}
          </> : null}
        </div>
        <p className="text-xs text-muted-foreground">{levels.enforced
          ? "Personens nivå måste vara minst lika hög som uppgiftens. Under handledning går det även med lägre nivå."
          : "Ingen i företaget har fått en roll ännu, så nivåerna spärrar ingenting."}</p>
      </div> : null}
      {responsibleCard ? <div className="rounded-lg border bg-muted/30 p-3 text-sm" data-testid="self-inspection-responsible-card">
        <p className="text-xs font-medium">Kompetenskort: {responsibleCard.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">{[
          responsibleCard.card.groups.length ? `Grupper: ${responsibleCard.card.groups.join(", ")}` : "",
          `${responsibleCard.card.validTrainings} giltiga utbildningar`,
          responsibleCard.card.licence ? `Körkort: ${responsibleCard.card.licence}` : "",
          responsibleCard.card.languages.length ? `Språk: ${responsibleCard.card.languages.join(", ")}` : "",
        ].filter(Boolean).join(" · ")}</p>
      </div> : null}
      {inherited ? <p className="text-xs text-muted-foreground">Hämtat från projektet. Ett val här gäller bara den här uppgiften.</p> : null}
      <Field id={`${prefix}-activity`} label="Verksamhetstyp" value={current?.activityType ?? ""} disabled={!canEdit || busy} options={["", ...context.activityTypes.map((type) => type.key)]} className="max-w-md"
        optionLabels={{ "": "Inte angiven", ...Object.fromEntries(context.activityTypes.map((type) => [type.key, type.label])) }}
        onChange={(value) => void save((value || null) as ActivityTypeKey | null)} />
      <p className="text-xs text-muted-foreground">Roller och nivåer ges i förväg under <Link className={native ? "inline-flex min-h-11 items-center px-1 font-medium text-primary underline underline-offset-2" : "underline underline-offset-2"} href="/?view=self_inspection&tab=roles">Egenkontroll</Link>.</p>
      {warnings.length ? <ul className="space-y-1.5" data-testid="self-inspection-assignment-warnings">{warnings.map((text) => <li key={text} className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{text}</li>)}</ul> : inspectorInProtocol?.inspector.trim() ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4" aria-hidden="true" />Inga varningar för valen.</p> : null}
      {requirements ? <div className="rounded-lg border bg-secondary/40 p-3" data-testid="self-inspection-customer-requirements">
        <p className="text-xs font-medium">Kundens särskilda krav</p>
        <p className="mt-1 whitespace-pre-line text-sm">{requirements}</p>
      </div> : null}
      <p className="text-xs text-muted-foreground">Kompetensvarningarna stoppar aldrig arbetet. Det gör nivåerna, och de förklarar vad som saknas.</p>
    </div>
  </Panel>;
}

/** The panel for a project page, reading the programme itself. */
export function ProjectAssignment({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const work = useSelfInspectionWork({ projectId });
  return <AssignmentPanel work={work} target={{ kind: "project", id: projectId }} canEdit={canEdit} />;
}
