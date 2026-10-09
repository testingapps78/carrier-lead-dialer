// CSV building for exports: correct quoting, UTF-8 (BOM), and spreadsheet-formula injection defense.

const FORMULA_START = /^[=+\-@\t\r]/;
const PURE_NUMBER = /^[+-]?\d+(\.\d+)?$/;
const PHONE_LIKE = /^\+\d[\d\s().-]*$/;

/**
 * Text that a spreadsheet could run as a formula (starts with = + - @ tab or CR) gets a leading
 * apostrophe so it shows as plain text. Real numbers, and plain numeric strings such as DOT/MC
 * numbers or "+17154882707", are left exactly as they are.
 */
export function neutralizeFormula(s: string): string {
  if (!FORMULA_START.test(s)) return s;
  if (PURE_NUMBER.test(s) || PHONE_LIKE.test(s)) return s;
  return "'" + s;
}

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = neutralizeFormula(String(v));
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: Record<string, unknown>[], headers?: string[]): string {
  const cols = headers ?? (rows.length ? Object.keys(rows[0]) : []);
  if (cols.length === 0) return "";
  const lines = [cols.join(",")];
  for (const row of rows) lines.push(cols.map((h) => csvCell(row[h])).join(","));
  return lines.join("\n");
}

/** Excel needs a byte-order mark to read UTF-8 (accents, non-Latin names) correctly. */
export function withBom(csv: string): string {
  return "\uFEFF" + csv;
}

/**
 * Reads every page of a query (default 1,000 rows each), so an export is never silently cut off at
 * the database's default response limit. Throws if the source errors rather than returning a partial file.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
  maxRows = 200000
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
  throw new Error(`Export is larger than ${maxRows} rows. Narrow it with a date range.`);
}
