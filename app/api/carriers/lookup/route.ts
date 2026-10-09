import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const dotsParam = request.nextUrl.searchParams.get("dots") || "";
  const dots = dotsParam
    .split(",")
    .map((d) => parseInt(d, 10))
    .filter((d) => Number.isFinite(d));
  if (dots.length === 0) return NextResponse.json({ carriers: [] });

  const { data: carriers, error } = await supabase.from("carriers").select("*").in("dot_number", dots);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fail closed: if the lead lookup fails we must not hand back carriers that look like "no lead",
  // because that could make a Do Not Call lead look dialable.
  const { data: leads, error: leadsError } = await supabase.from("leads").select("*").eq("user_id", user.id).in("dot_number", dots);
  if (leadsError) return NextResponse.json({ error: "Couldn't check your lead notes and restrictions. Try again." }, { status: 500 });

  const leadByDot = new Map((leads ?? []).map((l) => [l.dot_number, l]));
  const merged = (carriers ?? []).map((c) => ({ ...c, leads: leadByDot.get(c.dot_number) ?? null }));

  // Preserve the order the caller asked for, since that's the scan/back order.
  const ordered = dots.map((d) => merged.find((c) => c.dot_number === d)).filter(Boolean);

  return NextResponse.json({ carriers: ordered });
}
