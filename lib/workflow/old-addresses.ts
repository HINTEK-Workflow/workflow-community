import type { ViewAs } from "./view-as";

/**
 * Where the old address ?view=facilities leads (webbplatskartan 2026-10-24). The Platser tab under Inställningar is gone
 * (2026-10-04) and its offices and departments with it (2026-10-24), so the company's admin lands on Företaget;
 * anyone else – a member, or the superadmin previewing a member – lands on Översikt, never on the permission box.
 */
export function oldFacilitiesTarget(memberRole: string | null | undefined, viewAs: ViewAs | null): string {
  const admin = (memberRole === "OWNER" || memberRole === "ADMIN") && viewAs !== "member";
  return admin ? "/?view=company" : "/?view=stats";
}
