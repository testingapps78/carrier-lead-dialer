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

  const update: Record<string, unknown> = {
    dot_number: body.dot_number,
    assigned_to: user.id,
  };

  if (body.status !== undefined) {
    const { data: validStatus } = await supabase
      .from("call_statuses")
      .select("value")
      .eq("value", body.status)
      .maybeSingle();
    if (!validStatus) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }
    update.status = body.status;
    if (body.status !== "new") update.last_called_at = new Date().toISOString();
  }
  if (body.priority !== undefined) update.priority = !!body.priority;
  if (body.notes !== undefined) update.notes = String(body.notes).slice(0, 5000);

  const { data, error } = await supabase
    .from("leads")
    .upsert(update, { onConflict: "dot_number" })
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

  let query = supabase
    .from("leads")
    .select(
      "*, carriers(legal_name, dba_name, phone, phy_city, phy_state, power_units, docket_prefix, docket_number)"
    )
    .order("updated_at", { ascending: false })
    .limit(200);

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

  const { error } = await supabase.from("leads").delete().eq("dot_number", Number(dotNumber));
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
