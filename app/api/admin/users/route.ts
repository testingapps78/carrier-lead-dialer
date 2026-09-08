import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

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

  if (profile?.role !== "admin") {
    return { ok: false as const, status: 403, error: "Admin access required." };
  }
  return { ok: true as const, user, organizationId: profile.organization_id as string };
}

export async function GET() {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const admin = createAdminClient();
  // Service-role bypasses RLS entirely, so the organization filter has to
  // happen explicitly here — this is the one place RLS alone won't protect.
  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("id, full_name, role, created_at, last_seen_at")
    .eq("organization_id", check.organizationId);
  if (profilesError) {
    return NextResponse.json({ error: profilesError.message }, { status: 500 });
  }

  const { data: authUsers, error: authError } = await admin.auth.admin.listUsers();
  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  const emailById = new Map(authUsers.users.map((u: any) => [u.id, u.email]));
  const merged = (profiles ?? []).map((p: any) => ({ ...p, email: emailById.get(p.id) ?? null }));

  return NextResponse.json({ users: merged });
}

export async function POST(request: NextRequest) {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await request.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  if (String(body.password).length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    // organization_id always comes from the inviting admin's own org — a
    // teammate they add can never end up anywhere but their own company.
    user_metadata: { full_name: body.full_name ?? null, organization_id: check.organizationId },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (body.role === "admin" && data.user) {
    await admin.from("profiles").update({ role: "admin" }).eq("id", data.user.id);
  }

  return NextResponse.json({ user: data.user });
}

export async function PATCH(request: NextRequest) {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await request.json().catch(() => null);
  if (!body?.id || !["admin", "rep"].includes(body?.role)) {
    return NextResponse.json({ error: "id and a valid role are required." }, { status: 400 });
  }

  if (check.ok && body.id === check.user.id && body.role !== "admin") {
    return NextResponse.json({ error: "You can't demote yourself — have another admin do it." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .update({ role: body.role })
    .eq("id", body.id)
    .eq("organization_id", check.organizationId) // can't touch another company's user
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}

export async function DELETE(request: NextRequest) {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  if (check.ok && id === check.user.id) {
    return NextResponse.json({ error: "You can't remove your own account." }, { status: 400 });
  }

  const admin = createAdminClient();

  // Confirm the target is actually in the caller's org before deleting —
  // service-role auth.admin calls bypass RLS entirely, so this check has to
  // happen in code, not the database.
  const { data: target } = await admin.from("profiles").select("organization_id").eq("id", id).maybeSingle();
  if (!target || target.organization_id !== check.organizationId) {
    return NextResponse.json({ error: "User not found in your organization." }, { status: 404 });
  }

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
