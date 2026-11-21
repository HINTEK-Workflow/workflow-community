// Serverns nycklar (2026-09-29): the keys Workflow's own server runs with – Stripe and Google entered in the app or
// read from the server environment (2026-10-09, server-secret-values.ts), the rest from the environment – and
// described only by status. Pure: takes the environment as an argument and never returns a value, a prefix beyond the
// mode, a length or a host. Shown only to a superadmin in Workflow's own organization.

import type { ServerSecretField } from "@/lib/integrations/server-secret-values";
import { WHOLESALER_LABELS } from "@/lib/wholesale/model";

export const SERVER_KEY_IDS = ["stripe_secret", "stripe_webhook", "openai", "google", "solar", "ahlsell", "rexel", "sonepar", "smtp", "integration_keys", "auth"] as const;
export type ServerKeyId = (typeof SERVER_KEY_IDS)[number];

export type ServerKeyEnv = {
  AUTH_SECRET?: string;
  INTEGRATION_KEYS_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SOLAR_CLIENT_ID?: string;
  SOLAR_CLIENT_SECRET?: string;
  SMTP_HOST?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_SECURE?: boolean;
  INVITATION_DELIVERY_ENABLED?: boolean;
  BILLING_EMAIL_DELIVERY_ENABLED?: boolean;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_SANDBOX_ENABLED?: boolean;
  STRIPE_CHECKOUT_ENABLED?: boolean;
  STRIPE_PORTAL_ENABLED?: boolean;
  STRIPE_CARD_RETRY_ENABLED?: boolean;
  OPENAI_API_KEY?: string;
  OPENAI_PROVIDER_ENABLED?: boolean;
  OPENAI_EVAL_ENABLED?: boolean;
  OPENAI_DPA_APPROVED?: boolean;
};

export type ServerKeyStatus = {
  id: ServerKeyId;
  label: string;
  service: string;
  /** Environment variable names – names only, never values. */
  variables: string[];
  configured: boolean;
  /** Test or live, when the key itself tells (Stripe). */
  mode: "test" | "live" | null;
  /** Whether the value has the shape the service uses; null when nothing is configured. */
  formatOk: boolean | null;
  switches: { label: string; on: boolean }[];
  note: string;
  /** "service" asks the service itself without showing the key; "format" only checks the shape. */
  check: "service" | "format";
  /** Where the value that applies comes from (2026-10-09): entered in the app, the server's environment, or none. */
  source?: "app" | "server" | null;
  /**
   * Where the app's value is kept (2026-10-25, lib/secrets/central-store.ts): "vault" = in the key vault with the sealed
   * copy here, "local" = sealed here only, "legacy" = still in its place from before 2026-10-25; null = nothing in the app.
   */
  storage?: "vault" | "local" | "legacy" | null;
  /** The keys that can be entered for this row under Servernycklar (Stripe, Google); only whether each is in place. */
  fields?: { id: ServerSecretField; label: string; stored: boolean }[];
  /** Plain settings beside the keys (Solar's catalogue number, 2026-10-14): shown as they are, "" when not set. */
  settings?: { id: "solarCatalogId"; label: string; value: string; help: string }[];
  /**
   * Solar's catalogue beside the key (2026-10-15): the country code the latest check found ("" when none yet) and the
   * categories kept in the global table – how many and when they were fetched.
   */
  solarCatalog?: { countryCode: string; categories: number; fetchedAt: string | null };
  /**
   * Det gemensamma artikelregistret (2026-10-17): how many articles of Solar's catalogue every company searches, when the
   * latest full import and sync ran, whether a full import is asked for or running, and the latest run in plain words.
   */
  solarRegister?: SolarRegisterStatus;
  /**
   * Av/på för tjänsten från kortet (2026-10-17), bara där det finns en tydlig betydelse: Solar (katalogimporten), Google
   * (knappen Fortsätt med Google) och Workflow AI. Samma inställning som på sidan där den ändras; "av" tar inte bort nyckeln.
   */
  serviceSwitch?: { service: "solar" | "google" | "openai"; on: boolean; label: string; help: string };
  /** When what is set on the card was last saved, under Mer (2026-11-01). */
  changed?: { at: string; by: string | null };
  /** Grossisternas API (2026-10-17): a wholesaler whose API is prepared but not connected (no documented API yet) – shown as such, never "missing". */
  prepared?: boolean;
};

export type SolarRegisterStatus = {
  articles: number; obsolete: number; apiEnabled: boolean; lastFullAt: string | null; syncedFrom: string | null; requested: string | null;
  running: { kind: string | null; startedAt: string | null; pages: number; written: number; cancelling: boolean } | null;
  /** What the latest complete full import wrote: the progress bar's total (null before the first). */
  knownTotal: number | null;
  lastRun: RegisterRunView | null;
  history: RegisterRunView[];
};
export type RegisterRunView = { kind: string; ok: boolean; message: string; startedAt: string; finishedAt: string; written?: number; trial?: boolean; cancelled?: boolean };

