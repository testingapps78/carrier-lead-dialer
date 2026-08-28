import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const VALID_COLORS = ["slate", "blue", "green", "red", "amber", "violet"];

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, status: 401, error: "Not signed in." };

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return { ok: false as const, status: 403, error: "Admin access required." };
  }
  return { ok: true as const, supabase };
}

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data, error } = await supabase
    .from("call_statuses")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ statuses: data });
}

export async function POST(request: NextRequest) {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await request.json().catch(() => null);
  if (!body?.label) return NextResponse.json({ error: "label is required." }, { status: 400 });

  const color = VALID_COLORS.includes(body.color) ? body.color : "slate";
  const value = slugify(body.label);
  if (!value) return NextResponse.json({ error: "Please use at least one letter or number." }, { status: 400 });

  const { data: maxRow } = await check.supabase
    .from("call_statuses")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await check.supabase
    .from("call_statuses")
    .insert({ value, label: body.label, color, sort_order: nextOrder })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A status with a similar name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ status: data });
}

export async function PATCH(request: NextRequest) {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await request.json().catch(() => null);
  if (!body?.value) return NextResponse.json({ error: "value is required." }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (body.label !== undefined) update.label = body.label;
  if (body.color !== undefined && VALID_COLORS.includes(body.color)) update.color = body.color;
  if (body.sort_order !== undefined) update.sort_order = body.sort_order;

  const { data, error } = await check.supabase
    .from("call_statuses")
    .update(update)
    .eq("value", body.value)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: data });
}

export async function DELETE(request: NextRequest) {
  const check = await requireAdmin();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const value = request.nextUrl.searchParams.get("value");
  if (!value) return NextResponse.json({ error: "value is required." }, { status: 400 });
  if (value === "new") {
    return NextResponse.json({ error: "The \"New\" status is the default and can't be removed." }, { status: 400 });
  }

  const { count } = await check.supabase
    .from("leads")
    .select("dot_number", { count: "exact", head: true })
    .eq("status", value);

  if (count && count > 0) {
    return NextResponse.json(
      { error: `${count} lead${count === 1 ? "" : "s"} still use this status. Change them first.` },
      { status: 409 }
    );
  }

  const { error } = await check.supabase.from("call_statuses").delete().eq("value", value);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
