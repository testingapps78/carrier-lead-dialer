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

  const { data, error } = await supabase
    .from("shifts")
    .insert({ user_id: user.id })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shift: data });
}

export async function PATCH() {
  // Check out — closes the currently open shift.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: open } = await supabase
    .from("shifts")
    .select("id")
    .eq("user_id", user.id)
    .is("check_out", null)
    .maybeSingle();

  if (!open) {
    return NextResponse.json({ error: "You're not checked in." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("shifts")
    .update({ check_out: new Date().toISOString() })
    .eq("id", open.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shift: data });
}