const DEVELOPMENT_AUTH_SECRETS = new Set([
  "change-this-development-auth-secret-32-characters",
  "change-this-to-a-long-random-secret-at-least-32-characters",
]);
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);
const set = (value: string | undefined) => Boolean(value?.trim());

export function stripeKeyMode(value: string | undefined): "test" | "live" | null {
  const match = /^(?:sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/.exec(value?.trim() ?? "");
  return match ? (match[1] as "test" | "live") : null;
}

/** The payment keys: part of the installation only where it takes payment (features.billing). */
export const BILLING_KEY_IDS: readonly ServerKeyId[] = ["stripe_secret", "stripe_webhook"];

/**
 * The rows of Tjänster och nycklar; without billing the payment keys are not there at all (Community, 2026-11-02). Without `openai`
 * (Cloud, 2026-11-21, F11: Workflow AI runs only on Azure) the OpenAI key's card is gone; Community keeps it.
 */
export function serverKeyStatuses(source: ServerKeyEnv, { billing = true, openai = true }: { billing?: boolean; openai?: boolean } = {}): ServerKeyStatus[] {
  const rows = allServerKeyStatuses(source).filter((row) => openai || row.id !== "openai");
  return billing ? rows : rows.filter((row) => !BILLING_KEY_IDS.includes(row.id));
}

function allServerKeyStatuses(source: ServerKeyEnv): ServerKeyStatus[] {
  const stripeMode = stripeKeyMode(source.STRIPE_SECRET_KEY);
  const googleBoth = set(source.GOOGLE_CLIENT_ID) && set(source.GOOGLE_CLIENT_SECRET);
  const googleOne = set(source.GOOGLE_CLIENT_ID) !== set(source.GOOGLE_CLIENT_SECRET);
  const solarBoth = set(source.SOLAR_CLIENT_ID) && set(source.SOLAR_CLIENT_SECRET);
  const solarOne = set(source.SOLAR_CLIENT_ID) !== set(source.SOLAR_CLIENT_SECRET);
  const smtpLocal = LOOPBACK.has(source.SMTP_HOST?.trim().toLowerCase() ?? "localhost");
  const smtpCredentials = set(source.SMTP_USER) && set(source.SMTP_PASS);
  const authDevelopment = !set(source.AUTH_SECRET) || DEVELOPMENT_AUTH_SECRETS.has(source.AUTH_SECRET!.trim());
  return [
    {
      id: "stripe_secret", label: "Stripe – hemlig nyckel", service: "Stripe", variables: ["STRIPE_SECRET_KEY"],
      configured: set(source.STRIPE_SECRET_KEY), mode: stripeMode,
      formatOk: set(source.STRIPE_SECRET_KEY) ? stripeMode !== null : null,
      switches: [
        { label: "Sandlåda", on: Boolean(source.STRIPE_SANDBOX_ENABLED) },
        { label: "Kassa", on: Boolean(source.STRIPE_CHECKOUT_ENABLED) },
        { label: "Kundportal", on: Boolean(source.STRIPE_PORTAL_ENABLED) },
        { label: "Nya kortförsök", on: Boolean(source.STRIPE_CARD_RETRY_ENABLED) },
      ],
      note: stripeMode === "live"
        ? "Livenyckel. Betalningar tas bara emot i sandlådan tills vidare."
        : "Används för kassan och kundportalen.",
      check: stripeMode === "test" ? "service" : "format",
    },
    {
      id: "stripe_webhook", label: "Stripe – webhookhemlighet", service: "Stripe", variables: ["STRIPE_WEBHOOK_SECRET"],
      configured: set(source.STRIPE_WEBHOOK_SECRET), mode: null,
      formatOk: set(source.STRIPE_WEBHOOK_SECRET) ? /^whsec_[A-Za-z0-9]{16,}$/.test(source.STRIPE_WEBHOOK_SECRET!.trim()) : null,
      switches: [],
      note: "Visar att betalningsbesked verkligen kommer från Stripe.",
      check: "format",
    },
    {
      id: "openai", label: "OpenAI – API-nyckel", service: "OpenAI", variables: ["OPENAI_API_KEY"],
      configured: set(source.OPENAI_API_KEY), mode: null,
      formatOk: set(source.OPENAI_API_KEY) ? /^sk-[A-Za-z0-9_-]{20,}$/.test(source.OPENAI_API_KEY!.trim()) : null,
      switches: [
        { label: "Workflow AI", on: Boolean(source.OPENAI_PROVIDER_ENABLED) },
        { label: "Utvärderingsläge", on: Boolean(source.OPENAI_EVAL_ENABLED) },
        { label: "Biträdesavtal bekräftat", on: Boolean(source.OPENAI_DPA_APPROVED) },
      ],
      note: "AI är pausad. Bara nyckelns form kontrolleras.",
      check: "format",
    },
    {
      id: "google", label: "Google-inloggning", service: "Google", variables: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      configured: googleBoth, mode: null,
      formatOk: googleOne ? false : googleBoth ? /\.apps\.googleusercontent\.com$/.test(source.GOOGLE_CLIENT_ID!.trim()) : null,
      switches: [],
      note: googleOne ? "Klient-id eller hemlighet saknas – båda behövs." : "Inloggning med Google-konto.",
      check: "format",
    },
    {
      // Solar (2026-10-13 natt): read only – accounts, articles and stock, never a price and never an order.
      id: "solar", label: "Solar – API (grunddata och lager)", service: "Solar", variables: ["SOLAR_CLIENT_ID", "SOLAR_CLIENT_SECRET"],
      configured: solarBoth, mode: null,
      formatOk: solarOne ? false : solarBoth ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source.SOLAR_CLIENT_ID!.trim()) : null,
      switches: [],
      note: solarOne ? "Klient-id eller hemlighet saknas – båda behövs." : "Bara läsning. Kontrollera testar inloggningen mot Solar. Inga priser, inga beställningar.",
      check: "service",
    },
    // Ahlsell, Rexel and Sonepar (2026-10-17): prepared adapters without a documented product API – inactive rows that say so.
    ...(["ahlsell", "rexel", "sonepar"] as const).map((id): ServerKeyStatus => ({
      id, label: `${WHOLESALER_LABELS[id]} – API`, service: WHOLESALER_LABELS[id], variables: [], configured: false, mode: null, formatOk: null, switches: [],
      note: "Inte ansluten. Prisfiler fungerar ändå: raderna läses in som företagets egna.",
      check: "format", prepared: true,
    })),
    {
      id: "smtp", label: "E-post (SMTP)", service: "E-post", variables: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"],
      configured: !smtpLocal || smtpCredentials, mode: smtpLocal ? "test" : null,
      formatOk: smtpLocal ? true : smtpCredentials,
      switches: [
        { label: "Inbjudningar skickas", on: Boolean(source.INVITATION_DELIVERY_ENABLED) },
        { label: "Faktura-e-post skickas", on: Boolean(source.BILLING_EMAIL_DELIVERY_ENABLED) },
        { label: "Krypterad anslutning", on: Boolean(source.SMTP_SECURE) },
      ],
      note: smtpLocal ? "Lokal testserver – ingen e-post lämnar datorn." : smtpCredentials ? "Extern e-postserver med inloggning." : "Extern e-postserver utan inloggning.",
      check: "service",
    },
    {
      id: "integration_keys", label: "Kryptering av externa nycklar", service: "Workflow", variables: ["INTEGRATION_KEYS_SECRET"],
      // Without its own secret it is derived from the sign-in secret and works (2026-10-03: no false alarm).
      configured: true, mode: null,
      formatOk: set(source.INTEGRATION_KEYS_SECRET) ? source.INTEGRATION_KEYS_SECRET!.trim().length >= 32 : true,
      switches: [],
      note: set(source.INTEGRATION_KEYS_SECRET)
        ? "Skyddar företagens nycklar. Byts den måste nycklarna läggas in igen."
        : "Fungerar. Byts den måste företagens nycklar läggas in igen.",
      check: "format",
    },
    {
      id: "auth", label: "Inloggningshemlighet", service: "Workflow", variables: ["AUTH_SECRET"],
      configured: !authDevelopment, mode: null,
      formatOk: authDevelopment ? false : source.AUTH_SECRET!.trim().length >= 32,
      switches: [],
      note: authDevelopment ? "Utvecklingsvärdet används – byt före drift." : "Skyddar inloggningssessionerna.",
      check: "format",
    },
  ];
}

