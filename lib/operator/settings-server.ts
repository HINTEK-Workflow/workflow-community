import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { causesOf, INACTIVITY_DEFAULT, type Intake } from "@/lib/operator/rules";

/**
 * The company's operator page settings (OperatorSettings, one row per company) and the product owner's switches
 * (SystemSettings.operatorPage). The row is made the first time the company's admin opens Operatörskonton, with a random
 * page key – the address never carries the company's name.
 */
const KEY_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export function newPageKey(length = 20) {
  const bytes = randomBytes(length);
  return [...bytes].map((byte) => KEY_ALPHABET[byte % KEY_ALPHABET.length]).join("");
}

export type OperatorSettingsView = {
  organizationId: string;
  pageKey: string;
  causes: string[];
  intake: Intake;
  inactivityMinutes: number;
  microsoft: { enabled: boolean; tenantId: string | null; groupId: string | null; groupName: string; consentAt: string | null; check: { ok: boolean; message: string; at: string } | null };
  aiTroubleshooting: boolean;
};

type Row = NonNullable<Awaited<ReturnType<typeof prisma.operatorSettings.findUnique>>>;
export function settingsView(row: Row): OperatorSettingsView {
  const check = row.microsoftCheck as { ok?: unknown; message?: unknown; at?: unknown } | null;
  return {
    organizationId: row.organizationId, pageKey: row.pageKey, causes: causesOf(row.causes), intake: row.intake === "approval" ? "approval" : "order",
    inactivityMinutes: row.inactivityMinutes,
    microsoft: {
      enabled: row.microsoftEnabled, tenantId: row.microsoftTenantId, groupId: row.microsoftGroupId, groupName: row.microsoftGroupName,
      consentAt: row.microsoftConsentAt?.toISOString() ?? null,
      check: check && typeof check.ok === "boolean" ? { ok: check.ok, message: String(check.message ?? ""), at: String(check.at ?? "") } : null,
    },
    aiTroubleshooting: row.aiTroubleshooting,
  };
}

/** The company's row, made with a fresh page key the first time (two at once: the unique key decides, the loser reads). */
export async function ensureOperatorSettings(organizationId: string) {
  const existing = await prisma.operatorSettings.findUnique({ where: { organizationId } });
  if (existing) return existing;
  try {
    return await prisma.operatorSettings.create({ data: { organizationId, pageKey: newPageKey(), inactivityMinutes: INACTIVITY_DEFAULT } });
  } catch (error) {
    const raced = await prisma.operatorSettings.findUnique({ where: { organizationId } });
    if (raced) return raced;
    throw error;
  }
}

/** The company behind an operator page address – only an active Cloud company. */
export async function settingsByPageKey(pageKey: string) {
  const row = await prisma.operatorSettings.findUnique({
    where: { pageKey },
    include: { organization: { select: { id: true, name: true, isActive: true, storageMode: true, workdayStartMinutes: true, workdayEndMinutes: true } } },
  });
  if (!row || !row.organization.isActive || row.organization.storageMode !== "HINTEK_CLOUD") return null;
  return row;
}

/** Installation: the product owner's switches for every company. Empty = everything off. */
export async function productOperatorSettings(): Promise<{ aiTroubleshooting: boolean }> {
  const row = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { operatorPage: true } });
  const value = (row?.operatorPage ?? {}) as { aiTroubleshooting?: unknown };
  return { aiTroubleshooting: value.aiTroubleshooting === true };
}

export async function saveProductOperatorSettings(next: { aiTroubleshooting: boolean }) {
  await prisma.systemSettings.upsert({ where: { id: "global" }, update: { operatorPage: next }, create: { id: "global", operatorPage: next } });
}
