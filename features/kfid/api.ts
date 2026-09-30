export async function api<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Åtgärden misslyckades.");
  return data;
}
export const action = <T = Record<string, unknown>>(input: unknown) =>
  api<T>("/api/workspace", { method: "POST", body: JSON.stringify(input) });
