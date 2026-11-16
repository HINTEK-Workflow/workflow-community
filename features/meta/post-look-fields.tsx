"use client";

import { Button } from "@/components/ui/button";
import { Field } from "@/features/kfid/ui";
import { LOGO_PLATES, LOGO_SIZES, LOGO_VARIANTS, POST_TEMPLATES } from "@/lib/meta/text";
import { cn } from "@/lib/utils";

/** Which of the company's logos exist (Företag): the logo itself and its variants. */
export type LogoAvailability = { main: boolean; onDark: boolean; onLight: boolean; black: boolean };
/** `logoPlate` (2026-11-15): box (Ruta) or none (Ingen); missing is Ruta. */
export type PostLook = { template: string; logoVariant: string; logoSize: string; logoPlate: string | null };

/**
 * Mall och logga (2026-11-12, utökad 2026-11-13): the picture's template as a compact grid with the chosen one's description, the
 * logo's variant (Automatiskt picks the one that reads on the template), its size and whether it stands on a plate (Ruta) or
 * straight on the template (Ingen, 2026-11-15). Shared by a post (Inlägg) and Ny serie.
 * `prefix` keeps each place's own test ids (post-template-…, series-template-…).
 */
export function PostLookFields({ value, onChange, logos, prefix, disabled = false }: {
  value: PostLook; onChange: (value: PostLook) => void; logos: LogoAvailability | null; prefix: string; disabled?: boolean;
}) {
  const set = (patch: Partial<PostLook>) => onChange({ ...value, ...patch });
  const variantLabels = Object.fromEntries(LOGO_VARIANTS.map((variant) => [variant.key,
    variant.key === "auto" || !logos || logos[variant.key] ? variant.label : `${variant.label} (saknas)`]));
  const missing = logos && value.logoVariant !== "auto" && !logos[value.logoVariant as keyof LogoAvailability];
  return <>
    <div className="field-stack"><span className="text-xs font-medium" id={`${prefix}-template-label`}>Mall</span>
      <div role="radiogroup" aria-labelledby={`${prefix}-template-label`} aria-describedby={`${prefix}-template-hint`} className="grid grid-cols-3 gap-2 sm:grid-cols-4" data-testid={`${prefix}-templates`}>
        {POST_TEMPLATES.map((template) => <Button key={template.key} type="button" role="radio" aria-checked={value.template === template.key} variant={value.template === template.key ? "secondary" : "outline"} size="sm" disabled={disabled}
          className={cn("w-full min-w-0 justify-center truncate", value.template === template.key && "font-semibold")} title={template.hint} onClick={() => set({ template: template.key })} data-testid={`${prefix}-template-${template.key}`}>{template.label}</Button>)}
      </div>
      <p id={`${prefix}-template-hint`} className="text-xs text-muted-foreground" data-testid={`${prefix}-template-hint`}>{POST_TEMPLATES.find((template) => template.key === value.template)?.hint ?? ""}</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id={`${prefix}-logo-variant`} label="Logga" value={value.logoVariant} onChange={(next) => set({ logoVariant: next })} options={LOGO_VARIANTS.map((variant) => variant.key)} optionLabels={variantLabels} disabled={disabled}
        help={missing ? "Den varianten är inte uppladdad, så logotypen väljs automatiskt. Ladda upp fler varianter under Inställningar → Företag." : value.logoVariant === "auto" ? "Den som syns bäst på mallen." : undefined} />
      <div className="field-stack"><span className="text-xs font-medium" id={`${prefix}-logo-size-label`}>Storlek på logotypen</span>
        <div role="radiogroup" aria-labelledby={`${prefix}-logo-size-label`} className="grid grid-cols-3 gap-2" data-testid={`${prefix}-logo-sizes`}>
          {LOGO_SIZES.map((size) => <Button key={size.key} type="button" role="radio" aria-checked={value.logoSize === size.key} variant={value.logoSize === size.key ? "secondary" : "outline"} size="sm" disabled={disabled}
            className={cn("w-full min-w-0 justify-center", value.logoSize === size.key && "font-semibold")} onClick={() => set({ logoSize: size.key })} data-testid={`${prefix}-logo-size-${size.key}`}>{size.label}</Button>)}
        </div></div>
      <div className="field-stack"><span className="text-xs font-medium" id={`${prefix}-logo-plate-label`}>Bakgrund bakom logotypen</span>
        <div role="radiogroup" aria-labelledby={`${prefix}-logo-plate-label`} className="grid grid-cols-2 gap-2" data-testid={`${prefix}-logo-plates`}>
          {LOGO_PLATES.map((plate) => { const chosen = (value.logoPlate || "box") === plate.key;
            return <Button key={plate.key} type="button" role="radio" aria-checked={chosen} variant={chosen ? "secondary" : "outline"} size="sm" disabled={disabled}
              className={cn("w-full min-w-0 justify-center", chosen && "font-semibold")} onClick={() => set({ logoPlate: plate.key })} data-testid={`${prefix}-logo-plate-${plate.key}`}>{plate.label}</Button>; })}
        </div></div>
    </div>
  </>;
}
