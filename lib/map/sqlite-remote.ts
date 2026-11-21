/**
 * Reads a SQLite database (a GeoPackage) one page at a time through a byte-range reader, so a single tile can be taken
 * from Lantmäteriet's 150 GB file of the whole country without downloading the file (2026-10-04: "hämta bara det
 * som behövs"). Read-only; follows the SQLite file format (SQLite's documented file format, version 3): the b-trees of the
 * schema table, of a table and of an index, record payloads and overflow chains. Pure apart from the reader it is given.
 */
export type RangeReader = (offset: number, length: number) => Promise<Uint8Array>;
export type SqlValue = null | number | bigint | string | Uint8Array;

const decoder = new TextDecoder();
const PAGE_CACHE = 4096;

type BTreePage = { type: number; cells: number[]; rightMost: number; data: Uint8Array; headerOffset: number };

function varint(data: Uint8Array, offset: number): [number, number] {
  let value = BigInt(0);
  for (let index = 0; index < 9; index += 1) {
    const byte = data[offset + index];
    if (index === 8) { value = (value << BigInt(8)) | BigInt(byte); return [Number(value), 9]; }
    value = (value << BigInt(7)) | BigInt(byte & 0x7f);
    if (!(byte & 0x80)) return [Number(value), index + 1];
  }
  return [Number(value), 9];
}
const u16 = (data: Uint8Array, offset: number) => (data[offset] << 8) | data[offset + 1];
const u32 = (data: Uint8Array, offset: number) => ((data[offset] << 24) >>> 0) + (data[offset + 1] << 16) + (data[offset + 2] << 8) + data[offset + 3];

/** A record's values (the record format of SQLite's file format). */
export function decodeRecord(payload: Uint8Array): SqlValue[] {
  const [headerSize, headerLength] = varint(payload, 0);
  const types: number[] = [];
  for (let offset = headerLength; offset < headerSize;) { const [type, length] = varint(payload, offset); types.push(type); offset += length; }
  const values: SqlValue[] = [];
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let offset = headerSize;
  for (const type of types) {
    if (type === 0) values.push(null);
    else if (type >= 1 && type <= 6) {
      const size = [0, 1, 2, 3, 4, 6, 8][type];
      let value = BigInt(0);
      for (let index = 0; index < size; index += 1) value = (value << BigInt(8)) | BigInt(payload[offset + index]);
      if (value >= BigInt(1) << BigInt(size * 8 - 1)) value -= BigInt(1) << BigInt(size * 8);
      values.push(value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value);
      offset += size;
    } else if (type === 7) { values.push(view.getFloat64(offset)); offset += 8; }
    else if (type === 8) values.push(0);
    else if (type === 9) values.push(1);
    else if (type >= 12 && type % 2 === 0) { const size = (type - 12) / 2; values.push(payload.slice(offset, offset + size)); offset += size; }
    else if (type >= 13) { const size = (type - 13) / 2; values.push(decoder.decode(payload.subarray(offset, offset + size))); offset += size; }
    else throw new Error("Okänd posttyp i databasen.");
  }
  return values;
}

/** SQLite's ordering of values in an index: NULL < numbers < text < blobs. */
function compareValues(a: SqlValue, b: SqlValue): number {
  const rank = (value: SqlValue) => value === null ? 0 : typeof value === "number" || typeof value === "bigint" ? 1 : typeof value === "string" ? 2 : 3;
  const difference = rank(a) - rank(b);
  if (difference) return difference;
  if (a === null) return 0;
  if (typeof a === "number" || typeof a === "bigint") return Number(a) < Number(b) ? -1 : Number(a) > Number(b) ? 1 : 0;
  if (typeof a === "string") return a < (b as string) ? -1 : a > (b as string) ? 1 : 0;
  const x = a as Uint8Array, y = b as Uint8Array;
  for (let index = 0; index < Math.min(x.length, y.length); index += 1) if (x[index] !== y[index]) return x[index] - y[index];
  return x.length - y.length;
}

