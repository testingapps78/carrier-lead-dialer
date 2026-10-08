import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { aiConfigured } from "@/lib/ai";
import { DEFAULT_STYLE_NOTES } from "@/lib/aiPrompts";

export const dynamic = "force-dynamic";

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data } = await supabase
    .from("ai_settings")
    .select("display_name, company_name, offer, style_notes")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    configured: aiConfigured(),
    settings: {
      display_name: data?.display_name ?? "",
      company_name: data?.company_name ?? "",
      offer: data?.offer ?? "",
      style_notes: data?.style_notes || DEFAULT_STYLE_NOTES,
    },
  });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
  if (!profile?.organization_id) return NextResponse.json({ error: "No organization found." }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const { error } = await supabase.from("ai_settings").upsert(
    {
      user_id: user.id,
      organization_id: profile.organization_id,
      display_name: clip(body.display_name, 60),
      company_name: clip(body.company_name, 80),
      offer: clip(body.offer, 600),
      style_notes: clip(body.style_notes, 600),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
