/**
 * Saves data the page holds as a file (2026-10-28, knappgrupp 4: one blob download instead of a copy in every
 * export). The link is put in the page for the click, as some browsers want, and the temporary address is released
 * after half a minute, when the browser has surely read it.
 */
export function saveBlob(data: Blob | BlobPart | BlobPart[], filename: string, type?: string) {
  const blob = data instanceof Blob ? data : new Blob(Array.isArray(data) ? data : [data], type ? { type } : undefined);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Saves a fetched file under the name the server gave (Content-Disposition, `filename*=UTF-8''…`) or `fallback`. */
export async function saveResponse(response: Response, fallback: string) {
  const name = /filename\*=UTF-8''([^;]+)/i.exec(response.headers.get("Content-Disposition") ?? "")?.[1];
  saveBlob(await response.blob(), name ? decodeURIComponent(name) : fallback);
}
