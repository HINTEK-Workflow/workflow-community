import { prisma } from "@/lib/db";
import { MODULE_KEYS, moduleTitle } from "@/lib/workflow/modules";
import { ROLE_LABEL, type SupportPart } from "@/lib/security/access-rules";

/**
 * What support sees during a grant (K2.3): one bounded, read-only page per part, with only the fields that help support
 * understand a question – names, states and dates, never documents, files, prices, protocols' contents or keys. Every
 * query is bound to the company the caller has already checked has an open grant (lib/security/support-access.ts).
 * Nothing in this file writes.
 */
const PAGE = 50;
const day = (value: Date | null | undefined) => (value ? value.toISOString() : null);

export type SupportRows = { columns: string[]; rows: string[][]; total: number };

async function overview(organizationId: string): Promise<SupportRows> {
  const [organization, settings, members, places, parts, workOrders] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, storageMode: true, isActive: true, disabledModules: true, createdAt: true } }),
    prisma.workspaceSettings.findUnique({ where: { organizationId }, select: { requireTwoFactor: true, maintenance: true } }),
    prisma.organizationMember.count({ where: { organizationId, isActive: true } }),
    prisma.maintenancePlace.count({ where: { organizationId } }),
    prisma.machinePart.count({ where: { organizationId } }),
    prisma.workflowTask.count({ where: { organizationId, kind: "WORK_ORDER" } }),
  ]);
  const off = new Set(organization?.disabledModules ?? []);
  const rows: string[][] = [
    ["Företag", organization?.name ?? ""],
    ["Status", organization?.isActive ? "Aktivt" : "Pausat"],
    ["Lagring", organization?.storageMode === "LOCAL" ? "Lokal lagring" : "Servern"],
    ["Moduler som är på", MODULE_KEYS.filter((key) => !off.has(key)).map(moduleTitle).join(", ") || "Inga"],
    ["Tvåstegsverifiering krävs", settings?.requireTwoFactor ? "Ja" : "Nej"],
    ["Aktiva användare", String(members)],
    ["Platser", String(places)],
    ["Maskiner", String(parts)],
    ["Arbetsorder", String(workOrders)],
  ];
  return { columns: ["Uppgift", "Värde"], rows, total: rows.length };
}

async function members(organizationId: string): Promise<SupportRows> {
  const [rows, total] = await Promise.all([
    prisma.organizationMember.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, take: PAGE, select: { role: true, isActive: true, createdAt: true, user: { select: { name: true, email: true, totpEnabledAt: true } } } }),
    prisma.organizationMember.count({ where: { organizationId } }),
  ]);
  return { columns: ["Namn", "Roll", "Status", "Tvåsteg", "Med sedan"], total, rows: rows.map((row) => [row.user.name || row.user.email, ROLE_LABEL[row.role] ?? row.role, row.isActive ? "Aktiv" : "Pausad", row.user.totpEnabledAt ? "På" : "Av", day(row.createdAt) ?? ""]) };
}

async function places(organizationId: string): Promise<SupportRows> {
  const [rows, total] = await Promise.all([
    prisma.maintenancePlace.findMany({ where: { organizationId }, orderBy: { name: "asc" }, take: PAGE, select: { name: true, level: true } }),
    prisma.maintenancePlace.count({ where: { organizationId } }),
  ]);
  return { columns: ["Plats", "Nivå"], total, rows: rows.map((row) => [row.name, row.level]) };
}

async function machines(organizationId: string): Promise<SupportRows> {
  const [rows, total] = await Promise.all([
    prisma.machinePart.findMany({ where: { organizationId }, orderBy: { name: "asc" }, take: PAGE, select: { name: true, isActive: true, createdAt: true } }),
    prisma.machinePart.count({ where: { organizationId } }),
  ]);
  return { columns: ["Maskin", "Status", "Skapad"], total, rows: rows.map((row) => [row.name, row.isActive ? "Aktiv" : "Pausad", day(row.createdAt) ?? ""]) };
}

async function workOrders(organizationId: string): Promise<SupportRows> {
  const [rows, total] = await Promise.all([
    prisma.workflowTask.findMany({ where: { organizationId, kind: "WORK_ORDER" }, orderBy: { updatedAt: "desc" }, take: PAGE, select: { title: true, status: true, dueDate: true, updatedAt: true } }),
    prisma.workflowTask.count({ where: { organizationId, kind: "WORK_ORDER" } }),
  ]);
  return { columns: ["Arbetsorder", "Status", "Klart senast", "Ändrad"], total, rows: rows.map((row) => [row.title, row.status, row.dueDate, day(row.updatedAt) ?? ""]) };
}

async function forms(organizationId: string): Promise<SupportRows> {
  // Only the company's own forms: Workflow's shared originals (no organization) are not the company's data.
  const [rows, total] = await Promise.all([
    prisma.formTemplate.findMany({ where: { organizationId }, orderBy: { updatedAt: "desc" }, take: PAGE, select: { name: true, status: true, category: true, updatedAt: true } }),
    prisma.formTemplate.count({ where: { organizationId } }),
  ]);
  return { columns: ["Formulär", "Status", "Kategori", "Ändrat"], total, rows: rows.map((row) => [row.name, row.status, row.category, day(row.updatedAt) ?? ""]) };
}

const READERS: Record<SupportPart, (organizationId: string) => Promise<SupportRows>> = { overview, members, places, machines, work_orders: workOrders, forms };

export const readSupportPart = (organizationId: string, part: SupportPart) => READERS[part](organizationId);
