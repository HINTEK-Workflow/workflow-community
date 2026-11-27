/** A Swedish postal code is kept as "123 45": "12345" and "123  45" are written the same way. Anything else (a foreign code) is left as typed. */
export function normalizePostalCode(value: string) {
  const text = value.trim();
  const match = /^(\d{3})[\s\u00a0]*(\d{2})$/.exec(text);
  return match ? `${match[1]} ${match[2]}` : text;
}
