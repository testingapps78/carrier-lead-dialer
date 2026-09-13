import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ACTION_TYPES = [
  "add_missing_checkin",
  "add_missing_checkout",
  "add_break_out",
  "add_break_in",
  "resolve_incomplete_break",
  "mark_absent",
  "mark_leave",
  "mark_holiday",
] as const;

const EVENT_TYPE_BY_ACTION: Record<string, string> = {
  add_missing_checkin: "CHECK_IN",
  add_missing_checkout: "CHECK_OUT",
  add_break_out: "BREAK_OUT",
  add_break_in: "BREAK_IN",
  resolve_incomplete_break: "BREAK_IN",
};

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role, organization_id").eq("id", user.id).single();
  if (profile?.role !== "admin") return null;
  return { user, organizationId: profile.organization_id as string };
}

// POST: record a manual correction or force-action. Every raw event this
// creates is tagged source: "ADMIN" so it never looks like a normal
// employee-generated event, and a matching attendance_corrections row is
// always written alongside it as a permanent audit trail.
export async function POST(request: NextRequest) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const body = await request.json().catch(() => null);
  const { userId, actionType, reason, timestamp, shiftDate } = body ?? {};

  if (!userId || !ACTION_TYPES.includes(actionType) || !reason?.trim()) {
    return NextResponse.json({ error: "userId, a valid actionType, and a reason are required." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: targetProfile } = await admin
    .from("profiles")
    .select("id, organization_id")
    .eq("id", userId)
    .single();
  if (!targetProfile || targetProfile.organization_id !== ctx.organizationId) {
    return NextResponse.json({ error: "Employee not found in your organization." }, { status: 404 });
  }

  let createdEvent = null;
  const resolvedShiftDate = shiftDate ?? new Date().toISOString().slice(0, 10);

  if (EVENT_TYPE_BY_ACTION[actionType]) {
    if (!shiftDate) {
      return NextResponse.json({ error: "shiftDate is required for this action." }, { status: 400 });
    }
    const eventTimestamp = timestamp ? new Date(timestamp) : new Date();
    const { data: inserted, error: insertError } = await admin
      .from("attendance_events")
      .insert({
        organization_id: ctx.organizationId,
        user_id: userId,
        event_type: EVENT_TYPE_BY_ACTION[actionType],
        event_timestamp: eventTimestamp.toISOString(),
        shift_date: shiftDate,
        source: "ADMIN",
        notes: reason,
        created_by: ctx.user.id,
      })
      .select()
      .single();
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
    createdEvent = inserted;
  }

  const { data: correction, error: correctionError } = await admin
    .from("attendance_corrections")
    .insert({
      organization_id: ctx.organizationId,
      user_id: userId,
      shift_date: resolvedShiftDate,
      action_type: actionType,
      related_event_id: createdEvent?.id ?? null,
      new_value: createdEvent ? { event_timestamp: createdEvent.event_timestamp } : { note: actionType },
      reason,
      performed_by: ctx.user.id,
    })
    .select()
    .single();
  if (correctionError) return NextResponse.json({ error: correctionError.message }, { status: 500 });

  return NextResponse.json({ event: createdEvent, correction });
}

// GET: correction/audit history for the org (optionally filtered to one employee).
export async function GET(request: NextRequest) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const admin = createAdminClient();
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  let query = admin
    .from("attendance_corrections")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (userId) query = query.eq("user_id", userId);

  const { data: corrections, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: profiles } = await admin.from("profiles").select("id, full_name").eq("organization_id", ctx.organizationId);
  const nameById = new Map((profiles ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name || "—"]));

  const enriched = (corrections ?? []).map((c: any) => ({
    ...c,
    employee_name: nameById.get(c.user_id) ?? "—",
    performed_by_name: nameById.get(c.performed_by) ?? "—",
  }));

  return NextResponse.json({ corrections: enriched });
}
