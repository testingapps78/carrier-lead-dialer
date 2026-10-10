import { NextRequest, NextResponse } from "next/server";
import { badRequest, parseDot, requireUser, rpcError } from "@/lib/leadApi";

export const dynamic = "force-dynamic";

// Lazy-loaded history for one of the agent's own leads (only called when the panel is opened).
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  const p = request.nextUrl.searchParams;
  const dot = parseDot(p.get("dot_number"));
  if (dot === null) return badRequest("dot_number is required.");
  const limit = Math.min(Math.max(parseInt(p.get("limit") ?? "50", 10) || 50, 1), 100);
  const offset = Math.max(parseInt(p.get("offset") ?? "0", 10) || 0, 0);

  let query = supabase
    .from("lead_events")
    .select("id, event_type, occurred_at, outcome, note, details")
    .eq("user_id", user.id)
    .eq("dot_number", dot)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit); // one extra row tells us whether there is another page

  const { data, error } = await query;
  if (error) return rpcError(error);

  // Older leads carry a last_called_at set by status changes before call logging existed.
  // It is reported separately and never turned into fake call events.
  const { data: lead } = await supabase.from("leads").select("last_called_at").eq("dot_number", dot).eq("user_id", user.id).maybeSingle();

  const rows = data ?? [];
  return NextResponse.json({
    events: rows.slice(0, limit),
    has_more: rows.length > limit,
    legacy_last_activity_at: lead?.last_called_at ?? null,
  });
}
