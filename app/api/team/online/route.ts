import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ONLINE_WINDOW_MS = 2 * 60 * 1000;

// Any signed-in org member can call this — unlike /api/admin/activity, this
// is intentionally NOT admin-gated. It only returns name + online status,
// nothing sensitive (no email, no role, no shift history), so it's safe to
// expose to the whole team.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: caller } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
  if (!caller) return NextResponse.json({ error: "Profile not found." }, { status: 404 });

  // Service role, manually scoped to the caller's own org — same isolation
  // pattern as /api/admin/activity, just without the admin requirement.
  const admin = createAdminClient();
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, full_name, last_seen_at")
    .eq("organization_id", caller.organization_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = Date.now();
  const members = (profiles ?? [])
    .map((p: { id: string; full_name: string | null; last_seen_at: string | null }) => ({
      id: p.id,
      name: p.full_name || "Teammate",
      online: p.last_seen_at ? now - new Date(p.last_seen_at).getTime() < ONLINE_WINDOW_MS : false,
    }))
    .sort((a: { online: boolean; name: string }, b: { online: boolean; name: string }) =>
      Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)
    );

  return NextResponse.json({ members });
}
