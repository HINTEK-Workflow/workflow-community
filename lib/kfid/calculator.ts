export const calculatorModes = {
  power3: "3-fas effekt (P/S/Q)",
  current3: "3-fas ström från effekt",
  ohm: "Ohms lag (U, I, R, P)",
  vdrop3: "Spänningsfall 3-fas",
  energy: "Energiförbrukning och kostnad",
} as const;
export type CalculatorMode = keyof typeof calculatorModes;
type CalcField = {
  key: string;
  label: string;
  default?: string;
  options?: string[];
};
export const calculatorFields: Record<CalculatorMode, CalcField[]> = {
  power3: [
    { key: "u", label: "Spänning U (V)", default: "400" },
    { key: "i", label: "Ström I (A)" },
    { key: "pf", label: "Effektfaktor cos φ", default: "0.9" },
    { key: "eta", label: "Verkningsgrad η", default: "1" },
  ],
  current3: [
    { key: "p", label: "Effekt P (kW)" },
    { key: "u", label: "Spänning U (V)", default: "400" },
    { key: "pf", label: "Effektfaktor cos φ", default: "0.9" },
    { key: "eta", label: "Verkningsgrad η", default: "1" },
  ],
  ohm: [
    { key: "u", label: "Spänning U (V)" },
    { key: "i", label: "Ström I (A)" },
    { key: "r", label: "Resistans R (Ω)" },
  ],
  vdrop3: [
    { key: "l", label: "Längd (m, enkel väg)" },
    { key: "i", label: "Ström I (A)" },
    { key: "a", label: "Area (mm²)" },
    {
      key: "material",
      label: "Material",
      default: "Koppar",
      options: ["Koppar", "Aluminium"],
    },
    { key: "u", label: "Nätspänning U (V)", default: "400" },
  ],
  energy: [
    { key: "p", label: "Effekt (kW)" },
    { key: "hours", label: "Timmar per dag" },
    { key: "days", label: "Antal dagar", default: "30" },
    { key: "price", label: "Elpris (kr/kWh)", default: "1.5" },
  ],
};
export const calculatorDefaults = (mode: CalculatorMode) =>
  Object.fromEntries(
    calculatorFields[mode].map((f) => [f.key, f.default ?? ""]),
  );
export function calculate(mode: CalculatorMode, input: Record<string, string>) {
  const n = (key: string) =>
    input[key]?.trim() ? Number(input[key].replace(",", ".")) : NaN;
  const result: { label: string; value: number; unit: string }[] = [];
  const add = (label: string, value: number, unit: string) =>
    result.push({ label, value, unit });
  let note = "";
  if (mode === "power3" || mode === "current3") {
    const u = n("u"),
      pf = n("pf"),
      eta = n("eta");
    if (!(u > 0 && pf >= 0 && pf <= 1 && eta > 0 && eta <= 1))
      return {
        error:
          "Ange spänning över noll, cos φ mellan 0 och 1 samt verkningsgrad över 0 och högst 1.",
      };
    if (mode === "power3") {
      const i = n("i");
      if (!(i > 0)) return { error: "Ange ström över noll." };
      const s = (Math.sqrt(3) * u * i) / 1000,
        p = s * pf;
      add("Skenbar effekt S", s, "kVA");
      add("Aktiv effekt P (el in)", p, "kW");
      add("Aktiv effekt P (ut)", p * eta, "kW");
      add("Reaktiv effekt Q", Math.sqrt(Math.max(0, s * s - p * p)), "kVAr");
      note = "P = √3 × U × I × cos φ × η.";
    } else {
      const p = n("p");
      if (!(p > 0 && pf > 0))
        return { error: "Ange effekt och effektfaktor över noll." };
      const i = (p * 1000) / (Math.sqrt(3) * u * pf * eta);
      add("Beräknad ström I", i, "A");
      add("Skenbar effekt S", (Math.sqrt(3) * u * i) / 1000, "kVA");
      note = "I = P / (√3 × U × cos φ × η).";
    }
  } else if (mode === "ohm") {
    let u = n("u"),
      i = n("i"),
      r = n("r");
    if ([u, i, r].filter(Number.isFinite).length < 2)
      return { error: "Ange två värden av U, I och R." };
    if (!Number.isFinite(u)) u = i * r;
    else if (!Number.isFinite(i)) i = u / r;
    else if (!Number.isFinite(r)) r = u / i;
    if (
      !(u >= 0 && i >= 0 && r > 0) ||
      Math.abs(u - r * i) > Math.max(0.01, Math.abs(u) * 0.001)
    )
      return { error: "Värdena måste uppfylla U = R × I, med R över noll." };
    add("Spänning U", u, "V");
    add("Ström I", i, "A");
    add("Resistans R", r, "Ω");
    add("Effekt P", u * i, "W");
    note = "U = R × I. P = U × I.";
  } else if (mode === "vdrop3") {
    const l = n("l"),
      i = n("i"),
      a = n("a"),
      u = n("u");
    if (!(l > 0 && i > 0 && a > 0 && u > 0))
      return { error: "Ange längd, ström, area och nätspänning över noll." };
    const rho = input.material === "Aluminium" ? 0.0285 : 0.0175,
      du = (Math.sqrt(3) * i * rho * l) / a;
    add("Spänningsfall ΔU", du, "V");
    add("Spänningsfall", (du / u) * 100, "%");
    add("Spänning vid last", u - du, "V");
    note = `V1:s förenklade resistiva modell för ${input.material?.toLowerCase() || "koppar"}. Ingen temperatur-, reaktans- eller skyddsdimensionering.`;
  } else {
    const p = n("p"),
      h = n("hours"),
      d = n("days"),
      price = n("price");
    if (!(p >= 0 && h >= 0 && h <= 24 && d >= 0 && price >= 0))
      return {
        error: "Ange positiva värden eller noll och högst 24 timmar per dag.",
      };
    const energy = p * h * d;
    add("Energi", energy, "kWh");
    add("Kostnad", energy * price, "kr");
    note = "Energi = effekt × timmar × dagar. Kostnad = energi × elpris.";
  }
  if (result.some((r) => !Number.isFinite(r.value)))
    return { error: "Kontrollera värdena." };
  return { result, note };
}
