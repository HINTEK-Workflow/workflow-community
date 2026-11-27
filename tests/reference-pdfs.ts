import { writeFileSync } from "node:fs";
import { pdfDrawing } from "./helpers/pdf-drawing";
import { REFERENCE_DIR, referenceReports } from "./fixtures/report-references";

/**
 * Writes today's reference PDFs and their drawings (2026-09-27). Run only to lock a deliberately approved look:
 * `npx tsx tests/reference-pdfs.ts [name …]`. Without names every reference is written.
 */
const only = new Set(process.argv.slice(2));
(async () => {
  for (const reference of referenceReports) {
    if (only.size && !only.has(reference.name)) continue;
    const bytes = await reference.render();
    writeFileSync(`${REFERENCE_DIR}/${reference.name}.pdf`, bytes);
    writeFileSync(`${REFERENCE_DIR}/${reference.name}.json`, `${JSON.stringify(await pdfDrawing(bytes))}\n`);
    console.log(`${reference.name}: ${bytes.length} byte`);
  }
})();
