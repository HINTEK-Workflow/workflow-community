"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Example = { label: string; model: string; inputTokens: number; outputTokens: number; providerCostOre: number; formulaCredits: number; chargedCredits: number };
type Settings = { chatMinimumCredits: number; documentMinimumCredits: number; usdSek: number; usdSekSetOn: string; provider: string };
type Data = {
  settings: Settings;
  providers: readonly { id: string; name: string }[];
  limits: { usdSekMin: number; usdSekMax: number };
  formula: { targetGrossMarginPercent: number; creditFloorValueOre: number; usdSek: number };
  examples: Example[];
};

const ore = (value: number) => (value < 100 ? `${value} öre` : `${(value / 100).toFixed(2).replace(".", ",")} kr`);
const decimal = (value: number) => value.toFixed(2).replace(".", ",");
const setOn = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Kostnad per AI-svar (2026-10-01: "en banal fråga kostar 5 krediter – finns det en formel som går att justera?";
 * 2026-10-02: valutakurs och leverantör som valbara inställningar): the formula in words, what typical answers really
 * cost, and what the product owner sets – the AI provider, the exchange rate and the minimum per answer.
 */
export function AiCreditSettingsPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [chat, setChat] = useState(5);
  const [document, setDocument] = useState(5);
  const [rate, setRate] = useState("12,00");
  const [provider, setProvider] = useState("OPENAI");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = (result: Data) => {
    setData(result); setChat(result.settings.chatMinimumCredits); setDocument(result.settings.documentMinimumCredits);
    setRate(decimal(result.settings.usdSek)); setProvider(result.settings.provider);
  };
  useEffect(() => {
    let active = true;
    fetch("/api/superadmin/ai-credit-settings", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).then((result: Data | null) => { if (active && result) load(result); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  if (!data) return null;
  const usdSek = Number(rate.replace(",", ".").replace(/\s/g, ""));
  const rateValid = Number.isFinite(usdSek) && usdSek >= data.limits.usdSekMin && usdSek <= data.limits.usdSekMax;
  const changed = chat !== data.settings.chatMinimumCredits || document !== data.settings.documentMinimumCredits || provider !== data.settings.provider || (rateValid && Math.round(usdSek * 100) !== Math.round(data.settings.usdSek * 100));
  async function save() {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/superadmin/ai-credit-settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatMinimumCredits: chat, documentMinimumCredits: document, usdSek, provider }) });
      const result = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(result.error || "Kunde inte sparas.");
      load(result);
      setNotice("Sparat. Gäller nya AI-svar; tidigare körningar behåller sitt pris.");
    } catch (issue) { setNotice(issue instanceof Error ? issue.message : "Kunde inte sparas."); } finally { setBusy(false); }
  }
  const formula = data.formula;
  return <section className="mt-5 rounded-xl border p-4" data-testid="ai-credit-settings">
    <h3 className="text-sm font-semibold">Kostnad per AI-svar</h3>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">
      Krediter = leverantörens tokenkostnad × {decimal(formula.usdSek)} kr/USD, med {formula.targetGrossMarginPercent} % marginal, delat med kreditens värde {formula.creditFloorValueOre} öre och avrundat uppåt – men aldrig under det lägsta uttaget nedan. Direkta svar ur Workflow och frågor utanför Workflow kostar inget.
    </p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="field-stack">AI-leverantör
        <select className="form-select" value={provider} onChange={(event) => setProvider(event.target.value)} data-testid="ai-provider-choice">
          {data.providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <span className="text-xs font-normal text-muted-foreground">Fler leverantörer läggs till här när de är anslutna.</span>
      </label>
      <label className="field-stack">Valutakurs (kr per USD)
        <Input inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} aria-invalid={!rateValid} data-testid="ai-usd-sek" />
        <span className="text-xs font-normal text-muted-foreground">{rateValid ? `Satt ${setOn.format(new Date(`${data.settings.usdSekSetOn}T00:00:00Z`))}. Gäller tills du ändrar den.` : `Ange en kurs mellan ${data.limits.usdSekMin} och ${data.limits.usdSekMax} kr.`}</span>
      </label>
      <label className="field-stack">Lägsta uttag per chattsvar (krediter)<Input type="number" min={1} max={50} value={chat} onChange={(event) => setChat(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} data-testid="ai-chat-minimum" /></label>
      <label className="field-stack">Lägsta uttag per dokumentanalys och granskning (krediter)<Input type="number" min={1} max={50} value={document} onChange={(event) => setDocument(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} /></label>
    </div>
    <table className="mt-3 w-full text-left text-xs">
      <thead className="text-muted-foreground"><tr><th className="py-1 font-medium">Exempel</th><th className="py-1 font-medium">Leverantörens kostnad</th><th className="py-1 font-medium">Enligt formeln</th><th className="py-1 font-medium">Debiteras</th></tr></thead>
      <tbody>{data.examples.map((example) => <tr key={example.label} className="border-t"><td className="py-1.5">{example.label}<span className="block text-[11px] text-muted-foreground">{example.model}, ~{example.inputTokens + example.outputTokens} tokens</span></td><td>{ore(example.providerCostOre)}</td><td>{example.formulaCredits} kr.</td><td className="font-medium">{example.chargedCredits} kr.</td></tr>)}</tbody>
    </table>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Button type="button" size="sm" disabled={busy || !changed || !rateValid} onClick={() => void save()} data-testid="ai-credit-settings-save">{busy ? <LoaderCircle className="animate-spin" /> : <Save />}Spara</Button>
      {notice ? <span className="text-xs text-muted-foreground" role="status">{notice}</span> : null}
    </div>
  </section>;
}
