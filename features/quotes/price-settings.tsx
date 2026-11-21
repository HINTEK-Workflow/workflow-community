"use client";

import { useEffect, useRef, useState } from "react";
import { BadgePercent, Coins } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api } from "@/features/kfid/api";
import { Panel } from "@/features/kfid/ui";
import { announce } from "@/lib/workflow/toast";
import { parseAmount } from "@/lib/workflow/expenses";
import { parsePercent } from "@/lib/workflow/material-prices";
import { parseKronor, parseShare } from "@/lib/quotes/model";
import { DEFAULT_QUOTE_VALID_DAYS, QUOTE_TERMS_MAX, type PriceSettings } from "@/lib/quotes/settings";
import { AccountingSettingsPanel } from "@/features/quotes/accounting-settings";

/**
 * Priser och villkor under Inställningar → Priser och offert (2026-10-09): the company's markup on material (copied
 * to a material row or a quote's material line when it gets its price), the default hourly rate of the Arbete line in a
 * quote and an invoice basis, how long a new quote is valid and the company's own quote terms. Only the company's admin
 * changes them; Cloud only. ROT (2026-10-09): the share and cap a private person's quote starts with – editable defaults
 * the company is responsible for.
 * Every change is saved when the field is left (docs/ui-system.md 2.3; simulation 0.6.3: the page had Spara buttons
 * although a settings page saves each choice at once). A value that cannot be read is said under the fields and not saved.
 */
