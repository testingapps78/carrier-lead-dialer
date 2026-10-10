import test from "node:test";
import assert from "node:assert/strict";
import { scanForNext, cursorOf, type ScanCarrier } from "../lib/scanNext.ts";

const mk = (n: number): ScanCarrier => ({ dot_number: 2000000 + n, docket_number: 900000 + n });
const batchOf = (from: number, count: number) => Array.from({ length: count }, (_, i) => mk(from + i));
const dnc = (...ns: number[]) => new Map(ns.map((n) => [2000000 + n, { status: "do_not_call" }]));
const suppressed = (l: { status?: string | null }) => l.status === "do_not_call";

test("with no Do Not Call leads, the first carrier of the batch is returned, as before", async () => {
  const r = await scanForNext({ after: 0, mode: "mc", firstBatch: batchOf(1, 50), fetchBatch: async () => [], processBatch: async () => new Map(), isSuppressed: suppressed });
  assert.equal(r.kind, "found");
  assert.equal(r.kind === "found" && r.carrier.dot_number, 2000001);
  assert.equal(r.kind === "found" && r.skipped, 0);
});

test("leading Do Not Call carriers are skipped; the next usable one is returned with its own lead", async () => {
  const leads = new Map<number, any>([...dnc(1, 2, 3), [2000004, { status: "interested", notes: "n" }]]);
  const r = await scanForNext({ after: 0, mode: "dot", firstBatch: batchOf(1, 50), fetchBatch: async () => [], processBatch: async () => leads, isSuppressed: suppressed });
  assert.equal(r.kind === "found" && r.carrier.dot_number, 2000004);
  assert.equal(r.kind === "found" && r.skipped, 3);
  assert.equal(r.kind === "found" && r.lead?.notes, "n");
});

test("a fully suppressed first batch continues from the last number seen and finds the next carrier", async () => {
  const fetched: number[] = [];
  const r = await scanForNext({
    after: 0, mode: "mc", firstBatch: batchOf(1, 50),
    fetchBatch: async (cursor) => { fetched.push(cursor); return batchOf(51, 50); },
    processBatch: async (b) => (b[0].dot_number === 2000001 ? dnc(...Array.from({ length: 50 }, (_, i) => i + 1)) : new Map()),
    isSuppressed: suppressed,
  });
  assert.deepEqual(fetched, [900050], "continues from the last MC number of the suppressed batch (no skipped range, no repeat)");
  assert.equal(r.kind === "found" && r.carrier.dot_number, 2000051);
  assert.equal(r.kind === "found" && r.skipped, 50);
});

test("when everything within the bound is suppressed it reports 'continue', never 'no more carriers'", async () => {
  let calls = 0;
  const r = await scanForNext({
    after: 0, mode: "dot", firstBatch: batchOf(1, 50),
    fetchBatch: async (cursor) => batchOf(cursor - 2000000 + 1, 50),
    processBatch: async (b) => { calls++; return dnc(...b.map((c) => c.dot_number - 2000000)); },
    isSuppressed: suppressed,
    maxExtraBatches: 3,
  });
  assert.equal(r.kind, "continue");
  assert.equal(r.kind === "continue" && r.cursor, 2000200, "cursor = last DOT scanned, so the next press resumes right after it");
  assert.equal(r.kind === "continue" && r.skipped, 200);
  assert.equal(calls, 4, "bounded: first batch + 3 extra, one lookup per batch (not per carrier)");
});

test("if FMCSA runs out after suppressed carriers, that is a true 'none'", async () => {
  const r = await scanForNext({ after: 0, mode: "dot", firstBatch: batchOf(1, 5), fetchBatch: async () => [], processBatch: async (b) => dnc(...b.map((c) => c.dot_number - 2000000)), isSuppressed: suppressed });
  assert.equal(r.kind, "none");
});

test("an empty first batch is 'none'", async () => {
  const r = await scanForNext({ after: 0, mode: "dot", firstBatch: [], fetchBatch: async () => [], processBatch: async () => new Map(), isSuppressed: suppressed });
  assert.equal(r.kind, "none");
});

test("a failed lead lookup fails the whole request (a suppressed lead is never treated as 'unknown')", async () => {
  await assert.rejects(
    scanForNext({ after: 0, mode: "dot", firstBatch: batchOf(1, 5), fetchBatch: async () => [], processBatch: async () => { throw new Error("db down"); }, isSuppressed: suppressed }),
    /db down/
  );
});

test("cursor follows the scan mode (MC number, falling back to DOT when a carrier has none)", () => {
  assert.equal(cursorOf({ dot_number: 5, docket_number: 77 }, "mc"), 77);
  assert.equal(cursorOf({ dot_number: 5, docket_number: null }, "mc"), 5);
  assert.equal(cursorOf({ dot_number: 5, docket_number: 77 }, "dot"), 5);
});
