"use client";

import { Badge } from "@/components/ui/badge";
import { CheckField, Field } from "@/features/kfid/ui";
import { AZURE_FEATURE_LABEL, AZURE_MODEL_FEATURES, azureModelEuVerified, azureModelPriced } from "@/lib/ai/azure-settings";
import { fromModelForm, type AzureModelForm } from "@/features/ai/azure-model-form";

/**
 * Modellerna bakom EU-leverantören (2026-10-24): per model the provider's price, what it can do, whether processing in the
 * EU is verified and from where, and its limits – data the product owner changes without a code change. A model without a price,
 * or without a verified EU source, is never used: the state above the cards says why.
 * `neverEu` (OpenAI's cards, 2026-11-01: bara Azure räknas som EU): "Inte EU" and no EU fields to fill in.
 */
export function AzureModelCards({ cards, onChange, provider = "Azure OpenAI", testId = "azure-models", neverEu = false }: { cards: AzureModelForm[]; onChange: (next: AzureModelForm) => void; provider?: string; testId?: string; neverEu?: boolean }) {
  if (!cards.length) return null;
  return <div className="@container grid gap-3" data-testid={testId}>
    {cards.map((card) => {
      const parsed = fromModelForm(card);
      const priced = parsed ? azureModelPriced(parsed) : false;
      const eu = !neverEu && azureModelEuVerified(parsed ?? undefined);
      const set = (patch: Partial<AzureModelForm>) => onChange({ ...card, ...patch });
      const id = `${testId}-${card.deployment.replace(/[^A-Za-z0-9-]/g, "-")}`;
      return <section key={card.deployment} className="grid gap-3 rounded-lg border p-4" aria-labelledby={`${id}-title`} data-testid={`${testId === "azure-models" ? "azure-model" : testId}-${card.deployment}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 id={`${id}-title`} className="text-sm font-medium">{provider} · {card.modelName || card.deployment}</h4>
          <span className="flex flex-wrap gap-1.5">
            <Badge variant={priced ? "secondary" : "destructive"} data-testid="azure-model-price-state">{priced ? "Pris inlagt" : "Pris saknas"}</Badge>
            <Badge variant={eu ? "secondary" : "outline"} data-testid="azure-model-eu-state">{neverEu ? "Inte EU" : eu ? "EU verifierad" : "EU ej verifierad"}</Badge>
          </span>
        </div>
        <div className={neverEu ? "grid gap-3 @xl:grid-cols-2" : "grid gap-3 @xl:grid-cols-3"}>
          <Field id={`${id}-name`} label="Modell" value={card.modelName} onChange={(value) => set({ modelName: value })} placeholder={card.deployment} />
          {neverEu ? null : <Field id={`${id}-region`} label="Region" value={card.region} onChange={(value) => set({ region: value })} />}
          <Field id={`${id}-type`} label="Distribution" value={card.deploymentType} onChange={(value) => set({ deploymentType: value })} />
        </div>
        <div className="grid gap-3 @xl:grid-cols-3">
          <Field id={`${id}-input`} label="Pris in" hint="USD / 1 M tokens" value={card.input} onChange={(value) => set({ input: value })} />
          <Field id={`${id}-cached`} label="Pris cache" hint="USD / 1 M tokens" value={card.cached} onChange={(value) => set({ cached: value })} help="Tomt: som pris in." />
          <Field id={`${id}-output`} label="Pris ut" hint="USD / 1 M tokens" value={card.output} onChange={(value) => set({ output: value })} />
        </div>
        <div className="grid gap-3 @xl:grid-cols-[minmax(0,1fr)_12rem]">
          <Field id={`${id}-price-source`} label="Priskälla" value={card.priceSource} onChange={(value) => set({ priceSource: value })} placeholder="Azures prislista, region och distribution" />
          <Field id={`${id}-price-date`} label="Pris gäller från" type="date" value={card.priceSetOn} onChange={(value) => set({ priceSetOn: value })} />
        </div>
        <div className="grid gap-2">
          <p className="field-label text-xs font-medium">Funktioner</p>
          {AZURE_MODEL_FEATURES.map((feature) => <CheckField key={feature} id={`${id}-feature-${feature}`} label={AZURE_FEATURE_LABEL[feature]} checked={card.features.includes(feature)}
            onChange={(on) => set({ features: on ? [...card.features, feature] : card.features.filter((item) => item !== feature) })} />)}
        </div>
        {neverEu ? null : <><CheckField id={`${id}-eu`} label="EU-behandling verifierad" description="Bara med en källa. Det är inte ett GDPR-intyg för hela Workflow." checked={card.euVerified} onChange={(on) => set({ euVerified: on })} testId="azure-model-eu" />
        <Field id={`${id}-eu-source`} label="Källa för EU-behandling" value={card.euSource} onChange={(value) => set({ euSource: value })} /></>}
        <Field id={`${id}-limits`} label="Begränsningar och merkostnader" value={card.limitations} onChange={(value) => set({ limitations: value })} multiline />
      </section>;
    })}
  </div>;
}
