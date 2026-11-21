"use client";

import { useEffect, useState } from "react";
import { Coins, LoaderCircle, Save } from "lucide-react";
import { Panel } from "@/features/kfid/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { quotaKrText, weeklyQuotaOre } from "@/lib/ai/weekly-quota";

type Example = { label: string; model: string; inputTokens: number; outputTokens: number; providerCostOre: number; formulaCredits: number; chargedCredits: number };
type Settings = { chatMinimumCredits: number; documentMinimumCredits: number; usdSek: number; usdSekSetOn: string; provider: string; markupPercent: number; monthlyBudgetKr: number; aiSharePercent: number; weeklyQuotaMinKr: number; weeklyQuotaMaxKr: number };
type Data = {
  settings: Settings;
  providers: readonly { id: string; name: string }[];
  providerChoosable: boolean;
  limits: { usdSekMin: number; usdSekMax: number; markupMin: number; markupMax: number; budgetMax: number; shareMax: number; quotaMax: number };
  formula: { markupPercent: number; creditFloorValueOre: number; usdSek: number };
  examples: Example[];
};

const ore = (value: number) => (value < 100 ? `${value} öre` : `${(value / 100).toFixed(2).replace(".", ",")} kr`);
const decimal = (value: number) => value.toFixed(2).replace(".", ",");
const setOn = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const whole = (value: string, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(value) || 0)));

/**
 * Kostnad per AI-svar (2026-10-01, 2026-10-02, 2026-11-21): ordinary Workflow AI is included in the subscription – no credits,
 * but every run's real cost is in the AI log – so the product owner sets the month's budget (alarms at 50, 80 and 100 %) and the fair
 * use per company (a notice at 80 %, an alarm at 100 %, never a stop). Credits are for the coming agentläge: the provider's cost plus
 * the markup, never below the minimum. The provider for Standard is Azure in Cloud and only shown.
 */
