import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data } = await supabase.from("profiles").select("scan_state").eq("id", user.id).single();
  return NextResponse.json({ state: data?.scan_state ?? null });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body." }, { status: 400 });

  // Cap history so this never grows unbounded for a long dialing session.
  const history = Array.isArray(body.history) ? body.history.slice(-25) : [];

  const state = {
    mode: body.mode ?? "mc",
    filterState: body.filterState ?? null,
    minPowerUnits: body.minPowerUnits ?? null,
    maxPowerUnits: body.maxPowerUnits ?? null,
    docketOnly: !!body.docketOnly,
    startNumber: body.startNumber ?? null,
    cursor: body.cursor ?? null,
    history,
    updatedAt: new Date().toISOString(),
  };

  const { error } = await supabase.from("profiles").update({ scan_state: state }).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  await supabase.from("profiles").update({ scan_state: null }).eq("id", user.id);
  return NextResponse.json({ ok: true });
}
