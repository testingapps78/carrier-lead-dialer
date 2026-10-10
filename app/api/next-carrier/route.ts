import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { fetchFmcsaBatch, FmcsaRateLimitError, ScanMode, CarrierFilters } from "@/lib/fmcsa";
import { DO_NOT_CALL_STATUS } from "@/lib/leadApi";
import { scanForNext } from "@/lib/scanNext";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // leaves room for FMCSA retry/backoff

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const after = parseInt(params.get("after") ?? "0", 10) || 0;
  const mode = (params.get("mode") as ScanMode) || "dot";
  const state = params.get("state") || undefined;
  const minPowerUnits = params.get("minPowerUnits")
    ? parseInt(params.get("minPowerUnits")!, 10)
    : undefined;
  const maxPowerUnits = params.get("maxPowerUnits")
    ? parseInt(params.get("maxPowerUnits")!, 10)
    : undefined;
  const docketOnly = params.get("docketOnly") === "true";

  const filters: CarrierFilters = { state, minPowerUnits, maxPowerUnits, docketOnly };

  try {
    // Always ask FMCSA live for "next" — a local cache of previously-seen
    // carriers is necessarily patchy, so trusting it to answer "what's next
    // after X" can silently skip over an unfetched range. We still cache
    // everything we fetch below for other purposes (leads joins, the Back
    // history), just never read the cache to answer this question.
    const admin = createAdminClient();

    // Do Not Call is personal to this agent: one batched lookup per batch (never one per carrier).
    // If it fails we fail the request, so a suppressed lead can never slip through as "unknown".
    const firstBatch = await fetchFmcsaBatch(after, mode, filters, 50);
    const result = await scanForNext({
      after,
      mode,
      firstBatch,
      fetchBatch: (cursor) => fetchFmcsaBatch(cursor, mode, filters, 50),
      isSuppressed: (lead: any) => lead.status === DO_NOT_CALL_STATUS,
      processBatch: async (batch) => {
        // Cache write and lead lookup are independent, so they run together (no extra round trip vs. before).
        const [upsertRes, leadsRes] = await Promise.all([
          admin.from("carriers").upsert(
            batch.map((c) => ({ ...c, fetched_at: new Date().toISOString() })),
            { onConflict: "dot_number" }
          ),
          supabase.from("leads").select("*").eq("user_id", user.id).in("dot_number", batch.map((c) => c.dot_number)),
        ]);
        if (upsertRes.error) throw upsertRes.error;
        if (leadsRes.error) throw leadsRes.error;
        return new Map((leadsRes.data ?? []).map((l: any) => [l.dot_number, l]));
      },
    });

    if (result.kind === "none") {
      return NextResponse.json({ carrier: null, source: "fmcsa", message: "No more active carriers match these filters." });
    }
    if (result.kind === "continue") {
      // Everything scanned so far is on this agent's Do Not Call list. Say so honestly and hand back the
      // cursor so the next press continues from here (this is not "no more carriers").
      return NextResponse.json({
        carrier: null,
        source: "fmcsa",
        continuation: {
          cursor: result.cursor,
          skipped: result.skipped,
          message: `The last ${result.skipped} carriers in this range are all on your Do Not Call list. Press Next to keep scanning.`,
        },
      });
    }
    const chosen = result.carrier;
    const ownLead = result.lead;

    // Re-read the chosen carrier so cached enrichment (owner details etc.) is merged in, as before.
    const { data: freshCarrier, error: freshError } = await supabase
      .from("carriers")
      .select("*")
      .eq("dot_number", chosen.dot_number)
      .single();
    if (freshError) throw freshError;

    // Best-effort shift counter — never blocks the lookup if it fails.
    admin.rpc("increment_open_shift_viewed", { p_user_id: user.id }).then(
      () => {},
      () => {}
    );

    return NextResponse.json({ carrier: { ...freshCarrier, leads: ownLead ?? null }, source: "fmcsa" });
  } catch (err: any) {
    if (err instanceof FmcsaRateLimitError) {
      console.warn("next-carrier: FMCSA rate limited (429) after retries");
      return NextResponse.json(
        {
          error: "FMCSA is busy right now (too many requests). Wait a few seconds and press Next again.",
          code: "rate_limited",
          retryAfterSeconds: err.retryAfterSeconds,
        },
        { status: 429 }
      );
    }
    console.error("next-carrier error:", err);
    return NextResponse.json(
      { error: err?.message || "Something went wrong looking up the next carrier." },
      { status: 500 }
    );
  }
}
