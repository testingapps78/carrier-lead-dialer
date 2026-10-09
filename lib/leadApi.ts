import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const CONTACT_ROLES = ["owner", "dispatcher", "manager", "other"] as const;
export const DO_NOT_CALL_STATUS = "do_not_call"; // the stored value (the label is organization-configurable)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export function parseDot(v: unknown): number | null {
  const n = typeof v === "string" && /^\d{1,12}$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function badRequest(error: string, code = "bad_request", status = 400) {
  return NextResponse.json({ error, code }, { status });
}

/**
 * Signed-in user from the server session. If the browser says which agent it believes it is
 * (expected_user_id), a mismatch is refused: a draft typed under one login must never be saved
 * into another login's leads.
 */
export async function requireUser(expectedUserId?: unknown) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in.", code: "not_signed_in" }, { status: 401 }) };
  if (expectedUserId !== undefined && expectedUserId !== null && expectedUserId !== user.id) {
    return {
      error: NextResponse.json(
        { error: "You're signed in as a different user than this page was loaded for. Reload the page.", code: "account_changed" },
        { status: 409 }
      ),
    };
  }
  return { supabase, user };
}

const RPC_MESSAGES: Record<string, [number, string]> = {
  not_authenticated: [401, "Not signed in."],
  invalid_status: [400, "That status isn't available in your organization."],
  invalid_kind: [400, "Unknown call event type."],
  invalid_timezone: [400, "That timezone isn't recognized."],
  invalid_contact_name: [400, "Contact name must be 1 to 100 characters."],
  invalid_contact_role: [400, "Pick Owner, Dispatcher, Manager, or Other."],
  give_either_timed_or_date_only: [400, "Give either a date and time, or a date only."],
  callback_too_far: [400, "Callbacks can be at most 3 years ahead."],
  note_too_long: [400, "Notes are limited to 1,000 characters here."],
  idempotency_key_required: [400, "Missing request id."],
  invalid_limit: [400, "Page size must be 1 to 100."],
  invalid_offset: [400, "Invalid page offset."],
  invalid_sort: [400, "Unknown sort."],
  invalid_callback: [400, "Unknown callback view."],
  do_not_call: [409, "This lead is marked Do Not Call."],
  lead_not_found: [404, "Lead not found."],
};

export function isMigrationPending(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = err.message ?? "";
  return (
    err.code === "PGRST202" || // function not found in schema cache
    err.code === "42883" || // undefined function
    err.code === "42703" || // undefined column
    err.code === "42P01" || // undefined table
    /could not find the function|schema cache/i.test(msg)
  );
}

/** Turns a database/RPC error into a clear, typed response (and never leaks internals for unknown errors). */
export function rpcError(err: { code?: string; message?: string }) {
  if (isMigrationPending(err)) {
    return NextResponse.json(
      { error: "This feature needs a database update that hasn't been applied yet.", code: "migration_pending" },
      { status: 503 }
    );
  }
  const msg = err.message ?? "";
  for (const key of Object.keys(RPC_MESSAGES)) {
    if (msg.includes(key)) {
      const [status, error] = RPC_MESSAGES[key];
      return NextResponse.json({ error, code: key }, { status });
    }
  }
  if (err.code === "23503") return NextResponse.json({ error: "Carrier not found.", code: "carrier_not_found" }, { status: 404 });
  console.error("lead rpc error:", err);
  return NextResponse.json({ error: "Something went wrong saving that. Try again.", code: "server_error" }, { status: 500 });
}

export function cleanNote(v: unknown, max: number): { ok: true; value: string | null } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false };
  const t = v.trim();
  if (t.length > max) return { ok: false };
  return { ok: true, value: t === "" ? null : t };
}
