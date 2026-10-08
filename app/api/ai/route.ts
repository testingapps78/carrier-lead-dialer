import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { AiBusyError, AiNotConfiguredError, aiConfigured, aiJson } from "@/lib/ai";
import { buildPrompt, normalizeResult, type AiTask } from "@/lib/aiPrompts";
import type { Carrier } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TASKS: AiTask[] = ["coach", "notes", "followup"];

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const task = body.task as AiTask;
  const dot = Number(body.dot_number);
  if (!TASKS.includes(task) || !Number.isFinite(dot)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (!aiConfigured()) {
    return NextResponse.json({ error: "AI isn't set up yet.", code: "not_configured" }, { status: 503 });
  }

  // Carrier facts come from our own database, never from the browser.
  const admin = createAdminClient();
  const { data: carrierRow } = await admin.from("carriers").select("*").eq("dot_number", dot).maybeSingle();
  if (!carrierRow) return NextResponse.json({ error: "Carrier not found." }, { status: 404 });

  const [leadRes, settingsRes, statusRes, feedbackRes] = await Promise.all([
    supabase.from("leads").select("status, notes").eq("user_id", user.id).eq("dot_number", dot).maybeSingle(),
    supabase.from("ai_settings").select("display_name, company_name, offer, style_notes").eq("user_id", user.id).maybeSingle(),
    supabase.from("call_statuses").select("value, label").order("sort_order"),
    supabase
      .from("ai_feedback")
      .select("rating, comment")
      .eq("user_id", user.id)
      .eq("task", task)
      .neq("comment", "")
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  const notes = typeof body.notes === "string" ? body.notes : leadRes.data?.notes ?? "";
  if (task === "notes" && !notes.trim()) {
    return NextResponse.json({ error: "Type a few rough notes first, then tap Clean up notes." }, { status: 400 });
  }

  const statuses = (statusRes.data ?? []) as { value: string; label: string }[];
  const prompt = buildPrompt({
    task,
    carrier: carrierRow as Carrier,
    settings: {
      display_name: settingsRes.data?.display_name ?? "",
      company_name: settingsRes.data?.company_name ?? "",
      offer: settingsRes.data?.offer ?? "",
      style_notes: settingsRes.data?.style_notes ?? "",
    },
    notes,
    leadStatus: leadRes.data?.status ?? null,
    statuses,
    feedback: (feedbackRes.data ?? []) as { rating: number; comment: string }[],
  });

  try {
    const raw = await aiJson(prompt.system, prompt.user, prompt.maxTokens);
    const result = normalizeResult(task, raw, statuses.map((s) => s.value));
    return NextResponse.json({ task, result });
  } catch (err: any) {
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: err.message, code: "not_configured" }, { status: 503 });
    }
    if (err instanceof AiBusyError) {
      return NextResponse.json({ error: err.message, code: "busy" }, { status: 429 });
    }
    console.error("ai route error:", err?.message);
    return NextResponse.json({ error: err?.message || "AI request failed." }, { status: 500 });
  }
}