/** The plain-language result of a format check – the same words whether it passes or not, never a value. */
export function formatCheckMessage(status: ServerKeyStatus) {
  if (status.prepared) return { ok: false, message: "Inte ansluten – inget att kontrollera." };
  if (!status.configured && status.formatOk !== false) return { ok: false, message: "Inte inlagd." };
  if (status.formatOk) return { ok: true, message: status.mode === "live" ? "Formen stämmer (livenyckel, inget anrop gjordes)." : "Formen stämmer (inget anrop gjordes)." };
  return { ok: false, message: "Värdet har inte den form tjänsten använder." };
}

export const SERVER_KEY_CHECK_ACTION = "server_key_check";
/** Stored in the administration history as `server_key_check:<id>` with "OK: …" or "Fel: …" – never a value. */
export function checkEventDetail(label: string, ok: boolean, message: string) {
  return `${ok ? "OK" : "Fel"}: ${label} — ${message}`;
}
export function parseCheckEvent(action: string, detail: string, createdAt: Date) {
  const id = action.slice(SERVER_KEY_CHECK_ACTION.length + 1) as ServerKeyId;
  if (!action.startsWith(`${SERVER_KEY_CHECK_ACTION}:`) || !SERVER_KEY_IDS.includes(id)) return null;
  const ok = detail.startsWith("OK: ");
  const message = detail.includes(" — ") ? detail.slice(detail.indexOf(" — ") + 3) : detail;
  return { id, ok, message, at: createdAt.toISOString() };
}
