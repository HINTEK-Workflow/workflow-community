import { announce } from "@/lib/workflow/toast";
import { saveBlob } from "@/lib/download";

/**
 * Rapportarkiv (2026-10-07): an export that was asked to keep a copy ("Spara i rapportarkivet") says what became
 * of it in two response headers. The file is downloaded either way; this tells the person whether the copy was kept.
 */
export function announceArchiveResult(headers: Headers, open: () => void) {
  const kept = headers.get("X-Report-Archive");
  const failure = headers.get("X-Report-Archive-Error");
  if (kept) announce("Rapporten är sparad i Rapportarkivet.", false, [{ label: "Öppna Rapportarkivet", run: open }]);
  else if (failure) announce(`Rapporten laddades ner men sparades inte i arkivet: ${decodeURIComponent(failure)}`, true);
}

/** Downloads a response's file the way the export buttons do: a link click on a temporary address. */
export async function downloadResponse(response: Response, filename: string) {
  saveBlob(await response.blob(), filename);
}
