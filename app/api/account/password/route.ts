import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.currentPassword || !body?.newPassword) {
    return NextResponse.json({ error: "Current and new password are both required." }, { status: 400 });
  }
  if (String(body.newPassword).length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
  }

  // Re-verify the current password before allowing a change — updateUser()
  // alone doesn't require it, so this confirms it's really the account
  // owner typing, not someone using an already-open, unattended session.
  const { data: authData } = await supabase.auth.getUser();
  const email = authData.user?.email;
  if (!email) return NextResponse.json({ error: "Could not verify account." }, { status: 500 });

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email,
    password: body.currentPassword,
  });
  if (verifyError) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  const { error } = await supabase.auth.updateUser({ password: body.newPassword });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
