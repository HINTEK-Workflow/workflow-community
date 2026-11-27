export type ProviderEvalFailure = {
  status: 409 | 502 | 503;
  code: string;
  message: string;
};

export function classifyProviderEvalFailure(error: unknown): ProviderEvalFailure | null {
  const candidate = error as {
    status?: unknown;
    headers?: unknown;
    request_id?: unknown;
  };
  const status = typeof candidate?.status === "number" ? candidate.status : null;
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
      message: "OpenAI-projektet saknar åtkomst till någon av modellerna Luna, Terra och Sol.",
    };
  }
  if (status === 429) {
    return {
      status: 503,
      code: "PROVIDER_CAPACITY_OR_BILLING",
      message: "OpenAI-projektets kapacitet, kostnadsgräns eller fakturering stoppade provsviten.",
    };
  }
  if (status !== null && status >= 500) {
    return {
      status: 502,
      code: "PROVIDER_UNAVAILABLE",
      message: "OpenAI var tillfälligt otillgänglig. Försök igen senare.",
    };
  }
  return null;
}
