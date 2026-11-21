export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Färsk inloggning (2026-10-10): a sensitive change needs a password or code confirmed within ten minutes. The answer
 * carries `reauth: true`, so the client asks for it and repeats the request.
 */
export class ReauthRequired extends ApiError {
  constructor(message = "Bekräfta att det är du med lösenord eller kod innan du ändrar det här.") {
    super(403, message);
  }
}
