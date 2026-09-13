import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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

export async function GET() {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("attendance_shift_types")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shiftTypes: data ?? [] });
}

export async function POST(request: NextRequest) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body?.name || !body?.startTime || !body?.endTime) {
    return NextResponse.json({ error: "name, startTime, and endTime are required." }, { status: 400 });
  }
  const admin = createAdminClient();

  if (body.isDefault) {
    await admin
      .from("attendance_shift_types")
      .update({ is_default: false })
      .eq("organization_id", ctx.organizationId)
      .eq("is_default", true);
  }

  const { data, error } = await admin
    .from("attendance_shift_types")
    .insert({
      organization_id: ctx.organizationId,
      name: body.name,
      start_time: body.startTime,
      end_time: body.endTime,
      grace_minutes: body.graceMinutes ?? 0,
      expected_break_minutes: body.expectedBreakMinutes ?? 0,
      max_break_minutes: body.maxBreakMinutes ?? null,
      overtime_enabled: body.overtimeEnabled ?? true,
      overtime_threshold_minutes: body.overtimeThresholdMinutes ?? 0,
      pre_shift_overtime_allowed: body.preShiftOvertimeAllowed ?? false,
      post_shift_overtime_allowed: body.postShiftOvertimeAllowed ?? true,
      working_days: body.workingDays ?? [1, 2, 3, 4, 5],
      is_default: body.isDefault ?? false,
      is_active: body.isActive ?? true,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shiftType: data });
}

export async function PATCH(request: NextRequest) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("attendance_shift_types")
    .select("id, organization_id")
    .eq("id", body.id)
    .single();
  if (!existing || existing.organization_id !== ctx.organizationId) {
    return NextResponse.json({ error: "Shift type not found." }, { status: 404 });
  }

  if (body.isDefault) {
    await admin
      .from("attendance_shift_types")
      .update({ is_default: false })
      .eq("organization_id", ctx.organizationId)
      .eq("is_default", true);
  }

  const updates: Record<string, unknown> = {};
  const fieldMap: Record<string, string> = {
    name: "name",
    startTime: "start_time",
    endTime: "end_time",
    graceMinutes: "grace_minutes",
    expectedBreakMinutes: "expected_break_minutes",
    maxBreakMinutes: "max_break_minutes",
    overtimeEnabled: "overtime_enabled",
    overtimeThresholdMinutes: "overtime_threshold_minutes",
    preShiftOvertimeAllowed: "pre_shift_overtime_allowed",
    postShiftOvertimeAllowed: "post_shift_overtime_allowed",
    workingDays: "working_days",
    isDefault: "is_default",
    isActive: "is_active",
  };
  for (const [key, column] of Object.entries(fieldMap)) {
    if (body[key] !== undefined) updates[column] = body[key];
  }

  const { data, error } = await admin
    .from("attendance_shift_types")
    .update(updates)
    .eq("id", body.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ shiftType: data });
}
