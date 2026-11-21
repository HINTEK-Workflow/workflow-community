import assert from "node:assert/strict";
import { mkdtempSync, openSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { RemoteGeoPackage, RemoteSqlite } from "../lib/map/sqlite-remote";

// node:sqlite (Node 22.5+) builds the test file; the project's Node types predate it.
type Statement = { run: (...values: unknown[]) => unknown };
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as { DatabaseSync: new (file: string) => { exec: (sql: string) => void; prepare: (sql: string) => Statement; close: () => void } };

// Karta (2026-10-04): one tile is read out of a whole-country GeoPackage through byte ranges, never the whole file.
function tileBytes(zoom: number, column: number, row: number) {
  // Sizes from a few bytes to well over a page, so overflow chains are read too.
  const size = 20 + ((zoom * 7919 + column * 104729 + row * 1299709) % 30_000);
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (index * 31 + zoom * 7 + column * 13 + row) & 0xff;
  return bytes;
}

function makeGeoPackage(file: string, pageSize: number) {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA page_size=${pageSize}; PRAGMA application_id=1196444487;
    CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER);
    CREATE TABLE gpkg_tile_matrix_set (table_name TEXT NOT NULL PRIMARY KEY, srs_id INTEGER NOT NULL, min_x DOUBLE NOT NULL, min_y DOUBLE NOT NULL, max_x DOUBLE NOT NULL, max_y DOUBLE NOT NULL);
    CREATE TABLE gpkg_tile_matrix (table_name TEXT NOT NULL, zoom_level INTEGER NOT NULL, matrix_width INTEGER NOT NULL, matrix_height INTEGER NOT NULL, tile_width INTEGER NOT NULL, tile_height INTEGER NOT NULL, pixel_x_size DOUBLE NOT NULL, pixel_y_size DOUBLE NOT NULL, CONSTRAINT pk_ttm PRIMARY KEY (table_name, zoom_level));
    CREATE TABLE "topowebb" (id INTEGER PRIMARY KEY AUTOINCREMENT, zoom_level INTEGER NOT NULL, tile_column INTEGER NOT NULL, tile_row INTEGER NOT NULL, tile_data BLOB NOT NULL, UNIQUE (zoom_level, tile_column, tile_row));`);
  db.prepare("INSERT INTO gpkg_contents (table_name, data_type, identifier, srs_id) VALUES ('topowebb', 'tiles', 'topowebb', 3857)").run();
  db.prepare("INSERT INTO gpkg_tile_matrix_set VALUES ('topowebb', 3857, -20037508.342789244, -20037508.342789244, 20037508.342789244, 20037508.342789244)").run();
  const matrix = db.prepare("INSERT INTO gpkg_tile_matrix VALUES ('topowebb', ?, ?, ?, 256, 256, ?, ?)");
  const insert = db.prepare("INSERT INTO topowebb (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)");
  db.exec("BEGIN");
  for (let zoom = 0; zoom <= 6; zoom += 1) {
    const width = 2 ** zoom;
    matrix.run(zoom, width, width, 156543.03 / width, 156543.03 / width);
    // Shuffled inserts, so table and index pages are not in key order on disk.
    const cells: [number, number][] = [];
    for (let column = 0; column < width; column += 1) for (let row = 0; row < width; row += 1) if ((column + row) % 5 !== 3) cells.push([column, row]);
    cells.sort((a, b) => ((a[0] * 7 + a[1] * 13) % 17) - ((b[0] * 7 + b[1] * 13) % 17));
    for (const [column, row] of cells) insert.run(zoom, column, row, tileBytes(zoom, column, row));
  }
  db.exec("COMMIT");
  db.close();
}

for (const pageSize of [4096, 65536]) {
  test(`tiles come out of a GeoPackage read by byte ranges (page size ${pageSize})`, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wf-gpkg-"));
    const file = path.join(dir, "topowebb-3857.gpkg");
    try {
      makeGeoPackage(file, pageSize);
      const fd = openSync(file, "r");
      let bytesRead = 0;
      const reader = async (offset: number, length: number) => {
        const buffer = Buffer.alloc(length);
        const count = readSync(fd, buffer, 0, length, offset);
        bytesRead += count;
        return new Uint8Array(buffer.subarray(0, count));
      };
      const gpkg = new RemoteGeoPackage(new RemoteSqlite(reader));
      const set = await gpkg.tileSet();
      assert.equal(set.table, "topowebb");
      assert.equal(set.srsId, 3857);
      assert.deepEqual(set.matrices.map((matrix) => matrix.zoom), [0, 1, 2, 3, 4, 5, 6]);
      assert.equal(set.matrices[6].width, 64);
      for (const [zoom, column, row] of [[0, 0, 0], [3, 5, 2], [6, 0, 0], [6, 63, 63], [6, 40, 17], [5, 31, 0], [4, 9, 11]] as const) {
        assert.deepEqual(await gpkg.tile(zoom, column, row), tileBytes(zoom, column, row), `tile ${zoom}/${column}/${row}`);
      }
      // A tile that is not in the file (the pattern leaves some out) and one outside the pyramid.
      assert.equal(await gpkg.tile(6, 1, 2), null);
      assert.equal(await gpkg.tile(9, 0, 0), null);
      const before = bytesRead;
      await gpkg.tile(6, 12, 30);
      assert.ok(bytesRead - before < 1_000_000, "one tile reads a small part of the file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("column names: the table definitions of Lantmäteriet's file keep the specification's comments and nested defaults (2026-10-07)", async () => {
  const { columnNames } = await import("../lib/map/sqlite-remote");
  const sql = `CREATE TABLE gpkg_contents (
  table_name TEXT NOT NULL PRIMARY KEY, -- The name of the actual content (e.g., tiles) table, SHALL be unique
  data_type TEXT NOT NULL, -- Type of data stored in the table: "features" per clause Features, "tiles" per clause Tiles
  identifier TEXT UNIQUE, /* a human-readable identifier, (short) */
  description TEXT DEFAULT '', -- a human-readable description, if any
  last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE,
  srs_id INTEGER, -- Spatial Reference System ID: gpkg_spatial_ref_sys.srs_id
  CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id))`;
  assert.deepEqual(columnNames(sql), ["table_name", "data_type", "identifier", "description", "last_change", "min_x", "min_y", "max_x", "max_y", "srs_id"]);
  assert.deepEqual(columnNames(`CREATE TABLE "t" ("a b" TEXT, [c] INTEGER, d TEXT DEFAULT 'x, -- not a comment')`), ["a b", "c", "d"]);
});
