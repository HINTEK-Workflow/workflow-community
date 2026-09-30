// Serverns nycklar (Daniel 2026-09-29): the keys HINTEK's own server runs with – read from the server environment and
// described only by status. Pure: takes the environment as an argument and never returns a value, a prefix beyond the
// mode, a length or a host. Shown only to a superadmin in HINTEK's own organization.

export const SERVER_KEY_IDS = ["stripe_secret", "stripe_webhook", "openai", "google", "smtp", "integration_keys", "auth"] as const;
export type ServerKeyId = (typeof SERVER_KEY_IDS)[number];

export type ServerKeyEnv = {
  AUTH_SECRET?: string;
  INTEGRATION_KEYS_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
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
  OPENAI_PROCESSING_REGION?: "GLOBAL" | "EU";
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
};

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

export function serverKeyStatuses(source: ServerKeyEnv): ServerKeyStatus[] {
  const stripeMode = stripeKeyMode(source.STRIPE_SECRET_KEY);
  const googleBoth = set(source.GOOGLE_CLIENT_ID) && set(source.GOOGLE_CLIENT_SECRET);
  const googleOne = set(source.GOOGLE_CLIENT_ID) !== set(source.GOOGLE_CLIENT_SECRET);
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
        ? "Livenyckel. Workflow tar bara emot betalningar i sandlådan tills livebetalningar öppnas."
        : "Används för kassan, kundportalen och prisversionerna i Stripe.",
      check: stripeMode === "test" ? "service" : "format",
    },
    {
      id: "stripe_webhook", label: "Stripe – webhookhemlighet", service: "Stripe", variables: ["STRIPE_WEBHOOK_SECRET"],
      configured: set(source.STRIPE_WEBHOOK_SECRET), mode: null,
      formatOk: set(source.STRIPE_WEBHOOK_SECRET) ? /^whsec_[A-Za-z0-9]{16,}$/.test(source.STRIPE_WEBHOOK_SECRET!.trim()) : null,
      switches: [],
      note: "Workflow kontrollerar med den att händelser om betalningar verkligen kommer från Stripe.",
      check: "format",
    },
    {
      id: "openai", label: "OpenAI – API-nyckel", service: "OpenAI", variables: ["OPENAI_API_KEY"],
      configured: set(source.OPENAI_API_KEY), mode: null,
      formatOk: set(source.OPENAI_API_KEY) ? /^sk-[A-Za-z0-9_-]{20,}$/.test(source.OPENAI_API_KEY!.trim()) : null,
      switches: [
        { label: "HINTEK AI", on: Boolean(source.OPENAI_PROVIDER_ENABLED) },
        { label: "Utvärderingsläge", on: Boolean(source.OPENAI_EVAL_ENABLED) },
        { label: "Biträdesavtal bekräftat", on: Boolean(source.OPENAI_DPA_APPROVED) },
        { label: "EU-region", on: source.OPENAI_PROCESSING_REGION === "EU" },
      ],
      note: "AI är pausad; nyckeln kontrolleras bara till formen så att inga anrop görs.",
      check: "format",
    },
    {
      id: "google", label: "Google-inloggning", service: "Google", variables: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      configured: googleBoth, mode: null,
      formatOk: googleOne ? false : googleBoth ? /\.apps\.googleusercontent\.com$/.test(source.GOOGLE_CLIENT_ID!.trim()) : null,
      switches: [],
      note: googleOne ? "Bara det ena av klient-id och klienthemlighet finns – båda behövs." : "Gör det möjligt att logga in med ett verifierat Google-konto.",
      check: "format",
    },
    {
      id: "smtp", label: "E-post (SMTP)", service: "E-post", variables: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"],
      configured: !smtpLocal || smtpCredentials, mode: smtpLocal ? "test" : null,
      formatOk: smtpLocal ? true : smtpCredentials,
      switches: [
        { label: "Inbjudningar skickas", on: Boolean(source.INVITATION_DELIVERY_ENABLED) },
        { label: "Faktura-e-post skickas", on: Boolean(source.BILLING_EMAIL_DELIVERY_ENABLED) },
        { label: "Krypterad anslutning", on: Boolean(source.SMTP_SECURE) },
      ],
      note: smtpLocal ? "Lokal testserver – ingen e-post lämnar datorn." : smtpCredentials ? "Extern e-postserver med inloggning." : "Extern e-postserver utan användarnamn och lösenord.",
      check: "service",
    },
    {
      id: "integration_keys", label: "Kryptering av externa nycklar", service: "Workflow", variables: ["INTEGRATION_KEYS_SECRET"],
      configured: set(source.INTEGRATION_KEYS_SECRET), mode: null,
      formatOk: set(source.INTEGRATION_KEYS_SECRET) ? source.INTEGRATION_KEYS_SECRET!.trim().length >= 32 : null,
      switches: [],
      note: set(source.INTEGRATION_KEYS_SECRET)
        ? "Krypterar företagens externa nycklar under API och MCP. Byts den måste företagen lägga in sina externa nycklar igen."
        : "Saknas – nyckeln härleds ur inloggningshemligheten. Byts den måste företagen lägga in sina externa nycklar igen.",
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
  if (!status.configured && status.formatOk !== false) return { ok: false, message: "Nyckeln saknas i serverns miljö." };
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
