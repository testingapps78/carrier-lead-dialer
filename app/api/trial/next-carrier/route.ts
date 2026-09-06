import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchFmcsaBatch, ScanMode, CarrierFilters } from "@/lib/fmcsa";
import { checkAndConsumeTrial, TRIAL_LIMIT } from "@/lib/trial";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const trial = await checkAndConsumeTrial();

  if (!trial.allowed) {
    if (trial.reason === "too_fast") {
      return NextResponse.json({ error: "Please slow down a little." }, { status: 429 });
    }
    return NextResponse.json(
      { limitReached: true, message: "You've used all 10 free lookups." },
      { status: 200 }
    );
  }

  const params = request.nextUrl.searchParams;
  const after = parseInt(params.get("after") ?? "0", 10) || 0;
  const mode = (params.get("mode") as ScanMode) || "mc";
  const state = params.get("state") || undefined;
  const minPowerUnits = params.get("minPowerUnits") ? parseInt(params.get("minPowerUnits")!, 10) : undefined;
  const maxPowerUnits = params.get("maxPowerUnits") ? parseInt(params.get("maxPowerUnits")!, 10) : undefined;
  const docketOnly = params.get("docketOnly") === "true";

  const filters: CarrierFilters = { state, minPowerUnits, maxPowerUnits, docketOnly };

  try {
    const batch = await fetchFmcsaBatch(after, mode, filters, 200);

    if (batch.length === 0) {
      return NextResponse.json({
        carrier: null,
        remaining: trial.remaining,
        message: "No more active carriers match these filters.",
      });
    }

    // Cache it too — free data for everyone else's lookups later, same as the full app.
    const admin = createAdminClient();
    admin
      .from("carriers")
      .upsert(
        batch.map((c) => ({ ...c, fetched_at: new Date().toISOString() })),
        { onConflict: "dot_number" }
      )
      .then(() => {}, () => {});

    return NextResponse.json({ carrier: batch[0], remaining: trial.remaining, limit: TRIAL_LIMIT });
  } catch (err: any) {
    console.error("trial next-carrier error:", err);
    return NextResponse.json({ error: "Something went wrong looking up the next carrier." }, { status: 500 });
  }
}
