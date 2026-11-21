import type { LucideIcon } from "lucide-react";
import { ArrowRight, ClipboardCheck, ClipboardList, Cog, FileText, FolderKanban, MapPinHouse, ReceiptText, Repeat, ShieldAlert, TriangleAlert, UserRound, Users } from "lucide-react";
import { VIEW_ICON } from "@/lib/workflow/view-icons";
import { panelAreaOfView, type PanelArea } from "@/lib/workflow/panel-area";
import { typeOfTaskKind } from "@/lib/workflow/native-mode";
import { MENU_ITEM_GROUPS, menuKeyOfView, TOOLS_GROUP_TITLE, TOOLS_LABEL } from "@/lib/workflow/menu-items";
import { settingsPlace } from "@/lib/workflow/settings-tabs";
import type { SearchHit, SearchType } from "./types";

/**
 * How a hit in Sök looks (2026-11-19: "resultaten presenterar inte snyggt"): the icon square of the shared icon
 * standard (`AreaIcon`) in the colour of the area the hit belongs to, a page with the menu's own symbol, and for a page a
 * line saying what it is and where it sits ("Sida · Uppföljning"). Display only; the ranking and the hits are unchanged.
 */
export type HitLook = { icon: LucideIcon; area: PanelArea; kind: string };

const RECORD_ICON: Record<Exclude<SearchType, "command" | "task">, LucideIcon> = {
  report: FileText, project: FolderKanban, quote: FileText, invoice_basis: ReceiptText, customer: Users, place: MapPinHouse,
  round: Repeat, deviation: TriangleAlert, machine: Cog, form: FileText, person: UserRound,
};
const RECORD_AREA: Record<Exclude<SearchType, "command" | "task">, PanelArea> = {
  report: "tools", project: "project", quote: "quote", invoice_basis: "quote", customer: "customer", place: "customer",
  round: "round", deviation: "risk", machine: "maintenance", form: "control", person: "admin",
};
/** One record's kind in the singular, for a list that mixes kinds (Senast öppnade). A job's line already starts with its kind. */
const KIND_WORD: Record<SearchType, string> = {
  command: "Sida", task: "", report: "Rapport", project: "Projekt", quote: "Offert", invoice_basis: "Fakturaunderlag", customer: "Kund",
  place: "Plats", round: "Driftrond", deviation: "Avvikelse", machine: "Maskin", form: "Formulär", person: "Person",
};

function params(href: string) {
  try { return new URL(href, "http://workflow.local").searchParams; } catch { return new URLSearchParams(); }
}
const taskIcon = (taskType: string | null) => taskType === "WORK_ORDER" ? ClipboardList : taskType === "RISK_ASSESSMENT" ? ShieldAlert : ClipboardCheck;

/** Where a page sits: its menu group, Inställningar or Installation. */
function pagePlace(view: string, title: string): string {
  const place = settingsPlace(view);
  if (place) return place.area === "product" ? "Installation" : "Inställningar";
  const key = menuKeyOfView(view);
  const group = key ? MENU_ITEM_GROUPS.find((entry) => (entry.items as readonly { key: string }[]).some((item) => item.key === key))?.title : undefined;
  // The supporting pages sit under the menu button Mer (förenkling 0.77.0): Sök says Mer too, not the group's inner name Verktyg.
  const shown = group === TOOLS_GROUP_TITLE ? TOOLS_LABEL : group;
  return shown && shown !== title ? shown : "";
}

export function hitLook(hit: Pick<SearchHit, "type" | "href" | "title">): HitLook {
  const query = params(hit.href);
  if (hit.type === "task") {
    const taskType = query.get("taskType");
    return { icon: taskIcon(taskType), area: taskType ? typeOfTaskKind(taskType) : "control", kind: "" };
  }
  if (hit.type === "command") {
    const view = query.get("view") ?? "";
    const taskType = query.get("taskType");
    const icon = view === "workflow_task" ? taskIcon(taskType) : (VIEW_ICON as Record<string, LucideIcon>)[view] ?? ArrowRight;
    const what = /^(Ny|Nytt|Rapportera)\s/.test(hit.title) ? "Skapa" : "Sida";
    const place = pagePlace(view, hit.title);
    return { icon, area: panelAreaOfView(view, taskType), kind: place ? `${what} · ${place}` : what };
  }
  return { icon: RECORD_ICON[hit.type], area: RECORD_AREA[hit.type], kind: KIND_WORD[hit.type] };
}

/**
 * The row's small line: a page says what it is and where it sits; a record keeps its own line, and in a list that mixes
 * kinds (`mixed`, Senast öppnade) it starts with its kind unless the line already says it.
 */
export function hitLine(hit: Pick<SearchHit, "type" | "href" | "title" | "subtitle">, look: HitLook, mixed: boolean): string {
  if (hit.type === "command") return look.kind;
  const subtitle = hit.subtitle ?? "";
  if (!mixed || !look.kind || subtitle.startsWith(look.kind)) return subtitle;
  return subtitle ? `${look.kind} · ${subtitle}` : look.kind;
}
