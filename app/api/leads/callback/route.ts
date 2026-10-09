import { NextRequest, NextResponse } from "next/server";
import { badRequest, cleanNote, isUuid, parseDot, requireUser, rpcError } from "@/lib/leadApi";
import { isValidTimeZone, resolveLocalCallback } from "@/lib/callbackTime";

export const dynamic = "force-dynamic";

// set (new or reschedule) | complete | clear. A time + timezone makes a timed callback;
// a date alone keeps the older date-only behavior. The server turns the local time into an exact
// instant, handling clocks changing, so the agent never has to think about UTC.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid request.");
  const auth = await requireUser(body.expected_user_id);
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const dot = parseDot(body.dot_number);
  if (dot === null) return badRequest("dot_number is required.");
  const key = body.idempotency_key ?? null;
  if (key !== null && !isUuid(key)) return badRequest("Invalid request id.");

  if (body.action === "complete") {
    const { data, error } = await supabase.rpc("complete_lead_callback", { p_dot: dot, p_key: key });
    return error ? rpcError(error) : NextResponse.json({ lead: data });
  }
  if (body.action === "clear") {
    const { data, error } = await supabase.rpc("clear_lead_callback", { p_dot: dot, p_key: key });
    return error ? rpcError(error) : NextResponse.json({ lead: data });
  }
  if (body.action !== "set") return badRequest("action must be set, complete, or clear.");

  const note = cleanNote(body.note, 1000);
  if (!note.ok) return badRequest("Notes are limited to 1,000 characters.");

  let p_at: string | null = null;
  let p_tz: string | null = null;
  let p_date: string | null = null;
  let resolution: { kind: string; note: string | null; utc: string } | null = null;

  if (typeof body.local_time === "string" && body.local_time !== "") {
    if (typeof body.local_date !== "string" || typeof body.timezone !== "string" || !isValidTimeZone(body.timezone)) {
      return badRequest("A timed callback needs a date, a time, and a valid timezone.");
    }
    const r = resolveLocalCallback(body.local_date, body.local_time, body.timezone);
    if (!r.ok) return badRequest(r.error);
    p_at = r.utc;
    p_tz = body.timezone;
    resolution = { kind: r.kind, note: r.note, utc: r.utc };
  } else {
    if (typeof body.date_only !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date_only) || Number.isNaN(Date.parse(body.date_only))) {
      return badRequest("Pick a date for the callback.");
    }
    p_date = body.date_only;
  }

  const { data, error } = await supabase.rpc("set_lead_callback", {
    p_dot: dot,
    p_key: key,
    p_at,
    p_tz,
    p_date,
    p_note: note.value,
  });
  if (error) return rpcError(error);
  return NextResponse.json({ lead: data, resolution });
}
