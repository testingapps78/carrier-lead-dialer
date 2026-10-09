import test from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv, withBom, neutralizeFormula, fetchAllPages } from "../lib/csv.ts";

test("formula-looking text is neutralized", () => {
  for (const evil of ["=SUM(A1:A9)", "=HYPERLINK(\"http://x\",\"y\")", "+cmd|' /C calc'!A0", "-2+3", "@SUM(1)", "\t=1+1", "\r=1"]) {
    assert.ok(neutralizeFormula(evil).startsWith("'"), `should neutralize ${JSON.stringify(evil)}`);
  }
});

test("numeric identifiers and phone numbers are not corrupted", () => {
  assert.equal(csvCell(515973), "515973"); // DOT number as a number
  assert.equal(csvCell(252615n), "252615");
  assert.equal(csvCell("515973"), "515973"); // DOT as text
  assert.equal(csvCell("+17154882707"), "+17154882707");
  assert.equal(csvCell("(715) 488-2707"), "(715) 488-2707");
  assert.equal(csvCell("-5"), "-5");
  assert.equal(csvCell(-5), "-5");
});

test("quoting: commas, quotes, newlines, and carriage returns", () => {
  assert.equal(csvCell('He said "hi", then left'), '"He said ""hi"", then left"');
  assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
  assert.equal(csvCell("a\r\nb"), '"a\r\nb"');
  assert.equal(csvCell("plain"), "plain");
});

test("empty values and booleans", () => {
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(undefined), "");
  assert.equal(csvCell(true), "true");
  assert.equal(csvCell(false), "false");
  assert.equal(csvCell(""), "");
});

test("UTF-8 text survives, and the BOM is added for Excel", () => {
  assert.equal(csvCell("José Núñez-Öz Jr. — 李雷"), "José Núñez-Öz Jr. — 李雷");
  assert.equal(withBom("a").charCodeAt(0), 0xfeff);
});

test("a hostile note in a full row is made safe without changing other cells", () => {
  const csv = toCsv([{ dot_number: 1, notes: "=cmd|'/c calc'!A1", phone: "+17154882707", name: 'ACME, "Inc"' }]);
  assert.equal(csv, `dot_number,notes,phone,name\n1,'=cmd|'/c calc'!A1,+17154882707,"ACME, ""Inc"""`);
});

test("fetchAllPages returns every row, past the 1,000-row default, and never a partial file", async () => {
  const total = 3500;
  const all = Array.from({ length: total }, (_, i) => ({ i }));
  const rows = await fetchAllPages(async (from, to) => ({ data: all.slice(from, to + 1), error: null }));
  assert.equal(rows.length, total);
  assert.equal(new Set(rows.map((r) => r.i)).size, total);

  await assert.rejects(
    fetchAllPages(async (from) => (from === 0 ? { data: all.slice(0, 1000), error: null } : { data: null, error: { message: "db down" } })),
    /db down/
  );
  await assert.rejects(fetchAllPages(async (from, to) => ({ data: Array(to - from + 1).fill({}), error: null }), 1000, 3000), /larger than/);
});
