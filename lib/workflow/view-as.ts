// "Visa som" (2026-10-03): the superadmin previews how the menus and pages look for a customer's roles and plans.
// Display only – the server still decides every request by the person's real rights, so nothing opens or closes.
export const VIEW_AS_COOKIE = "wf_view_as";
export const VIEW_AS_MODES = ["owner", "member", "local"] as const;
export type ViewAs = (typeof VIEW_AS_MODES)[number];

export const VIEW_AS_LABELS: Record<ViewAs, { label: string; description: string }> = {
  owner: { label: "Kundföretagets ägare (Cloud)", description: "Ett betalande företag i HINTEK Cloud: allt utom Produktadministration." },
  member: { label: "Medarbetare (Cloud)", description: "En anställd med behörigheten Utföra arbete: inga företagsinställningar." },
  local: { label: "Gratisföretag (Local)", description: "Ett nytt konto i Local: hela Workflow i den egna filen, utan AI och MCP." },
};

export function parseViewAs(value: string | undefined | null): ViewAs | null {
  return (VIEW_AS_MODES as readonly string[]).includes(value ?? "") ? (value as ViewAs) : null;
}
