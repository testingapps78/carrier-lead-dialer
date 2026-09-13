import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { AttendanceEvent, computeShiftSummary, getNextAction, todayInTimezone } from "@/lib/attendance";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: caller } = await supabase.from("profiles").select("role, organization_id").eq("id", user.id).single();
  if (caller?.role !== "admin") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const orgId = caller.organization_id;
  const admin = createAdminClient();
  const now = new Date();

  const { data: org } = await admin.from("organizations").select("timezone").eq("id", orgId).single();
  const timeZone = (org?.timezone as string) ?? "UTC";

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, attendance_shift_type_id")
    .eq("organization_id", orgId);

  const { data: shiftTypes } = await admin.from("attendance_shift_types").select("*").eq("organization_id", orgId);
  const defaultShiftType = (shiftTypes ?? []).find((s: any) => s.is_default) ?? null;
  const shiftTypeById = new Map((shiftTypes ?? []).map((s: any) => [s.id, s]));

  const cutoff = new Date(now.getTime() - 30 * 3600 * 1000).toISOString();
  const { data: recentEvents } = await admin
    .from("attendance_events")
    .select("*")
    .eq("organization_id", orgId)
    .gte("event_timestamp", cutoff)
    .order("event_timestamp", { ascending: true });

  const eventsByUser = new Map<string, AttendanceEvent[]>();
  for (const e of (recentEvents ?? []) as AttendanceEvent[]) {
    const list = eventsByUser.get(e.user_id) ?? [];
    list.push(e);
    eventsByUser.set(e.user_id, list);
  }

  type Row = {
    userId: string;
    name: string;
    status: string;
    allowedActions: string[];
    shiftDate: string;
    summary: ReturnType<typeof computeShiftSummary>;
  };

  const rows: Row[] = (profiles ?? []).map((p: { id: string; full_name: string | null; attendance_shift_type_id: string | null }) => {
    const userEvents = eventsByUser.get(p.id) ?? [];
    const lastEvent = userEvents[userEvents.length - 1] ?? null;
    const { status, allowedActions, shiftDate } = getNextAction(lastEvent, now, timeZone);
    const activeShiftDate = shiftDate ?? lastEvent?.shift_date ?? todayInTimezone(timeZone, now);
    const shiftEvents = userEvents.filter((e) => e.shift_date === activeShiftDate);
    const shiftType = p.attendance_shift_type_id ? shiftTypeById.get(p.attendance_shift_type_id) ?? null : defaultShiftType;
    const summary = computeShiftSummary(shiftEvents, shiftType, now, timeZone);

    return { userId: p.id, name: p.full_name || "—", status, allowedActions, shiftDate: activeShiftDate, summary };
  });

  const counts = {
    total: rows.length,
    working: rows.filter((r) => r.status === "WORKING").length,
    onBreak: rows.filter((r) => r.status === "ON_BREAK").length,
    checkedOut: rows.filter((r) => r.status === "CHECKED_OUT").length,
    notCheckedIn: rows.filter((r) => r.status === "NOT_CHECKED_IN").length,
    missingCheckout: rows.filter((r) => r.status === "MISSING_CHECKOUT").length,
    late: rows.filter((r) => (r.summary.lateMinutes ?? 0) > 0).length,
    overtime: rows.filter((r) => (r.summary.overtimeMinutes ?? 0) > 0).length,
  };

  return NextResponse.json({ rows, counts, timeZone });
}
