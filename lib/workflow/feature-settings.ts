import { placeObjectFields } from "./maintenance";

/**
 * Inställningar → Funktioner (2026-10-07): the company's on/off choices on one page, one place per choice. Each
 * is stored in WorkspaceSettings (a column, plain SQL, off when nothing is stored; riskException in its profile JSON, on when nothing
 * is stored) and set by the company's admin with its own action on /api/workspace. "Mät igen" was removed 2026-10-24, Kontor och avdelningar the same day. Pure, so Cloud, Local, the demo and the tests share it.
 */
export const FEATURE_KEYS = ["maintenance", "riskException"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureSettings = Record<FeatureKey, boolean>;

export type FeatureDefinition = {
  key: FeatureKey;
  /** The action on /api/workspace that sets it. */
  action: string;
  title: string;
  /** The checkbox's label and a short explanation. */
  label: string;
  text: string;
  /** One line under the switch (UX-granskningen C4, 2026-10-22). */
  short: string;
  /** Meaningful only for a company that keeps its data in serverlagring. */
  cloudOnly: boolean;
};

export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  {
    key: "maintenance", action: "maintenance", title: "Objektdata på platser", label: "Använd objektdata", cloudOnly: false,
    short: "Driftstatus och typskylt på kundernas platser, och vyn Alla objekt.",
    text: "Kundernas platser får objektdata som driftstatus och typskylt, och Kunder får vyn Alla objekt. Allt som redan skrivits finns kvar om det stängs av. Arbetsorderns fält för prioritet, fel och stillestånd finns alltid.",
  },
  {
    key: "riskException", action: "risk_exception", title: "Hoppa över riskbedömning i undantagsfall", label: "Tillåt undantaget", cloudOnly: false,
    short: "Knappen Arbetet är redan utfört i riskbedömningen. Skälet och vem som valde det loggas.",
    text: "Den som får göra riskbedömningen kan ange att arbetet redan är utfört, med ett skäl. Då spärras inte Starta tid och Färdigställ på den arbetsordern, och rapporten visar att riskbedömningen inte gjordes. Undantag som redan är gjorda finns kvar om det stängs av.",
  },
];

/** The settings from what the server or a file holds; anything missing or not a boolean is off, but the exception is on until it is turned off. */
export function featureSettingsOf(source: Partial<Record<FeatureKey, unknown>> | null | undefined): FeatureSettings {
  return { maintenance: source?.maintenance === true, riskException: source?.riskException !== false };
}

export const OBJECT_DATA_OFF = "Objektdata är avstängt för företaget. Slå på det under Inställningar → Arbetssätt.";

/**
 * A place saved while Objektdata is off keeps the object data it has; the fields of the request are left out – all but the
 * type, which is an ordinary field of an object since 2026-10-15 (the tree shows it).
 */
export function withoutObjectData<T extends object>(facility: T): Omit<T, Exclude<keyof typeof placeObjectFields, "objectType">> {
  const copy = { ...facility } as Record<string, unknown>;
  for (const key of Object.keys(placeObjectFields)) if (key !== "objectType") delete copy[key];
  return copy as Omit<T, Exclude<keyof typeof placeObjectFields, "objectType">>;
}
