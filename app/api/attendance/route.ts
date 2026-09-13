import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  AttendanceEvent,
  EventType,
  computeShiftSummary,
  getNextAction,
  isLikelyDuplicate,
  resolveShiftDateForNewEvent,
  todayInTimezone,
} from "@/lib/attendance";

export const dynamic = "force-dynamic";

const VALID_ACTIONS: EventType[] = ["CHECK_IN", "BREAK_OUT", "BREAK_IN", "CHECK_OUT"];

async function getContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, attendance_shift_type_id")
    .eq("id", user.id)
    .single();
  if (!profile) return null;

  const { data: org } = await supabase
    .from("organizations")
    .select("timezone")
    .eq("id", profile.organization_id)
    .single();

  let shiftType = null;
  if (profile.attendance_shift_type_id) {
    const { data } = await supabase
      .from("attendance_shift_types")
      .select("*")
      .eq("id", profile.attendance_shift_type_id)
      .single();
    shiftType = data;
  } else {
    const { data } = await supabase
      .from("attendance_shift_types")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("is_default", true)
      .maybeSingle();
    shiftType = data;
  }

  return {
    user,
    organizationId: profile.organization_id as string,
    timeZone: (org?.timezone as string) ?? "UTC",
    shiftType,
  };
}

// GET: today's live status + running summary for the signed-in employee.
export async function GET() {
  const supabase = await createClient();
  const ctx = await getContext(supabase);
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: lastEventRow } = await supabase
    .from("attendance_events")
    .select("*")
    .eq("user_id", ctx.user.id)
    .order("event_timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastEvent = (lastEventRow as AttendanceEvent) ?? null;

  const { status, allowedActions, shiftDate } = getNextAction(lastEvent, new Date(), ctx.timeZone);

  const activeShiftDate = shiftDate ?? lastEvent?.shift_date ?? todayInTimezone(ctx.timeZone);
  const { data: todaysEvents } = await supabase
    .from("attendance_events")
    .select("*")
    .eq("user_id", ctx.user.id)
    .eq("shift_date", activeShiftDate)
    .order("event_timestamp", { ascending: true });

  const summary = computeShiftSummary(
    (todaysEvents as AttendanceEvent[]) ?? [],
    ctx.shiftType,
    new Date(),
    ctx.timeZone
  );

  return NextResponse.json({
    status,
    allowedActions,
    shiftType: ctx.shiftType,
    summary,
  });
}

// POST: record a CHECK_IN / BREAK_OUT / BREAK_IN / CHECK_OUT for the signed-in employee.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const ctx = await getContext(supabase);
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const action = body?.action as EventType;
  if (!VALID_ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Invalid or missing action." }, { status: 400 });
  }

  const { data: lastEventRow } = await supabase
    .from("attendance_events")
    .select("*")
    .eq("user_id", ctx.user.id)
    .order("event_timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastEvent = (lastEventRow as AttendanceEvent) ?? null;

  const { allowedActions } = getNextAction(lastEvent, new Date(), ctx.timeZone);
  if (!allowedActions.includes(action)) {
    return NextResponse.json(
      { error: `You can't ${action.replace("_", " ").toLowerCase()} right now.` },
      { status: 400 }
    );
  }

  const now = new Date();
  let shiftDate: string;
  try {
    shiftDate = resolveShiftDateForNewEvent(action, lastEvent, now, ctx.timeZone);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const duplicate = isLikelyDuplicate(lastEvent, action, now);

  const { data, error } = await supabase
    .from("attendance_events")
    .insert({
      organization_id: ctx.organizationId,
      user_id: ctx.user.id,
      event_type: action,
      event_timestamp: now.toISOString(),
      shift_date: shiftDate,
      source: "WEB",
      is_duplicate: duplicate,
      created_by: ctx.user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ event: data, wasDuplicate: duplicate });
    }
