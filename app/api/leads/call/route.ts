import { NextRequest, NextResponse } from "next/server";
import { badRequest, cleanNote, isUuid, parseDot, requireUser, rpcError } from "@/lib/leadApi";

export const dynamic = "force-dynamic";

// Records a call ATTEMPT ("dial") or an explicit logged call with outcome ("call").
// A tel: click proves only that dialing was started, never that anyone answered or how long it lasted.
// Safe to retry: the same idempotency_key always produces the same single event.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid request.");
  const auth = await requireUser(body.expected_user_id);
  if (auth.error) return auth.error;

  const dot = parseDot(body.dot_number);
  if (dot === null) return badRequest("dot_number is required.");
  if (!isUuid(body.idempotency_key)) return badRequest("Missing or invalid request id.", "idempotency_key_required");
  if (body.kind !== "dial" && body.kind !== "call") return badRequest("kind must be 'dial' or 'call'.");
  if (body.outcome !== undefined && body.outcome !== null && (typeof body.outcome !== "string" || body.outcome.length > 50)) {
    return badRequest("Invalid outcome.");
  }
  const note = cleanNote(body.note, 1000);
  if (!note.ok) return badRequest("Notes are limited to 1,000 characters.");

  const { data, error } = await auth.supabase.rpc("log_lead_call", {
    p_dot: dot,
    p_key: body.idempotency_key,
    p_kind: body.kind === "dial" ? "dial_initiated" : "call_logged",
    p_outcome: body.outcome ?? null,
    p_note: note.value,
  });
  if (error) return rpcError(error);
  return NextResponse.json({ lead: data.lead, event: data.event, duplicate: data.duplicate });
}
