import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DEFAULT_STATUSES = [
  { value: "new", label: "New", color: "slate", sort_order: 0, is_default: true },
  { value: "called_no_answer", label: "No Answer", color: "slate", sort_order: 1, is_default: false },
  { value: "callback", label: "Callback", color: "blue", sort_order: 2, is_default: false },
  { value: "interested", label: "Interested", color: "green", sort_order: 3, is_default: false },
  { value: "not_interested", label: "Not Interested", color: "red", sort_order: 4, is_default: false },
  { value: "signed", label: "Signed", color: "green", sort_order: 5, is_default: false },
  { value: "do_not_call", label: "Do Not Call", color: "red", sort_order: 6, is_default: false },
];

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "Not signed in." };

  const { data: profile } = await supabase.from("profiles").select("is_super_admin").eq("id", user.id).single();
  if (!profile?.is_super_admin) {
    return { ok: false as const, status: 403, error: "Platform access required." };
  }
  return { ok: true as const };
}

export async function GET() {
  const check = await requireSuperAdmin();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const admin = createAdminClient();
  const { data: orgs, error } = await admin
    .from("organizations")
    .select("id, name, created_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: profiles } = await admin.from("profiles").select("organization_id");
  const counts = new Map<string, number>();
  (profiles ?? []).forEach((p: any) => counts.set(p.organization_id, (counts.get(p.organization_id) ?? 0) + 1));

  return NextResponse.json({
    organizations: (orgs ?? []).map((o: any) => ({ ...o, member_count: counts.get(o.id) ?? 0 })),
  });
}

export async function POST(request: NextRequest) {
  const check = await requireSuperAdmin();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await request.json().catch(() => null);
  if (!body?.orgName || !body?.email || !body?.password || !body?.fullName) {
    return NextResponse.json({ error: "Organization name, admin name, email, and password are all required." }, { status: 400 });
  }
  if (String(body.password).length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: body.orgName })
    .select()
    .single();
  if (orgError) return NextResponse.json({ error: orgError.message }, { status: 500 });

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: body.email,
    password: body.password,
    email_confirm: true,
    user_metadata: { full_name: body.fullName, organization_id: org.id },
  });
  if (authError) {
    // Roll back the org so we don't leave an empty orphaned company behind.
    await admin.from("organizations").delete().eq("id", org.id);
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  const { error: statusError } = await admin
    .from("call_statuses")
    .insert(DEFAULT_STATUSES.map((s) => ({ ...s, organization_id: org.id })));
  if (statusError) console.error("default statuses seed failed:", statusError);

  return NextResponse.json({ organization: org, admin: authUser.user });
}
