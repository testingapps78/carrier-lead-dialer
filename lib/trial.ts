import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";

const COOKIE_NAME = "cd_trial_id";
const TRIAL_LIMIT = 10;
const MIN_SECONDS_BETWEEN_REQUESTS = 1.5;

export interface TrialCheckResult {
  allowed: boolean;
  remaining: number;
  reason?: "limit_reached" | "too_fast";
}

// Reads (or creates) the visitor's anonymous trial cookie, checks and
// increments their usage atomically, and applies a light recency check so a
// script can't hammer a single anon id in a tight loop. This is intentionally
// a soft gate — someone can reset it by clearing cookies — matching what was
// actually asked for (a nudge, not an enforced paywall).
export async function checkAndConsumeTrial(): Promise<TrialCheckResult> {
  const cookieStore = await cookies();
  let anonId = cookieStore.get(COOKIE_NAME)?.value;

  if (!anonId) {
    anonId = randomUUID();
    cookieStore.set(COOKIE_NAME, anonId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("trial_usage")
    .select("searches_used, last_seen_at")
    .eq("anon_id", anonId)
    .maybeSingle();

  if (existing) {
    if (existing.searches_used >= TRIAL_LIMIT) {
      return { allowed: false, remaining: 0, reason: "limit_reached" };
    }
    const secondsSinceLast = (Date.now() - new Date(existing.last_seen_at).getTime()) / 1000;
    if (secondsSinceLast < MIN_SECONDS_BETWEEN_REQUESTS) {
      return { allowed: false, remaining: TRIAL_LIMIT - existing.searches_used, reason: "too_fast" };
    }
  }

  const { data: newCount } = await admin.rpc("trial_increment", { p_anon_id: anonId });
  const used = typeof newCount === "number" ? newCount : (existing?.searches_used ?? 0) + 1;

  return { allowed: true, remaining: Math.max(0, TRIAL_LIMIT - used) };
}

export { TRIAL_LIMIT };
