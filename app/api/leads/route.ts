import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.dot_number !== "number") {
    return NextResponse.json({ error: "dot_number is required." }, { status: 400 });
  }

  const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
  if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 500 });

  const update: Record<string, unknown> = {
    dot_number: body.dot_number,
    user_id: user.id,
    organization_id: profile.organization_id,
  };

  if (body.status !== undefined) {
    const { data: validStatus } = await supabase
      .from("call_statuses")
      .select("value")
      .eq("value", body.status)
      .eq("organization_id", profile.organization_id)
      .maybeSingle();
    if (!validStatus) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }
    update.status = body.status;
    if (body.status !== "new") update.last_called_at = new Date().toISOString();
  }
  if (body.priority !== undefined) update.priority = !!body.priority;
  if (body.notes !== undefined) update.notes = String(body.notes).slice(0, 5000);
  if (body.reminder_date !== undefined) update.reminder_date = body.reminder_date;
  if (body.reminder_note !== undefined) update.reminder_note = String(body.reminder_note ?? "").slice(0, 1000);
  if (body.reminder_done !== undefined) update.reminder_done = !!body.reminder_done;

  const { data, error } = await supabase
    .from("leads")
    .upsert(update, { onConflict: "dot_number,user_id" })
    .select()
    .single();

  if (error) {
    console.error("leads upsert error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.status !== undefined) {
    const admin = createAdminClient();
    admin.rpc("increment_open_shift_logged", { p_user_id: user.id }).then(
      () => {},
      () => {}
    );
  }

  return NextResponse.json({ lead: data });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const status = request.nextUrl.searchParams.get("status");
  const search = request.nextUrl.searchParams.get("q");
  const asUserId = request.nextUrl.searchParams.get("user_id"); // admin-only: view a teammate's leads

  let targetUserId = user.id;
  if (asUserId && asUserId !== user.id) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Only admins can view another teammate's leads." }, { status: 403 });
    }
    targetUserId = asUserId;
  }

  // Own client respects RLS naturally; for viewing a teammate as admin we
  // still scope explicitly by user_id rather than relying on RLS alone, so
  // the result is that one person's data, not everyone's merged together.
  let query = supabase
    .from("leads")
    .select(
      "*, carriers(legal_name, dba_name, phone, phy_city, phy_state, power_units, docket_prefix, docket_number)"
    )
    .eq("user_id", targetUserId)
    .order("updated_at", { ascending: false })
    .limit(500);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let leads = data ?? [];
  if (search) {
    const q = search.toLowerCase();
    leads = leads.filter((l: any) => {
      const name = (l.carriers?.legal_name || "").toLowerCase();
      const dba = (l.carriers?.dba_name || "").toLowerCase();
      return name.includes(q) || dba.includes(q) || String(l.dot_number).includes(q);
    });
  }

  return NextResponse.json({ leads });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const dotNumber = request.nextUrl.searchParams.get("dot_number");
  if (!dotNumber) {
    return NextResponse.json({ error: "dot_number is required." }, { status: 400 });
  }

  const { error } = await supabase
    .from("leads")
    .delete()
    .eq("dot_number", Number(dotNumber))
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
