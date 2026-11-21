"use client";

import { useEffect, useState } from "react";
import { BookOpenCheck } from "lucide-react";
import { api } from "@/features/kfid/api";
import { KeyCard, KeyFields, KeyTextField } from "@/features/integrations/key-card";
import { announce } from "@/lib/workflow/toast";
import { ACCOUNTING_FIELDS, accountingSettingsSchema, FORTNOX_CONNECTION_READY, FORTNOX_KEY_PLACE, type AccountingSettings } from "@/lib/quotes/accounting";

/**
 * Bokföringskonton (2026-10-09, steg D; under Kopplingar → Bokföring since 2026-11-03, before that Arbetssätt → Avancerat and
 * Priser och offert): the company's own account numbers and verification
 * series for the SIE export (invoiced fakturaunderlag only, 2026-11-01) and the account on a Fortnox invoice row. Every
 * field starts empty: Workflow suggests no account plan. Only the company's admin changes it; those who may read quotes
 * see it. The same card as every key card (2026-11-12): the label above each field, ONE Spara for the card with
 * "Ej sparade ändringar", and the explanations under Mer (before: each field saved when it was left).
 */
export function AccountingSettingsPanel({ facts }: { /** More for Mer: what the bookkeeping does here (Kopplingar → Bokföring). */ facts?: React.ReactNode } = {}) {
  const [saved, setSaved] = useState<AccountingSettings | null>(null);
  const [settings, setSettings] = useState<AccountingSettings | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [fortnoxKey, setFortnoxKey] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    api<{ settings: AccountingSettings; canEdit: boolean; fortnoxKey: string | null }>("/api/quotes/export?part=accounting", { cache: "no-store" })
      .then((result) => { if (active) { setSaved(result.settings); setSettings(result.settings); setCanEdit(result.canEdit); setFortnoxKey(result.fortnoxKey); } })
      // Without the right to read quotes there is nothing to show here.
      .catch(() => { if (active) setSettings(null); });
    return () => { active = false; };
  }, []);
  if (!settings || !saved) return null;
  const problems = Object.fromEntries(ACCOUNTING_FIELDS.map((field) => {
    const parsed = accountingSettingsSchema.shape[field.key].safeParse(settings[field.key]);
    return [field.key, parsed.success ? "" : parsed.error.issues[0]?.message ?? "Ogiltigt värde."];
  })) as Record<keyof AccountingSettings, string>;
  const problemText = [...new Set(Object.values(problems).filter(Boolean))].join(" ");
  const dirty = canEdit && JSON.stringify(settings) !== JSON.stringify(saved);
  const save = async () => {
    const next = settings;
    try {
      await api<{ settings: AccountingSettings }>("/api/quotes/export", { method: "POST", body: JSON.stringify({ action: "settings", settings: next }) });
      setSaved(next);
      announce("Bokföringens konton är sparade.");
      return true;
    } catch (cause) {
      announce((cause as Error).message, true);
      return false;
    }
  };
  return <div data-testid="accounting-settings"><KeyCard icon={BookOpenCheck} title="Bokföringskonton" status={null}
    save={canEdit ? { dirty, onSave: save, blocked: problemText || null } : undefined}
    more={<>
      <p>Era egna kontonummer för SIE-filen av fakturerade underlag{FORTNOX_CONNECTION_READY ? " och för Fortnox" : ""}.</p>
      <p>Använd kontona i er egen kontoplan. Workflow föreslår inga konton.</p>
      {facts}
      {!FORTNOX_CONNECTION_READY ? null : <p>{fortnoxKey ? `Fortnox-nyckeln ”${fortnoxKey}” används när en offert eller ett fakturaunderlag skickas till Fortnox.` : `För att skicka till Fortnox läggs företagets Fortnox-nyckel till under ${FORTNOX_KEY_PLACE}.`}</p>}
    </>}>
    <KeyFields>
      {ACCOUNTING_FIELDS.map((field) => <KeyTextField key={field.key} id={`accounting-field-${field.key}`} label={field.label} value={settings[field.key]}
        inputMode={field.key === "series" ? "text" : "numeric"} maxLength={field.key === "series" ? 10 : 6} placeholder={field.placeholder} disabled={!canEdit}
        invalid={Boolean(problems[field.key])} onChange={(value) => setSettings({ ...settings, [field.key]: value })} testId={`accounting-${field.key}`} />)}
    </KeyFields>
    {problemText ? <p role="alert" className="text-xs text-destructive" data-testid="accounting-problem">{problemText}</p> : null}
  </KeyCard></div>;
}
