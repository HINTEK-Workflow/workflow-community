export type ProviderEvalFailure = {
  status: 409 | 502 | 503;
  code: string;
  message: string;
};

export function classifyProviderEvalFailure(error: unknown): ProviderEvalFailure | null {
  const candidate = error as {
    status?: unknown;
    message?: unknown;
    headers?: unknown;
    request_id?: unknown;
  };
  const status = typeof candidate?.status === "number" ? candidate.status : null;
  const message = typeof candidate?.message === "string" ? candidate.message : "";
  if (status === 401 && /geography restrictions enabled/i.test(message)) {
    return {
      status: 409,
      code: "EU_GEOGRAPHY_NOT_ENABLED",
      message:
        "OpenAI-projektet saknar aktiverad EU geography restriction. Aktivera EU Data Residency/Regional Processing för projektet innan evalen körs igen.",
    };
  }
  const isProviderError = Boolean(candidate?.headers) || typeof candidate?.request_id === "string";
  if (!isProviderError) return null;
  if (status === 401) {
    return {
      status: 409,
      code: "PROVIDER_AUTHENTICATION_FAILED",
      message: "OpenAI API-nyckeln kunde inte autentiseras för det valda projektet.",
    };
  }
  if (status === 403 || status === 404) {
    return {
      status: 409,
      code: "PROVIDER_ACCESS_MISSING",
      message: "OpenAI-projektet saknar åtkomst till EU-endpointen eller någon av modellerna Luna, Terra och Sol.",
    };
  }
  if (status === 429) {
    return {
      status: 503,
      code: "PROVIDER_CAPACITY_OR_BILLING",
      message: "OpenAI-projektets kapacitet, kostnadsgräns eller fakturering stoppade provider-evalen.",
    };
  }
  if (status !== null && status >= 500) {
    return {
      status: 502,
      code: "PROVIDER_UNAVAILABLE",
      message: "OpenAI EU-endpointen var tillfälligt otillgänglig. Försök igen senare.",
    };
  }
  return null;
}
