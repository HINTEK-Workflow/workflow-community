import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { ApiError, checkOrigin, context, failure } from "@/lib/kfid/server";
import { requireFormAdmin } from "@/lib/kfid/form-server";
import { IMPORT_COLUMNS, IMPORT_EXAMPLE, importColumn, importControlPoints } from "@/lib/workflow/form-import";

export const dynamic = "force-dynamic";
const MAX_BYTES = 2_000_000;
const MAX_ROWS = 1000;

/** The empty import template (xlsx) with the columns and three example rows. For those who build forms. */
export async function GET() {
  try {
    const ctx = await context();
    requireFormAdmin(ctx);
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Kontrollpunkter");
    sheet.columns = IMPORT_COLUMNS.map((key) => ({ header: key, key, width: key === "kontrollpunkt" || key === "instruktion" ? 42 : 16 }));
    sheet.getRow(1).font = { bold: true };
    for (const row of IMPORT_EXAMPLE) sheet.addRow(row);
    const help = book.addWorksheet("Instruktion");
    help.columns = [{ width: 24 }, { width: 90 }];
    for (const line of [
      ["svarstyp", "bedomning (OK / Ej OK / Ej aktuellt), ja_nej, matvarde, text, val, datum_tid"],
      ["valalternativ", "Alternativ med semikolon, för svarstyp val"],
      ["varning_/larm_min/max", "Lämna tomt i en generell mall – värdena sätts per anläggning i protokollets Gränsvärden"],
      ["gransvarde_kalla", "tillverkare, drift_tillsynsprogram, referensvarde, vattendom, dammsakerhetsprogram eller en egen text"],
      ["frekvens", "rond, vecka, manad, kvartal, ar eller vid_behov (skrivs som hjälptext)"],
      ["aktiv", "nej = raden hoppas över"],
    ]) help.addRow(line);
    const bytes = await book.xlsx.writeBuffer();
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=\"kontrollpunkter-mall.xlsx\"", "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

/**
 * Reads control points from an uploaded xlsx or csv and returns them as form sections and limits for the builder to
 * add to the open form. Nothing is stored: the builder saves the draft as usual, and nothing is published.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await context();
    requireFormAdmin(ctx);
    const form = await request.formData();
    const file = form.get("file");
    const taken = new Set(String(form.get("keys") ?? "").split(",").filter(Boolean));
    if (!(file instanceof File) || !file.size) throw new ApiError(400, "Välj en Excel- eller CSV-fil.");
    if (file.size > MAX_BYTES) throw new ApiError(413, "Filen är för stor (högst 2 MB).");
    const book = new ExcelJS.Workbook();
    const buffer = Buffer.from(await file.arrayBuffer());
    const csv = /\.csv$/i.test(file.name) || file.type === "text/csv";
    let grid: string[][] = [];
    if (csv) {
      const text = buffer.toString("utf8").replace(/^﻿/, "");
      const separator = (text.split("\n")[0].match(/;/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
      grid = text.split(/\r?\n/).filter((line) => line.trim()).map((line) => line.split(separator).map((cell) => cell.replace(/^"|"$/g, "").trim()));
    } else {
      try { await book.xlsx.load(buffer as unknown as ArrayBuffer); } catch { throw new ApiError(400, "Filen kunde inte läsas som Excel (xlsx)."); }
      const sheet = book.worksheets.find((item) => /kontrollpunkt/i.test(item.name)) ?? book.worksheets[0];
      if (!sheet) throw new ApiError(400, "Arbetsboken saknar blad.");
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell, index) => { cells[index - 1] = cell.text?.trim() ?? ""; });
        grid.push(cells);
      });
    }
    const [header = [], ...body] = grid;
    const columns = header.map((name) => importColumn(String(name ?? "")));
    if (!columns.includes("kontrollpunkt")) throw new ApiError(422, "Kolumnen kontrollpunkt saknas. Ladda ned mallen för rätt kolumner.");
    if (body.length > MAX_ROWS) throw new ApiError(413, `Högst ${MAX_ROWS} rader kan importeras åt gången.`);
    const rows = body.map((cells) => Object.fromEntries(columns.flatMap((column, index) => column ? [[column, String(cells[index] ?? "")]] : [])));
    return NextResponse.json(importControlPoints(rows, taken));
  } catch (error) {
    return failure(error);
  }
}
