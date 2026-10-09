import { NextRequest, NextResponse } from "next/server";
import { CONTACT_ROLES, badRequest, isUuid, parseDot, requireUser, rpcError } from "@/lib/leadApi";

export const dynamic = "force-dynamic";

// The agent's own confirmed contact for a carrier. Stored on the agent's personal lead only;
// the carrier's provider-supplied names and every other agent's view are untouched.
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

  if (body.action === "clear") {
    const { data, error } = await supabase.rpc("clear_lead_contact", { p_dot: dot, p_key: key });
    return error ? rpcError(error) : NextResponse.json({ lead: data });
  }
  if (body.action !== "set") return badRequest("action must be set or clear.");

  if (typeof body.name !== "string") return badRequest("Enter the contact's name.");
  const name = body.name.trim(); // keep letters, accents, punctuation and non-Latin characters exactly as typed
  // eslint-disable-next-line no-control-regex
  if (name.length < 1 || name.length > 100 || /[\u0000-\u001F\u007F]/.test(name)) {
    return badRequest("Contact name must be 1 to 100 characters, without control characters.");
  }
  if (!CONTACT_ROLES.includes(body.role)) return badRequest("Pick Owner, Dispatcher, Manager, or Other.");

  const { data, error } = await supabase.rpc("set_lead_contact", { p_dot: dot, p_key: key, p_name: name, p_role: body.role });
  return error ? rpcError(error) : NextResponse.json({ lead: data });
}
