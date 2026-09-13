import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  await supabase.rpc("touch_last_seen");

  const sessionId = (await cookies()).get("cd_session_id")?.value;
  if (sessionId) {
    await supabase.from("user_sessions").update({ last_active_at: new Date().toISOString() }).eq("id", sessionId);
  }

  return NextResponse.json({ ok: true });
}
