import { todayInSweden, type CatalogueHit } from "@/lib/catalogue/snapshot";

/**
 * Sök i prisfilen in the demo (2026-10-11): a handful of invented articles from an invented wholesaler, so the
 * search on a quote's material line can be tried. The names and numbers are made up for the demo and copy nothing from
 * a real price file; Workflow itself only searches the company's own imported price file.
 */
const SUPPLIER = "Demo-Grossist AB";
const SOURCE = "demo-prisfil.xlsx";
type Row = [id: string, articleNo: string, name: string, unit: string, price: number, manufacturerNo?: string];
const ROWS: Row[] = [
  ["demo-art-1", "100201", "Installationskabel 3G1,5 mm² grå", "m", 12.4, "DK-3G15"],
  ["demo-art-2", "100202", "Installationskabel 3G2,5 mm² grå", "m", 18.9, "DK-3G25"],
  ["demo-art-3", "100305", "Kabel 5G2,5 mm² svart", "m", 31.5, "DK-5G25"],
  ["demo-art-4", "200110", "Jordfelsbrytare 2-pol 25 A 30 mA", "st", 412, "DJ-2-25-30"],
  ["demo-art-5", "200144", "Automatsäkring 1-pol 10 A C-kurva", "st", 54, "DA-1-10C"],
  ["demo-art-6", "200145", "Automatsäkring 1-pol 16 A C-kurva", "st", 56, "DA-1-16C"],
  ["demo-art-7", "300020", "Vägguttag 1-vägs jordat, vit", "st", 68, "DU-1J-V"],
  ["demo-art-8", "300077", "Strömbrytare 1-pol, vit", "st", 52, "DS-1-V"],
  ["demo-art-9", "400005", "Elinstallationsrör 16 mm, 3 m", "st", 21, "DR-16"],
  ["demo-art-10", "400120", "Kopplingsdosa utanpåliggande IP44", "st", 33, "DD-IP44"],
];

const hit = ([id, articleNo, name, unit, price, manufacturerArticleNo]: Row): CatalogueHit => ({
  id, name, unit, supplierArticleNo: articleNo, eNumber: "", supplierName: SUPPLIER, manufacturerArticleNo: manufacturerArticleNo ?? "",
  price: { unitPrice: price, priceDate: todayInSweden(), sourceFileName: SOURCE, importId: "demo-import" },
});

/** The articles whose name, article number or manufacturer's number holds every word (like the server's search), at most 20. */
export function searchDemoCatalogue(query: string): { articles: CatalogueHit[]; today: string } {
  const words = query.trim().toLocaleLowerCase("sv-SE").split(/\s+/).filter(Boolean).slice(0, 6);
  const articles = query.trim().length < 2 ? [] : ROWS.filter((row) => words.every((word) => [row[2], row[1], row[5] ?? ""].some((text) => text.toLocaleLowerCase("sv-SE").includes(word)))).slice(0, 20).map(hit);
  return { articles, today: todayInSweden() };
}
