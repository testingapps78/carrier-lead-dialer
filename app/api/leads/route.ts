import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { badRequest, isMigrationPending, isUuid, parseDot, requireUser, rpcError } from "@/lib/leadApi";

export const dynamic = "force-dynamic";

const NOTES_MAX = 5000;

// Partial update of one personal lead. Only the fields in the request are touched, so saving notes
// can never reset status, callbacks, priority, or the confirmed contact.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Invalid request.");

  const auth = await requireUser(body.expected_user_id);
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  const dot = parseDot(body.dot_number);
  if (dot === null) return badRequest("dot_number is required.");

  if ("reminder_date" in body || "reminder_note" in body || "reminder_done" in body) {
    return badRequest("Callbacks now use their own request. Reload the page to update.", "use_callback_endpoint");
  }

  const fields: Record<string, unknown> = {};
  if (body.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== "string") return badRequest("Notes must be text.");
    const n: string = body.notes ?? "";
    if (n.length > NOTES_MAX) return badRequest(`Notes are limited to ${NOTES_MAX.toLocaleString()} characters.`, "notes_too_long", 413);
    fields.notes = n === "" ? null : n;
  }
  if (body.priority !== undefined) {
    if (typeof body.priority !== "boolean") return badRequest("priority must be true or false.");
    fields.priority = body.priority;
  }
  if (body.saved !== undefined) {
    if (typeof body.saved !== "boolean") return badRequest("saved must be true or false.");
    fields.saved = body.saved;
    fields.saved_at = body.saved ? new Date().toISOString() : null;
  }
  let status: string | undefined;
  if (body.status !== undefined) {
    if (typeof body.status !== "string" || body.status.length === 0 || body.status.length > 50) return badRequest("Invalid status.");
    status = body.status;
  }
  const key = body.idempotency_key;
  if (key !== undefined && key !== null && !isUuid(key)) return badRequest("Invalid request id.");

  if (Object.keys(fields).length === 0 && status === undefined) return badRequest("Nothing to update.");

  const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).single();
  if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 500 });

  // user_id and organization_id always come from the server session, never from the request.
  let lead: any = null;
  if (Object.keys(fields).length > 0) {
    const { data, error } = await supabase
      .from("leads")
      .upsert({ dot_number: dot, user_id: user.id, organization_id: profile.organization_id, ...fields }, { onConflict: "dot_number,user_id" })
      .select()
      .single();
    if (error) return rpcError(error);
    lead = data;
  }

  if (status !== undefined) {
    // A status change is an edit. It does not update last_called_at or the shift's call counter.
    const { data, error } = await supabase.rpc("set_lead_status", { p_dot: dot, p_status: status, p_key: key ?? null });
    if (error && isMigrationPending(error)) {
      // Database update not applied yet: fall back to a plain status edit (still without faking a call).
      const { data: valid } = await supabase
        .from("call_statuses")
        .select("value")
        .eq("value", status)
        .eq("organization_id", profile.organization_id)
        .maybeSingle();
      if (!valid) return badRequest("Invalid status.", "invalid_status");
      const { data: row, error: e2 } = await supabase
        .from("leads")
        .upsert({ dot_number: dot, user_id: user.id, organization_id: profile.organization_id, status }, { onConflict: "dot_number,user_id" })
        .select()
        .single();
      if (e2) return rpcError(e2);
      lead = row;
    } else if (error) {
      return rpcError(error);
    } else {
      lead = data;
    }
  }

  return NextResponse.json({ lead });
}

// Search, filter and page through the agent's own leads. All filtering happens in the database,
// before pagination, so a match is found no matter how many leads exist.
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  const p = request.nextUrl.searchParams;
  const asUserId = p.get("user_id"); // admin-only: view a teammate's leads

  let targetUserId = user.id;
  if (asUserId && asUserId !== user.id) {
    const { data: me } = await supabase.from("profiles").select("role, organization_id").eq("id", user.id).single();
    if (me?.role !== "admin") return NextResponse.json({ error: "Only admins can view another teammate's leads." }, { status: 403 });
    // Confirm the teammate really is in this admin's organization before using their id.
    const { data: target } = await createAdminClient().from("profiles").select("organization_id").eq("id", asUserId).maybeSingle();
    if (!target || target.organization_id !== me.organization_id) {
      return NextResponse.json({ error: "That user isn't in your organization." }, { status: 404 });
    }
    targetUserId = asUserId;
  }

  const limit = Math.min(Math.max(parseInt(p.get("limit") ?? "25", 10) || 25, 1), 100);
  const offset = Math.max(parseInt(p.get("offset") ?? "0", 10) || 0, 0);
  const q = (p.get("q") ?? "").trim().slice(0, 100);
  const status = p.get("status") || null;
  if (status && status.length > 50) return badRequest("Invalid status filter.");
  const callback = p.get("callback") || null;
  const sort = p.get("sort") || "recent";
  const tz = p.get("tz") || "UTC";

  const { data, error } = await supabase.rpc("search_leads", {
    p_q: q || null,
    p_status: status,
    p_important: p.get("important") === "1",
    p_saved: p.get("saved") === "1",
    p_callback: callback,
    p_dnc: p.get("dnc") === "1",
    p_tz: tz,
    p_limit: limit,
    p_offset: offset,
    p_sort: sort,
    p_user_id: targetUserId,
  });

  if (error && isMigrationPending(error)) {
    // Database update not applied yet: old behavior (first 500 leads, simple search), clearly flagged.
    let query = supabase
      .from("leads")
      .select("*, carriers(legal_name, dba_name, phone, phy_city, phy_state, power_units, docket_prefix, docket_number)")
      .eq("user_id", targetUserId)
      .order("updated_at", { ascending: false })
      .order("dot_number", { ascending: false })
      .limit(500);
    if (status) query = query.eq("status", status);
    if (p.get("saved") === "1") query = query.eq("saved", true);
    const legacy = await query;
    if (legacy.error) return rpcError(legacy.error);
    let rows = legacy.data ?? [];
    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter(
        (l: any) =>
          (l.carriers?.legal_name || "").toLowerCase().includes(needle) ||
          (l.carriers?.dba_name || "").toLowerCase().includes(needle) ||
          String(l.dot_number).includes(needle)
      );
    }
    return NextResponse.json({ leads: rows, total: rows.length, limit: rows.length, offset: 0, degraded: true });
  }
  if (error) return rpcError(error);

  return NextResponse.json({ leads: data?.rows ?? [], total: data?.total ?? 0, limit, offset, degraded: false });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;

  const dot = parseDot(request.nextUrl.searchParams.get("dot_number"));
  if (dot === null) return badRequest("dot_number is required.");

  const { error } = await supabase.from("leads").delete().eq("dot_number", dot).eq("user_id", user.id);
  if (error) return rpcError(error);
  return NextResponse.json({ ok: true });
}
