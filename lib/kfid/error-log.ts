// A 500 must be traceable without leaking anything (quality check 2026-10-05): the server log gets a short reference,
// the error's name and code and one cleaned line of its message; the person gets the same reference.

const MAX_LINE = 200;

/** One line of an error message that is safe to log: no e-mail addresses, long numbers, tokens or quoted values. */
export function safeErrorLine(message: string) {
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  // Prisma puts "Invalid `prisma.x.y()` invocation:" first and the cause last; other errors have the cause first.
  const line = (lines.length > 1 && /^Invalid `/.test(lines[0]) ? lines[lines.length - 1] : lines[0]) ?? "";
  return line
    .replace(/[^\s@"'`]+@[^\s@"'`]+\.[^\s@"'`]+/g, "[e-post]")
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, "[nyckel]")
    // Long tokens mixing letters and digits (keys); constraint and column names have no digits and are kept.
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g, "[nyckel]")
    .replace(/\d{6,}/g, "[nummer]")
    .replace(/"(?:[^"\\]|\\.)*"/g, '"…"')
    .replace(/'(?:[^'\\]|\\.)*'/g, "'…'")
    .slice(0, MAX_LINE);
}

/** What failure() logs for an unexpected error, as one record. */
export function errorLogRecord(error: unknown, ref: string) {
  const name = error instanceof Error ? error.name : "Unknown";
  const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : undefined;
  const message = error instanceof Error ? safeErrorLine(error.message) : "";
  return { ref, name, ...(code ? { code } : {}), message };
}

export function errorRef() {
  return globalThis.crypto.randomUUID().slice(0, 8);
}
