/**
 * Alias för grunduppgifter (2026-10-01: "grunduppgifter ska ersättas med alias, så att namn, plats och adress
 * inte skickas direkt till AI:n"). Everything that goes to the AI provider passes through one alias map: the names of
 * projects, customers, people, facilities and places that Workflow itself sends become placeholders such as
 * "[Kund 1]", and e-mail addresses, phone numbers, personal and organisation numbers, postal codes and street
 * addresses are replaced by pattern wherever they occur – also in what the person typed. The answer is turned back
 * with the same map before anyone sees it, so the person reads the real names while the provider never got them.
 * Pure: no database, no provider.
 */

export type AliasKind = "Projekt" | "Kund" | "Person" | "Anläggning" | "Plats" | "Adress" | "E-post" | "Telefon" | "Nummer" | "Postnummer" | "Uppgift";

// JavaScript's \b does not see å, ä and ö as letters, so the edges are written as look-arounds.
const START = "(?<![\\p{L}\\p{N}])";
const END = "(?![\\p{L}\\p{N}])";
const PATTERNS: { kind: AliasKind; pattern: RegExp }[] = [
  { kind: "E-post", pattern: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu },
  // Personal and organisation numbers (ÅÅMMDD-NNNN, ÅÅÅÅMMDD-NNNN, NNNNNN-NNNN).
  { kind: "Nummer", pattern: new RegExp(`${START}(?:\\d{2})?\\d{6}[-+]\\d{4}${END}`, "gu") },
  // Swedish phone numbers: 070-123 45 67, +46 70 123 45 67, 08-123 456 78.
  { kind: "Telefon", pattern: new RegExp(`(?:\\+46[\\s-]?|${START}0)\\d{1,3}[\\s-]?\\d{2,3}[\\s-]?\\d{2}[\\s-]?\\d{2,3}${END}`, "gu") },
  // A street with its number: Storgatan 12, Elvägen 4B, Södra Allén 3 (common Swedish street endings).
  { kind: "Adress", pattern: new RegExp(`${START}\\p{Lu}[\\p{L}-]*(?:\\s\\p{Lu}[\\p{L}-]*)?(?:gatan|vägen|väg|gränd|torget|torg|allén|allé|stigen|backen|leden|gata|parken|kajen|platsen|liden|strand)\\s\\d{1,4}(?:\\s?[A-Za-z])?${END}`, "gu") },
  // Postal code with a space (123 45), or five digits followed by the town (12345 Växjö).
  { kind: "Postnummer", pattern: new RegExp(`${START}(?:\\d{3}\\s\\d{2}(?:\\s\\p{Lu}[\\p{L}-]+)?|\\d{5}\\s\\p{Lu}[\\p{L}-]+)${END}`, "gu") },
];

export class AliasMap {
  private byValue = new Map<string, string>();
  private byAlias = new Map<string, string>();
  private counters = new Map<AliasKind, number>();

  /** Registers a known value (a project's name, a customer's address) and returns its placeholder. */
  add(kind: AliasKind, value: string | null | undefined): string {
    const clean = (value ?? "").replace(/\s+/g, " ").trim();
    if (clean.length < 2) return clean;
    const key = clean.toLocaleLowerCase("sv");
    const existing = this.byValue.get(key);
    if (existing) return existing;
    const next = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, next);
    const alias = `[${kind} ${next}]`;
    this.byValue.set(key, alias);
    this.byAlias.set(alias, clean);
    return alias;
  }

  /** Replaces every registered value and every pattern in a text. Longer values first, so "Elvägen 4" wins over "Elvägen". */
  text(input: string | null | undefined): string {
    let output = input ?? "";
    if (!output) return output;
    const values = [...this.byValue.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [value, alias] of values) {
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      output = output.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), alias);
    }
    for (const { kind, pattern } of PATTERNS) output = output.replace(pattern, (match) => (/^\[.+ \d+\]$/.test(match) ? match : this.add(kind, match)));
    return output;
  }

  /** The answer back with the real values (placeholders the model invented are left as they are). */
  restore(input: string): string {
    return input.replace(/\[(Projekt|Kund|Person|Anläggning|Plats|Adress|E-post|Telefon|Nummer|Postnummer|Uppgift) \d+\]/g, (alias) => this.byAlias.get(alias) ?? alias);
  }

  /** Every string in a JSON-like value, aliased (keys are kept). */
  deep<T>(value: T): T {
    if (typeof value === "string") return this.text(value) as T;
    if (Array.isArray(value)) return value.map((item) => this.deep(item)) as T;
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.deep(item)])) as T;
    return value;
  }

  get size() { return this.byAlias.size; }
}

/** The instruction that tells the model what the placeholders are. */
export const ALIAS_INSTRUCTION = "Namn, platser, adresser, e-post, telefonnummer och liknande är ersatta med platshållare i hakparentes, till exempel [Kund 1] eller [Adress 2]. Använd platshållarna oförändrade när du syftar på dem och försök aldrig gissa vad de står för.";

/**
 * A free text (a report, a letter) where labelled lines name people and places: "Kund: …", "Adress: …",
 * "Beställare: …". The value after such a label is aliased as a whole; the patterns handle the rest.
 */
export function aliasLabelledLines(map: AliasMap, text: string): string {
  const labels: [RegExp, AliasKind][] = [
    [/^(\s*(?:kund|beställare|bestallare|kundnamn|uppdragsgivare|fastighetsägare|företag)\s*[:：]\s*)(.+)$/gimu, "Kund"],
    [/^(\s*(?:kontakt|kontaktperson|namn|elinstallatör|installatör|utförd av|utfört av|kontrollant|kontrollerad av|ansvarig|projektledare|montör|signerad av|godkänd av|tekniker)\s*[:：]\s*)(.+)$/gimu, "Person"],
    [/^(\s*(?:adress|gatuadress|besöksadress|leveransadress|fakturaadress)\s*[:：]\s*)(.+)$/gimu, "Adress"],
    [/^(\s*(?:ort|stad|plats|arbetsplats|anläggning|objekt|fastighet|fastighetsbeteckning)\s*[:：]\s*)(.+)$/gimu, "Plats"],
    [/^(\s*(?:projekt|projektnamn)\s*[:：]\s*)(.+)$/gimu, "Projekt"],
  ];
  let output = text;
  for (const [pattern, kind] of labels) output = output.replace(pattern, (_, label: string, value: string) => `${label}${map.add(kind, value.trim().slice(0, 120))}`);
  return map.text(output);
}
