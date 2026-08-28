import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { fetchFmcsaBatch, ScanMode, CarrierFilters } from "@/lib/fmcsa";

export const dynamic = "force-dynamic";

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
    // Always ask FMCSA live for "next" — it's the only source that can tell
    // us with certainty there's no closer match. A local cache of
    // previously-seen carriers is necessarily patchy (it only knows about
    // ranges we've already looked up before), so trusting it to answer
    // "what's the next one after X" can silently skip over a huge unfetched
    // range and jump to some unrelated leftover result from an earlier scan.
    // We still write everything we fetch into the cache below — just never
    // read from it to answer this particular question.
    const batch = await fetchFmcsaBatch(after, mode, filters, 200);

    if (batch.length === 0) {
      return NextResponse.json({
        carrier: null,
        source: "fmcsa",
        message: "No more active carriers match these filters.",
      });
    }

    const admin = createAdminClient();
    const { error: upsertError } = await admin
      .from("carriers")
      .upsert(
        batch.map((c) => ({ ...c, fetched_at: new Date().toISOString() })),
        { onConflict: "dot_number" }
      );
    if (upsertError) throw upsertError;

    // Re-read the first match so the response includes any existing lead
    // row (status/notes) for this exact, known carrier — a safe single-row
    // lookup by primary key, not a range scan.
    const { data: fresh, error: freshError } = await supabase
      .from("carriers")
      .select("*, leads(status, priority, notes, last_called_at)")
      .eq("dot_number", batch[0].dot_number)
      .limit(1);
    if (freshError) throw freshError;

    // Best-effort shift counter — never blocks the lookup if it fails.
    admin.rpc("increment_open_shift_viewed", { p_user_id: user.id }).then(
      () => {},
      () => {}
    );

    return NextResponse.json({ carrier: fresh?.[0] ?? batch[0], source: "fmcsa" });
  } catch (err: any) {
    console.error("next-carrier error:", err);
    return NextResponse.json(
      { error: err?.message || "Something went wrong looking up the next carrier." },
      { status: 500 }
    );
  }
}
