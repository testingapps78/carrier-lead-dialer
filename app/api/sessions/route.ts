import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const scope = request.nextUrl.searchParams.get("scope"); // "org" (admin only) or omitted for "mine"

  let query = supabase
    .from("user_sessions")
    .select("id, user_id, user_agent, ip_address, created_at, last_active_at, revoked")
    .eq("revoked", false)
    .order("last_active_at", { ascending: false });

  if (scope === "org") {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }
    // RLS already scopes this to the admin's own organization.
  } else {
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let sessions = data ?? [];
  if (scope === "org") {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name");
    const nameById = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name]));
    sessions = sessions.map((s: any) => ({ ...s, user_name: nameById.get(s.user_id) ?? "—" }));
  }

  const currentSessionId = request.cookies.get("cd_session_id")?.value;
  return NextResponse.json({ sessions, currentSessionId });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  // RLS handles the actual authorization: an owner can revoke their own,
  // an admin can revoke any session within their own organization.
  const { error } = await supabase.from("user_sessions").update({ revoked: true }).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
