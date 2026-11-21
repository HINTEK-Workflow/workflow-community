import { canChangeOthersBookings, type BookingProject } from "./bookings";
import { FORM_PERMISSION_AREAS, formPermissionArea, hasWorkflowPermission, type WorkflowPermissionProfile } from "./permissions";

/**
 * Who plans Driftronder (2026-10-10, kartläggningen 5.11; was: only the company's admin). A round is planning of
 * protocols, so it follows the same rules as booking a job (planned-activity-access.ts, bookings.ts):
 * - the right to create protocols of the round's form (its area: Formulär, Kontroll före idrifttagning or Riskbedömning);
 * - a round in a project also needs the right to edit projects;
 * - a round given to someone else is planned only by an admin, or in a project by its responsible person or stand-in –
 *   one's own rounds (and rounds without a responsible person) are one's own, like bookings.
 * Admins plan every round. The server checks every save and removal; the page only hides what would be refused.
 */
export type RoundPlanActor = { admin: boolean; userId: string; permissions: WorkflowPermissionProfile };
export type RoundPlanState = { formArea: string | null | undefined; projectId: string | null; assignedToUserId: string | null; project?: BookingProject };

export function roundPlanRefusal(actor: RoundPlanActor, round: RoundPlanState) {
  if (actor.admin) return null;
  if (!hasWorkflowPermission(actor.permissions, formPermissionArea(round.formArea), "create"))
    return "Du saknar behörighet att skapa protokoll av det här formuläret och kan därför inte planera ronden.";
  if (round.projectId && !hasWorkflowPermission(actor.permissions, "projects", "edit"))
    return "Ronden hör till ett projekt, och du saknar behörighet att ändra projekt.";
  if (!round.assignedToUserId || round.assignedToUserId === actor.userId) return null;
  const project = round.projectId ? round.project ?? null : null;
  if (canChangeOthersBookings({ admin: false, userId: actor.userId, project })) return null;
  return project
    ? "Ronder åt andra planeras bara av projektansvarig, projektets ställföreträdare eller en företagsadministratör. Du kan planera dina egna ronder."
    : "Ronder åt andra planeras bara av en företagsadministratör. Du kan planera dina egna ronder.";
}

/** A change must be allowed both for the round as it was and as it becomes (like moving a booking between projects). */
export function roundChangeRefusal(actor: RoundPlanActor, before: RoundPlanState | null, after: RoundPlanState | null) {
  return (before ? roundPlanRefusal(actor, before) : null) ?? (after ? roundPlanRefusal(actor, after) : null);
}

/** Whether the person may plan any round at all (Ny rond, Upprepa kontrollen). */
export function canPlanRounds(admin: boolean, permissions: WorkflowPermissionProfile) {
  return admin || FORM_PERMISSION_AREAS.some((area) => hasWorkflowPermission(permissions, area, "create"));
}