export function AiCreditSettingsPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [chat, setChat] = useState(1);
  const [document, setDocument] = useState(1);
  const [rate, setRate] = useState("12,00");
  const [provider, setProvider] = useState("AZURE_OPENAI");
  const [markup, setMarkup] = useState(100);
  const [budget, setBudget] = useState(500);
  const [share, setShare] = useState(10);
  const [quotaMin, setQuotaMin] = useState(2);
  const [quotaMax, setQuotaMax] = useState(50);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const load = (result: Data) => {
    setData(result); setChat(result.settings.chatMinimumCredits); setDocument(result.settings.documentMinimumCredits);
    setRate(decimal(result.settings.usdSek)); setProvider(result.settings.provider); setMarkup(result.settings.markupPercent);
    setBudget(result.settings.monthlyBudgetKr); setShare(result.settings.aiSharePercent); setQuotaMin(result.settings.weeklyQuotaMinKr); setQuotaMax(result.settings.weeklyQuotaMaxKr);
  };
  useEffect(() => {
    let active = true;
    fetch("/api/superadmin/ai-credit-settings", { cache: "no-store" }).then((response) => (response.ok ? response.json() : null)).then((result: Data | null) => { if (active && result) load(result); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  if (!data) return null;
  const usdSek = Number(rate.replace(",", ".").replace(/\s/g, ""));
  const rateValid = Number.isFinite(usdSek) && usdSek >= data.limits.usdSekMin && usdSek <= data.limits.usdSekMax;
  const saved = data.settings;
  const changed = markup !== saved.markupPercent || chat !== saved.chatMinimumCredits || document !== saved.documentMinimumCredits || provider !== saved.provider
    || budget !== saved.monthlyBudgetKr || share !== saved.aiSharePercent || quotaMin !== saved.weeklyQuotaMinKr || quotaMax !== saved.weeklyQuotaMaxKr || (rateValid && Math.round(usdSek * 100) !== Math.round(saved.usdSek * 100));
  async function save() {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/superadmin/ai-credit-settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatMinimumCredits: chat, documentMinimumCredits: document, usdSek, provider, markupPercent: markup, monthlyBudgetKr: budget, aiSharePercent: share, weeklyQuotaMinKr: quotaMin, weeklyQuotaMaxKr: quotaMax }) });
      const result = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(result.error || "Kunde inte sparas.");
      load(result);
      setNotice("Sparat. Gäller nya AI-svar. Tidigare körningar behåller sitt pris.");
    } catch (issue) { setNotice(issue instanceof Error ? issue.message : "Kunde inte sparas."); } finally { setBusy(false); }
  }
  const formula = data.formula;
  const quotaExample = (monthlyOre: number) => quotaKrText(weeklyQuotaOre({ monthlyPriceOre: monthlyOre, settings: { aiSharePercent: share, weeklyQuotaMinKr: quotaMin, weeklyQuotaMaxKr: quotaMax } }).quotaOre);
  const providerName = data.providers.find((item) => item.id === provider)?.name ?? provider;
  // Its own card (C6, UX-punkt 6): under Priser → Avancerat, not an inner heading in the provider card.
  return <Panel icon={Coins} title="Kostnad per AI-svar" description="Vanliga frågor och förslag ingår i abonnemanget. Här ställer du in budget, veckokvot per företag och vad krediterna kostar."><section data-testid="ai-credit-settings">
    <p className="text-xs leading-5 text-muted-foreground" data-testid="ai-included-text">
      Chatten, förslagen, Skriv och Granska med AI, import och dagsammanställningen drar inga krediter, upp till företagets veckokvot. Varje körning sparas ändå med leverantörens verkliga kostnad i AI-loggen.
    </p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {data.providerChoosable ? <label className="field-stack">Leverantör för Standard
        <select className="form-select" value={provider} onChange={(event) => setProvider(event.target.value)} data-testid="ai-provider-choice">
          {data.providers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label> : <div className="field-stack" data-testid="ai-provider-fixed">Leverantör för Standard<p className="text-sm font-normal">{providerName}</p><span className="text-xs font-normal text-muted-foreground">Workflow AI körs bara på Azure.</span></div>}
      <label className="field-stack">Valutakurs (kr per USD)
        <Input inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} aria-invalid={!rateValid} data-testid="ai-usd-sek" />
        <span className="text-xs font-normal text-muted-foreground">{rateValid ? `Satt ${setOn.format(new Date(`${saved.usdSekSetOn}T00:00:00Z`))}. Gäller tills du ändrar den.` : `Ange en kurs mellan ${data.limits.usdSekMin} och ${data.limits.usdSekMax} kr.`}</span>
      </label>
      <label className="field-stack">Månadsbudget för AI (kr)
        <Input type="number" min={0} max={data.limits.budgetMax} value={budget} onChange={(event) => setBudget(whole(event.target.value, 0, data.limits.budgetMax))} data-testid="ai-monthly-budget" />
        <span className="text-xs font-normal text-muted-foreground">Larm till Mottagare av driftlarm vid 50, 80 och 100 % av månadens AI-kostnad. 0 = inga larm.</span>
      </label>
    </div>
    <h4 className="mt-5 text-sm font-medium">Veckokvot per företag</h4>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">
      Kvoten följer vad företaget betalar: andelen av månadspriset × 12 / 52, inom lägsta och högsta. Ett företag utan pris får den lägsta. Vid 80 % ser företagets admin en varning. Vid 100 % pausas AI-svaren till måndag 00:00, om inte företaget valt att fortsätta med krediter, och du får ett driftlarm. Svar direkt ur Workflow fungerar alltid.
    </p>
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      <label className="field-stack">Andel av abonnemanget till AI (%)
        <Input type="number" min={0} max={data.limits.shareMax} value={share} onChange={(event) => setShare(whole(event.target.value, 0, data.limits.shareMax))} data-testid="ai-share-percent" />
      </label>
      <label className="field-stack">Lägsta veckokvot (kr)
        <Input type="number" min={0} max={data.limits.quotaMax} value={quotaMin} onChange={(event) => setQuotaMin(whole(event.target.value, 0, data.limits.quotaMax))} data-testid="ai-quota-min" />
      </label>
      <label className="field-stack">Högsta veckokvot (kr)
        <Input type="number" min={0} max={data.limits.quotaMax} value={quotaMax} onChange={(event) => setQuotaMax(whole(event.target.value, 0, data.limits.quotaMax))} data-testid="ai-quota-max" />
      </label>
    </div>
    <p className="mt-2 text-xs text-muted-foreground" data-testid="ai-quota-example">Exempel: ett abonnemang på 149 kr i månaden ger {quotaExample(14_900)} i veckan, 499 kr ger {quotaExample(49_900)}.</p>
    <h4 className="mt-5 text-sm font-medium">Krediter</h4>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">
      Krediter används för agentläget (kommer) och när ett företag valt att fortsätta med krediter efter veckans kvot: leverantörens kostnad × {decimal(formula.usdSek)} kr/USD plus {formula.markupPercent} % påslag, delat med kreditens värde {formula.creditFloorValueOre} öre och avrundat uppåt till hela krediter – men aldrig under det lägsta uttaget.
    </p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="field-stack">Påslag (%)
        <Input type="number" min={data.limits.markupMin} max={data.limits.markupMax} value={markup} onChange={(event) => setMarkup(whole(event.target.value, data.limits.markupMin, data.limits.markupMax))} data-testid="ai-markup" />
        <span className="text-xs font-normal text-muted-foreground">På leverantörens kostnad. 100 % betyder att kunden betalar dubbla kostnaden. Ändringen loggas.</span>
      </label>
      <label className="field-stack">Lägsta uttag per chattsvar (krediter)<Input type="number" min={1} max={50} value={chat} onChange={(event) => setChat(whole(event.target.value, 1, 50))} data-testid="ai-chat-minimum" /></label>
      <label className="field-stack">Lägsta uttag per dokumentanalys och granskning (krediter)<Input type="number" min={1} max={50} value={document} onChange={(event) => setDocument(whole(event.target.value, 1, 50))} /></label>
    </div>
    <table className="mt-3 w-full text-left text-xs">
      <thead className="text-muted-foreground"><tr><th className="py-1 font-medium">Exempel</th><th className="py-1 font-medium">Leverantörens kostnad</th><th className="py-1 font-medium">Enligt formeln</th><th className="py-1 font-medium">Med krediter</th></tr></thead>
      <tbody>{data.examples.map((example) => <tr key={example.label} className="border-t"><td className="py-1.5">{example.label}<span className="block text-[11px] text-muted-foreground">{example.model}, ~{example.inputTokens + example.outputTokens} tokens</span></td><td>{ore(example.providerCostOre)}</td><td>{example.formulaCredits} kr.</td><td className="font-medium">{example.chargedCredits} kr.</td></tr>)}</tbody>
    </table>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Button type="button" size="sm" disabled={busy || !changed || !rateValid} onClick={() => void save()} data-testid="ai-credit-settings-save">{busy ? <LoaderCircle className="animate-spin" /> : <Save />}Spara</Button>
      {notice ? <span className="text-xs text-muted-foreground" role="status">{notice}</span> : null}
    </div>
  </section></Panel>;
}
