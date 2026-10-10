// "Find the next carrier to show" with personal Do Not Call skipping, kept independent of FMCSA and
// the database so the cursor behavior can be tested directly.
//
// Behavior preserved from the original route: one batch is fetched live from FMCSA, in ascending
// MC/DOT order, and the FIRST usable carrier in it is returned. New: carriers this agent marked Do Not Call
// are skipped (one batched lookup per batch, never one per carrier). If a whole batch is suppressed the
// scan continues from the last number seen, up to a bound, and then reports an honest "keep scanning"
// continuation instead of claiming there are no more carriers.

export type ScanMode = "dot" | "mc";

export interface ScanCarrier {
  dot_number: number;
  docket_number?: number | null;
}

export type ScanResult<C extends ScanCarrier, L> =
  | { kind: "found"; carrier: C; lead: L | null; skipped: number }
  | { kind: "none" } // FMCSA has nothing further for these filters
  | { kind: "continue"; cursor: number; skipped: number }; // everything scanned so far was suppressed

export const MAX_EXTRA_BATCHES = 3;

export function cursorOf(c: ScanCarrier, mode: ScanMode): number {
  return mode === "dot" ? c.dot_number : c.docket_number ?? c.dot_number;
}

export async function scanForNext<C extends ScanCarrier, L extends { status?: string | null }>(args: {
  after: number;
  mode: ScanMode;
  firstBatch: C[];
  fetchBatch: (after: number) => Promise<C[]>;
  /** Caches the batch and returns this agent's leads for it, by DOT. Must throw on failure (fail closed). */
  processBatch: (batch: C[]) => Promise<Map<number, L>>;
  isSuppressed: (lead: L) => boolean;
  maxExtraBatches?: number;
}): Promise<ScanResult<C, L>> {
  const { mode, fetchBatch, processBatch, isSuppressed } = args;
  const maxExtra = args.maxExtraBatches ?? MAX_EXTRA_BATCHES;
  let batch = args.firstBatch;
  if (batch.length === 0) return { kind: "none" };

  let skipped = 0;
  for (let round = 0; ; round++) {
    const leads = await processBatch(batch);
    for (const c of batch) {
      const lead = leads.get(c.dot_number) ?? null;
      if (lead && isSuppressed(lead)) {
        skipped += 1;
        continue;
      }
      return { kind: "found", carrier: c, lead, skipped };
    }
    const lastCursor = cursorOf(batch[batch.length - 1], mode);
    if (round >= maxExtra) return { kind: "continue", cursor: lastCursor, skipped };
    batch = await fetchBatch(lastCursor);
    if (batch.length === 0) return { kind: "none" };
  }
}
