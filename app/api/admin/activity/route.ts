import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("id, full_name, role, last_seen_at");
  if (profilesError) return NextResponse.json({ error: profilesError.message }, { status: 500 });

  const { data: shifts, error: shiftsError } = await admin
    .from("shifts")
    .select("*")
    .order("check_in", { ascending: false })
    .limit(200);
  if (shiftsError) return NextResponse.json({ error: shiftsError.message }, { status: 500 });

  const { data: authUsers } = await admin.auth.admin.listUsers();
  const emailById = new Map((authUsers?.users ?? []).map((u: any) => [u.id, u.email]));

  const nameById = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name || emailById.get(p.id) || "—"]));
  const shiftsWithNames = (shifts ?? []).map((s: any) => ({ ...s, user_name: nameById.get(s.user_id) ?? "—" }));

  const ONLINE_WINDOW_MS = 2 * 60 * 1000;
  const now = Date.now();
  const users = (profiles ?? []).map((p: any) => ({
    ...p,
    email: emailById.get(p.id) ?? null,
    online: p.last_seen_at ? now - new Date(p.last_seen_at).getTime() < ONLINE_WINDOW_MS : false,
  }));

  return NextResponse.json({ users, shifts: shiftsWithNames });
}
