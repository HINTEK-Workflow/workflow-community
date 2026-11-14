import { formatSwedish } from "./swedish-time";

/**
 * How a legal document's version is told in the lists (2026-10-07: "Gäller från <datum> · version N" instead of
 * the raw version string). A published version is named after its day and a running number for that day –
 * "2026-10-06.1" – so the text is built from the day it applies from (the document's own start date when it has one,
 * otherwise the day in the name) and the number after the dot. A version named in some other way (a test document)
 * is shown as it is, never guessed at.
 */
const VERSION_NAME = /^(\d{4})-(\d{2})-(\d{2})\.(\d{1,3})$/;

type LegalVersionInput = { version: string; validFrom?: string | Date | null };

/** The Swedish date a version applies from, or null when neither the document nor its name tells. */
export function legalVersionDate({ version, validFrom }: LegalVersionInput): string | null {
  if (validFrom) {
    const time = new Date(validFrom);
    if (Number.isFinite(time.getTime())) return formatSwedish(time, { dateStyle: "short" });
  }
  const match = VERSION_NAME.exec(version.trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** "Gäller från 2026-10-06 · version 1"; without any date "Version 1". */
export function legalVersionLabel(input: LegalVersionInput): string {
  const match = VERSION_NAME.exec(input.version.trim());
  const number = match ? String(Number(match[4])) : input.version.trim();
  const date = legalVersionDate(input);
  return date ? `Gäller från ${date} · version ${number}` : `Version ${number}`;
}
