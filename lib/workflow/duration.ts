/** A reported duration as "H h M min", rounded to the nearest minute: screen, CSV and PDF read the same (simulation 2026-10-02: 7:53 was 8 min on screen and 7 min in the PDF). */
export function formatDurationSeconds(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
