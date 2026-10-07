import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { DEFAULT_IDLE_MINUTES, IDLE_OPTIONS } from "@/lib/idle";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "Not signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, organization_id")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return { ok: false as const, status: 403, error: "Admin access required." };
  return { ok: true as const, organizationId: profile.organization_id as string };
}

export async function GET() {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organizations")
    .select("idle_timeout_minutes")
    .eq("id", check.organizationId)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    idleTimeoutMinutes: data?.idle_timeout_minutes ?? DEFAULT_IDLE_MINUTES,
    options: IDLE_OPTIONS,
  });
}

export async function PATCH(request: NextRequest) {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await request.json().catch(() => ({}));
  const minutes = Number(body.idleTimeoutMinutes);
  if (!IDLE_OPTIONS.some((o) => o.minutes === minutes)) {
    return NextResponse.json({ error: "Pick one of the listed timeouts." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({ idle_timeout_minutes: minutes })
    .eq("id", check.organizationId); // service role bypasses RLS: scope to the caller's org explicitly
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, idleTimeoutMinutes: minutes });
}
