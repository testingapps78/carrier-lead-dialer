import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const task = body.task;
  const rating = Number(body.rating);
  if (!["coach", "notes", "followup"].includes(task) || (rating !== 1 && rating !== -1)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
  if (!profile?.organization_id) return NextResponse.json({ error: "No organization found." }, { status: 400 });

  const dot = Number(body.dot_number);
  const { error } = await supabase.from("ai_feedback").insert({
    user_id: user.id,
    organization_id: profile.organization_id,
    task,
    dot_number: Number.isFinite(dot) ? dot : null,
    rating,
    comment: typeof body.comment === "string" ? body.comment.trim().slice(0, 500) : "",
    output: typeof body.output === "string" ? body.output.slice(0, 2000) : "",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