export function PriceSettingsPanel({ accounting = true }: { accounting?: boolean } = {}) {
  const [settings, setSettings] = useState<PriceSettings | null>(null);
  const [days, setDays] = useState(String(DEFAULT_QUOTE_VALID_DAYS));
  const [error, setError] = useState("");
  // What the server has: a change is sent only when the fields differ from it, and saves run one after the other.
  const savedKey = useRef("");
  const queue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let active = true;
    api<{ settings: PriceSettings }>("/api/quotes?part=settings", { cache: "no-store" })
      .then((result) => { if (active) { setSettings(result.settings); setDays(String(result.settings.validDays)); savedKey.current = JSON.stringify(result.settings); } })
      .catch((cause: Error) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, []);
  if (error) return <Panel icon={Coins} title="Priser och villkor"><p role="alert" className="text-sm text-destructive">{error}</p></Panel>;
  if (!settings) return <Panel icon={Coins} title="Priser och villkor"><p role="status" className="text-sm text-muted-foreground">Hämtar…</p></Panel>;
  const badMarkup = Boolean(settings.markupPercent.trim()) && parsePercent(settings.markupPercent) === null;
  const badRate = Boolean(settings.hourlyRate.trim()) && (parseAmount(settings.hourlyRate) ?? -1) < 0;
  const badRotPercent = Boolean(settings.rotPercent.trim()) && parseShare(settings.rotPercent) === null;
  const badRotCap = Boolean(settings.rotCap.trim()) && parseKronor(settings.rotCap) === null;
  const dayCount = Number(days);
  const badDays = !Number.isInteger(dayCount) || dayCount < 1 || dayCount > 365;
  const problems = [
    badMarkup ? "Påslaget ska vara ett tal i procent." : "",
    badRate ? "Timpriset ska vara ett belopp i kronor." : "",
    badDays ? "Offerten gäller 1–365 dagar." : "",
    badRotPercent ? "ROT-andelen ska vara ett tal i procent." : "",
    badRotCap ? "Taket för ROT ska vara ett belopp i kronor." : "",
  ].filter(Boolean);
  const commit = () => {
    if (problems.length) return;
    const next = { ...settings, validDays: dayCount };
    const key = JSON.stringify(next);
    if (key === savedKey.current) return;
    savedKey.current = key;
    queue.current = queue.current.then(async () => {
      try {
        // The fields are not replaced by the answer, so typing in the next field is never interrupted.
        await api<{ settings: PriceSettings }>("/api/quotes", { method: "POST", body: JSON.stringify({ action: "settings", settings: next }) });
        announce("Priser och villkor är sparade.");
      } catch (cause) {
        savedKey.current = "";
        announce((cause as Error).message, true);
      }
    });
  };
  const leave = { onBlur: commit, onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") commit(); } };
  return <div data-testid="price-settings"><Panel title="Priser och villkor" description="Påslag och timpris gäller nya rader i arbetsordrar, offerter och fakturaunderlag. Sparas när du lämnar fältet." icon={BadgePercent}>
    <div className="space-y-4">
      <div className="field-group grid gap-4 rounded-lg border p-3 sm:grid-cols-3">
        <label className="space-y-1.5 text-xs font-medium text-muted-foreground">Påslag på material (%)
          <Input inputMode="decimal" placeholder="Inget påslag" value={settings.markupPercent} aria-invalid={badMarkup || undefined} onChange={(event) => setSettings({ ...settings, markupPercent: event.target.value })} {...leave} data-testid="price-settings-markup" />
        </label>
        <label className="space-y-1.5 text-xs font-medium text-muted-foreground">Timpris (kr)
          <Input inputMode="decimal" placeholder="Inget förval" value={settings.hourlyRate} aria-invalid={badRate || undefined} onChange={(event) => setSettings({ ...settings, hourlyRate: event.target.value })} {...leave} data-testid="price-settings-hourly-rate" />
        </label>
        <label className="space-y-1.5 text-xs font-medium text-muted-foreground">Offerten gäller (dagar)
          <Input inputMode="numeric" value={days} aria-invalid={badDays || undefined} onChange={(event) => setDays(event.target.value)} {...leave} />
        </label>
        <p className="text-xs text-muted-foreground sm:col-span-3">Timpriset förifylls på arbete i offerter och i fakturaunderlag (tiden från färdigställda arbetsordrar).</p>
      </div>
      <div className="field-group grid gap-4 rounded-lg border p-3 sm:grid-cols-3" data-testid="price-settings-rot">
        <label className="space-y-1.5 text-xs font-medium text-muted-foreground">ROT-andel av arbetskostnaden (%)
          <Input inputMode="decimal" value={settings.rotPercent} aria-invalid={badRotPercent || undefined} onChange={(event) => setSettings({ ...settings, rotPercent: event.target.value })} {...leave} data-testid="price-settings-rot-percent" />
        </label>
        <label className="space-y-1.5 text-xs font-medium text-muted-foreground">Tak för ROT-avdrag per offert (kr)
          <Input inputMode="decimal" value={settings.rotCap} aria-invalid={badRotCap || undefined} onChange={(event) => setSettings({ ...settings, rotCap: event.target.value })} {...leave} data-testid="price-settings-rot-cap" />
        </label>
        <p className="text-xs text-muted-foreground sm:self-end">Förval för offerter till privatpersoner. Det går att ändra i varje offert. Ni ansvarar själva för att andel och tak stämmer.</p>
      </div>
      {problems.length ? <p role="alert" className="text-xs text-destructive" data-testid="price-settings-problems">{problems.join(" ")} Ändringen sparas när värdet går att läsa.</p> : null}
      <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">Era villkor i offerter
        <textarea className="form-textarea min-h-28" maxLength={QUOTE_TERMS_MAX} value={settings.terms} onChange={(event) => setSettings({ ...settings, terms: event.target.value })} onBlur={commit} placeholder="Skriv era egna villkor, till exempel betalningsvillkor." />
        <span className="block font-normal">Förifylls i nya offerter. Workflow lägger inte till några villkor.</span>
      </label>
      {/* Offert per e-post (steg E, 2026-10-09): the standard text in "Skicka till kund", editable each time. */}
      <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">Meddelande i e-post med offert
        <textarea className="form-textarea min-h-20" maxLength={2000} value={settings.emailMessage} onChange={(event) => setSettings({ ...settings, emailMessage: event.target.value })} onBlur={commit} placeholder="Till exempel: Hej! Här kommer offerten vi pratade om." data-testid="price-settings-email-message" />
        <span className="block font-normal">Förifylls när offerten skickas till kunden och kan ändras varje gång. Kunden får en länk där offerten kan accepteras eller avböjas.</span>
      </label>
      <p className="text-xs text-muted-foreground">Priser och påslag syns bara för administratörer och den som har behörigheten Artiklar och priser eller Offerter.</p>
    </div>
  </Panel>{/* Arbetssätt shows Bokföring under its Avancerat (UX-granskningen C4, 2026-10-22): accounting={false} there. */}{accounting ? <div className="mt-5"><AccountingSettingsPanel /></div> : null}</div>;
}