/**
 * The column names of a CREATE TABLE statement, in order. Lantmäteriet's GeoPackage (2026-10-07) keeps the comments of the
 * OGC specification in its table definitions ("-- … SHALL …") and defaults with nested parentheses, so comments are
 * removed first and the definitions are split only at commas on the top level, outside parentheses and quotes.
 */
export function columnNames(sql: string): string[] {
  let text = "";
  for (let index = 0; index < sql.length; index++) {
    const char = sql[index];
    if (char === "-" && sql[index + 1] === "-") { while (index < sql.length && sql[index] !== "\n") index++; text += "\n"; continue; }
    if (char === "/" && sql[index + 1] === "*") { const end = sql.indexOf("*/", index + 2); index = end < 0 ? sql.length : end + 1; text += " "; continue; }
    if (char === "'" || char === "\"" || char === "`" || char === "[") {
      const close = char === "[" ? "]" : char;
      const end = sql.indexOf(close, index + 1);
      text += sql.slice(index, end < 0 ? sql.length : end + 1);
      index = end < 0 ? sql.length : end;
      continue;
    }
    text += char;
  }
  const start = text.indexOf("(");
  const end = text.lastIndexOf(")");
  if (start < 0 || end <= start) return [];
  const body = text.slice(start + 1, end);
  const parts: string[] = [];
  let depth = 0, quote = "", current = "";
  for (const char of body) {
    if (quote) { current += char; if (char === quote) quote = ""; continue; }
    if (char === "'" || char === "\"" || char === "`") { quote = char; current += char; continue; }
    if (char === "[") { quote = "]"; current += char; continue; }
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) { parts.push(current); current = ""; continue; }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => { const trimmed = part.trim(); return /^(["`[])(.*?)["`\]]/.exec(trimmed)?.[2] ?? trimmed.split(/\s+/)[0]; })
    .filter((column) => column && !/^(UNIQUE|PRIMARY|CONSTRAINT|CHECK|FOREIGN)$/i.test(column));
}

export class RemoteSqlite {
  private pageSize = 0;
  private usable = 0;
  private cache = new Map<number, Uint8Array>();
  private schema: { type: string; name: string; tableName: string; rootPage: number; sql: string }[] | null = null;
  /** Pages read from the source, for the check and for tests. */
  requests = 0;

  constructor(private readonly read: RangeReader, private readonly prefetchBytes = 65536) {}
  private get prefetchPages() { return Math.max(1, Math.floor(this.prefetchBytes / this.pageSize)); }

  async open() {
    if (this.pageSize) return this;
    const header = await this.read(0, 100);
    this.requests += 1;
    if (decoder.decode(header.subarray(0, 15)) !== "SQLite format 3") throw new Error("Filen är ingen SQLite-databas (GeoPackage).");
    const size = u16(header, 16);
    this.pageSize = size === 1 ? 65536 : size;
    this.usable = this.pageSize - header[20];
    return this;
  }

  /** One page, with the next few read in the same request: overflow chains and leaves usually lie in a row. */
  private async page(number: number): Promise<Uint8Array> {
    const cached = this.cache.get(number);
    if (cached) { this.cache.delete(number); this.cache.set(number, cached); return cached; }
    const bytes = await this.read((number - 1) * this.pageSize, this.pageSize * this.prefetchPages);
    this.requests += 1;
    for (let index = 0; index < this.prefetchPages && (index + 1) * this.pageSize <= bytes.length; index += 1) {
      this.cache.set(number + index, bytes.subarray(index * this.pageSize, (index + 1) * this.pageSize));
    }
    while (this.cache.size > PAGE_CACHE) this.cache.delete(this.cache.keys().next().value!);
    const page = this.cache.get(number);
    if (!page) throw new Error("Databasen tog slut för tidigt.");
    return page;
  }

  private async btreePage(number: number): Promise<BTreePage> {
    const data = await this.page(number);
    const headerOffset = number === 1 ? 100 : 0;
    const type = data[headerOffset];
    if (![2, 5, 10, 13].includes(type)) throw new Error("Oväntad sidtyp i databasen.");
    const interior = type === 2 || type === 5;
    const count = u16(data, headerOffset + 3);
    const pointers = headerOffset + (interior ? 12 : 8);
    return { type, data, headerOffset, rightMost: interior ? u32(data, headerOffset + 8) : 0, cells: Array.from({ length: count }, (_, index) => u16(data, pointers + index * 2)) };
  }

  /** The whole payload of a cell, following its overflow chain when it does not fit on the page. */
  private async payload(data: Uint8Array, offset: number, size: number, index: boolean): Promise<Uint8Array> {
    const max = index ? Math.floor(((this.usable - 12) * 64) / 255) - 23 : this.usable - 35;
    if (size <= max) return data.subarray(offset, offset + size);
    const min = Math.floor(((this.usable - 12) * 32) / 255) - 23;
    const k = min + ((size - min) % (this.usable - 4));
    const local = k <= max ? k : min;
    const result = new Uint8Array(size);
    result.set(data.subarray(offset, offset + local), 0);
    let written = local;
    let next = u32(data, offset + local);
    while (written < size && next) {
      const page = await this.page(next);
      const take = Math.min(this.usable - 4, size - written);
      result.set(page.subarray(4, 4 + take), written);
      written += take;
      next = u32(page, 0);
    }
    if (written < size) throw new Error("En post i databasen är avbruten.");
    return result;
  }

  /** Every row of a (small) table, in rowid order. */
  async rows(rootPage: number): Promise<{ rowid: number; values: SqlValue[] }[]> {
    const page = await this.btreePage(rootPage);
    if (page.type === 5) {
      const children = [...page.cells.map((cell) => u32(page.data, cell)), page.rightMost];
      return (await Promise.all(children.map((child) => this.rows(child)))).flat();
    }
    if (page.type !== 13) throw new Error("Tabellen är ingen tabell.");
    const rows: { rowid: number; values: SqlValue[] }[] = [];
    for (const cell of page.cells) {
      const [size, a] = varint(page.data, cell);
      const [rowid, b] = varint(page.data, cell + a);
      rows.push({ rowid, values: decodeRecord(await this.payload(page.data, cell + a + b, size, false)) });
    }
    return rows;
  }

  async tables() {
    if (this.schema) return this.schema;
    await this.open();
    this.schema = (await this.rows(1)).map(({ values }) => ({ type: String(values[0]), name: String(values[1]), tableName: String(values[2]), rootPage: Number(values[3]), sql: String(values[4] ?? "") }));
    return this.schema;
  }

  async table(name: string) {
    const entry = (await this.tables()).find((item) => item.type === "table" && item.name === name);
    if (!entry) throw new Error(`Tabellen ${name} finns inte.`);
    const rows = await this.rows(entry.rootPage);
    const columns = columnNames(entry.sql);
    return rows.map(({ rowid, values }) => Object.fromEntries([["rowid", rowid], ...columns.map((column, index) => [column, values[index] ?? null])])) as Record<string, SqlValue>[];
  }

  /** The first index entry equal to `key` (a prefix of the index's columns), returning the whole entry with its rowid. */
  async seekIndex(rootPage: number, key: SqlValue[]): Promise<SqlValue[] | null> {
    let number = rootPage;
    for (let depth = 0; depth < 40; depth += 1) {
      const page = await this.btreePage(number);
      const interior = page.type === 2;
      if (page.type !== 2 && page.type !== 10) throw new Error("Indexet är inget index.");
      let child = page.rightMost;
      for (const cell of page.cells) {
        let offset = cell + (interior ? 4 : 0);
        const [size, length] = varint(page.data, offset);
        offset += length;
        const entry = decodeRecord(await this.payload(page.data, offset, size, true));
        let order = 0;
        for (let index = 0; index < key.length && !order; index += 1) order = compareValues(entry[index], key[index]);
        if (order === 0) return entry;
        if (order > 0) { child = interior ? u32(page.data, cell) : 0; break; }
      }
      if (!interior || !child) return null;
      number = child;
    }
    throw new Error("Indexet är för djupt.");
  }

  /** One row by rowid. */
  async row(rootPage: number, rowid: number): Promise<SqlValue[] | null> {
    let number = rootPage;
    for (let depth = 0; depth < 40; depth += 1) {
      const page = await this.btreePage(number);
      if (page.type === 5) {
        let child = page.rightMost;
        for (const cell of page.cells) {
          const [key] = varint(page.data, cell + 4);
          if (rowid <= key) { child = u32(page.data, cell); break; }
        }
        number = child;
        continue;
      }
      for (const cell of page.cells) {
        const [size, a] = varint(page.data, cell);
        const [id, b] = varint(page.data, cell + a);
        if (id === rowid) return decodeRecord(await this.payload(page.data, cell + a + b, size, false));
      }
      return null;
    }
    throw new Error("Tabellen är för djup.");
  }
}

export type TileMatrix = { zoom: number; width: number; height: number };
export type TileSet = { table: string; srsId: number; minX: number; minY: number; maxX: number; maxY: number; matrices: TileMatrix[] };

/**
 * A GeoPackage's tile pyramid (OGC GeoPackage 1.x, tables gpkg_contents, gpkg_tile_matrix_set and gpkg_tile_matrix) and
 * the reading of one tile through the table's unique index on (zoom_level, tile_column, tile_row).
 */
export class RemoteGeoPackage {
  private set: TileSet | null = null;
  private index: { rootPage: number; tableRoot: number } | null = null;
  constructor(readonly db: RemoteSqlite) {}

  async tileSet(): Promise<TileSet> {
    if (this.set) return this.set;
    const contents = (await this.db.table("gpkg_contents")).filter((row) => row.data_type === "tiles");
    if (!contents.length) throw new Error("GeoPackage-filen har inga kartrutor.");
    const table = String(contents[0].table_name);
    const matrixSet = (await this.db.table("gpkg_tile_matrix_set")).find((row) => row.table_name === table);
    if (!matrixSet) throw new Error("GeoPackage-filen saknar rutnät.");
    const matrices = (await this.db.table("gpkg_tile_matrix")).filter((row) => row.table_name === table)
      .map((row) => ({ zoom: Number(row.zoom_level), width: Number(row.matrix_width), height: Number(row.matrix_height) })).sort((a, b) => a.zoom - b.zoom);
    this.set = { table, srsId: Number(matrixSet.srs_id), minX: Number(matrixSet.min_x), minY: Number(matrixSet.min_y), maxX: Number(matrixSet.max_x), maxY: Number(matrixSet.max_y), matrices };
    return this.set;
  }

  async tile(zoom: number, column: number, row: number): Promise<Uint8Array | null> {
    const set = await this.tileSet();
    if (!this.index) {
      const tables = await this.db.tables();
      const tableEntry = tables.find((item) => item.type === "table" && item.name === set.table);
      // The UNIQUE (zoom_level, tile_column, tile_row) constraint every GeoPackage tile table has.
      const indexEntry = tables.find((item) => item.type === "index" && item.tableName === set.table && (item.name.startsWith("sqlite_autoindex_") || /zoom_level\s*,\s*tile_column\s*,\s*tile_row/i.test(item.sql)));
      if (!tableEntry || !indexEntry) throw new Error("GeoPackage-filen saknar index för kartrutorna.");
      this.index = { rootPage: indexEntry.rootPage, tableRoot: tableEntry.rootPage };
    }
    const entry = await this.db.seekIndex(this.index.rootPage, [zoom, column, row]);
    if (!entry) return null;
    const values = await this.db.row(this.index.tableRoot, Number(entry[entry.length - 1]));
    // id INTEGER PRIMARY KEY is stored as NULL in the record; tile_data is the fifth column.
    const data = values?.[4];
    return data instanceof Uint8Array ? data : null;
  }
}
