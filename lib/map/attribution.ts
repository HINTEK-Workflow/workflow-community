/**
 * Källangivelse for the map (2026-10-04), as Lantmäteriet's terms for open data under CC BY 4.0 ask (DNR
 * LM2026/077164, version 1.0): the name of the data, "©Lantmäteriet", whether it has been changed, and the licence with
 * a link to it. Shown at every map, and in reports and printouts where a map appears. The tiles are shown unchanged;
 * Workflow only draws its own pins on top, which is said too.
 */
export const MAP_LAYERS = ["topowebb", "topowebb_nedtonad"] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];
export const MAP_LAYER_LABELS: Record<MapLayer, string> = { topowebb: "Färg", topowebb_nedtonad: "Nedtonad (gråskala)" };
export type MapStatus = { enabled: boolean; layer: MapLayer; minZoom: number; maxZoom: number };

export const MAP_SOURCE_NAME = "Topografisk webbkarta Nedladdning, raster";
export const MAP_LICENSE = "CC BY 4.0";
export const MAP_LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
export const MAP_ATTRIBUTION_TEXT = `${MAP_SOURCE_NAME} ©Lantmäteriet, ${MAP_LICENSE}. Kartbilderna visas oförändrade; kartnålarna är tillagda i Workflow.`;

/**
 * Källangivelse for the address lookup (2026-10-08): Belägenhetsadress Direkt is a separate product from the map,
 * under its own terms (värdefulla datamängder med personuppgifter) but the same licence. Shown under every proposal and
 * wherever an address fetched from it is presented as such. Workflow shows the address unchanged, composed into one line.
 */
export const ADDRESS_SOURCE_NAME = "Belägenhetsadress Direkt";
export const ADDRESS_ATTRIBUTION_TEXT = `${ADDRESS_SOURCE_NAME} ©Lantmäteriet, ${MAP_LICENSE}.`;
