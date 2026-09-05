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
    // Always ask FMCSA live for "next" — a local cache of previously-seen
    // carriers is necessarily patchy, so trusting it to answer "what's next
    // after X" can silently skip over an unfetched range. We still cache
    // everything we fetch below for other purposes (leads joins, the Back
    // history), just never read the cache to answer this question.
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

    const firstDot = batch[0].dot_number;

    // Two separate, unambiguous lookups rather than one embedded join —
    // now that a carrier can have one lead row per user, an embedded
    // `carriers -> leads` join would return every user's row, not just the
    // caller's own.
    const { data: freshCarrier, error: freshError } = await supabase
      .from("carriers")
      .select("*")
      .eq("dot_number", firstDot)
      .single();
    if (freshError) throw freshError;

    const { data: ownLead } = await supabase
      .from("leads")
      .select("status, priority, notes, last_called_at")
      .eq("dot_number", firstDot)
      .eq("user_id", user.id)
      .maybeSingle();

    // Best-effort shift counter — never blocks the lookup if it fails.
    admin.rpc("increment_open_shift_viewed", { p_user_id: user.id }).then(
      () => {},
      () => {}
    );

    return NextResponse.json({ carrier: { ...freshCarrier, leads: ownLead ?? null }, source: "fmcsa" });
  } catch (err: any) {
    console.error("next-carrier error:", err);
    return NextResponse.json(
      { error: err?.message || "Something went wrong looking up the next carrier." },
      { status: 500 }
    );
  }
}
