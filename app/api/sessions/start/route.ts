import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
  if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 500 });

  const h = await headers();
  const userAgent = h.get("user-agent");
  const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || null;

  const sessionId = randomUUID();
  const { error } = await supabase.from("user_sessions").insert({
    id: sessionId,
    user_id: user.id,
    organization_id: profile.organization_id,
    user_agent: userAgent,
    ip_address: ip,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const cookieStore = await cookies();
  const oneYear = 60 * 60 * 24 * 365;
  cookieStore.set("cd_session_id", sessionId, { httpOnly: true, sameSite: "lax", maxAge: oneYear, path: "/" });
  cookieStore.set("cd_last_activity", new Date().toISOString(), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: oneYear,
    path: "/",
  });

  return NextResponse.json({ ok: true });
}
