import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: open } = await supabase
    .from("shifts")
    .select("*")
    .eq("user_id", user.id)
    .is("check_out", null)
    .maybeSingle();

  const { data: history, error } = await supabase
    .from("shifts")
    .select("*")
    .eq("user_id", user.id)
    .not("check_out", "is", null)
    .order("check_in", { ascending: false })
    .limit(30);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ open: open ?? null, history: history ?? [] });
}

export async function POST() {
  // Check in — starts a new shift, unless one is already open.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: existing } = await supabase
    .from("shifts")
    .select("*")
    .eq("user_id", user.id)
    .is("check_out", null)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ shift: existing, message: "Already checked in." });
  }

  const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
  if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 500 });

  const { data, error } = await supabase
    .from("shifts")
    .insert({ user_id: user.id, organization_id: profile.organization_id })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shift: data });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => ({}));

  const { data: open } = await supabase
    .from("shifts")
    .select("id")
    .eq("user_id", user.id)
    .is("check_out", null)
    .maybeSingle();

  if (!open) {
    return NextResponse.json({ error: "You're not checked in." }, { status: 400 });
  }

  // action: "checkout" closes the shift. Anything else (or no action) just
  // updates the resumable scan state — called after every "Next" click.
  const update: Record<string, unknown> =
    body.action === "checkout"
      ? { check_out: new Date().toISOString() }
      : {
          mode: body.mode ?? undefined,
          state: body.state ?? undefined,
          min_power_units: body.minPowerUnits ?? undefined,
          max_power_units: body.maxPowerUnits ?? undefined,
          docket_only: body.docketOnly ?? undefined,
          start_number: body.startNumber ?? undefined,
          end_number: body.endNumber ?? undefined,
        };

  const { data, error } = await supabase.from("shifts").update(update).eq("id", open.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shift: data });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  // RLS allows a user to delete their own shifts, or an admin to delete any.
  const { error } = await supabase.from("shifts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
