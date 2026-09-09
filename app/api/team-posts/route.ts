import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data, error } = await supabase
    .from("team_posts")
    .select("*, profiles(full_name), carriers(legal_name)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ posts: data });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.body?.trim()) return NextResponse.json({ error: "Message can't be empty." }, { status: 400 });

  const { data: profile } = await supabase.from("profiles").select("role, organization_id").eq("id", user.id).single();
  if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 500 });

  let isBroadcast = false;
  if (body.isBroadcast) {
    if (profile.role !== "admin") {
      return NextResponse.json({ error: "Only admins can post announcements." }, { status: 403 });
    }
    isBroadcast = true;
  }

  const { data, error } = await supabase
    .from("team_posts")
    .insert({
      author_id: user.id,
      organization_id: profile.organization_id,
      body: body.body.trim().slice(0, 2000),
      dot_number: body.dotNumber ?? null,
      is_broadcast: isBroadcast,
    })
    .select("*, profiles(full_name), carriers(legal_name)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ post: data });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });

  const { error } = await supabase.from("team_posts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
