import { cookies, headers } from "next/headers";
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

async function getClientIp(): Promise<string> {
  const h = await headers();
  // Vercel sets x-forwarded-for; take the first (client) address in the chain.
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") || "unknown";
}

// Reads (or creates) the visitor's anonymous trial cookie, checks and
// increments their usage atomically, and applies two soft protections: a
// per-IP total (so clearing cookies alone doesn't reset the trial, since the
// same network is still recognized) and a light recency check against
// scripted hammering. Neither is meant to be airtight — someone on a VPN or
// a shared office IP can still work around this — matching what was asked
// for: real friction, not a hard technical wall.
export async function checkAndConsumeTrial(): Promise<TrialCheckResult> {
  const cookieStore = await cookies();
  let anonId = cookieStore.get(COOKIE_NAME)?.value;
  const ip = await getClientIp();

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
    const secondsSinceLast = (Date.now() - new Date(existing.last_seen_at).getTime()) / 1000;
    if (secondsSinceLast < MIN_SECONDS_BETWEEN_REQUESTS) {
      return { allowed: false, remaining: Math.max(0, TRIAL_LIMIT - existing.searches_used), reason: "too_fast" };
    }
  }

  // Check the IP-wide total before checking this specific cookie's count —
  // this is what catches a cleared cookie on the same network.
  if (ip !== "unknown") {
    const { data: ipTotal } = await admin.rpc("trial_usage_for_ip", { p_ip: ip });
    if (typeof ipTotal === "number" && ipTotal >= TRIAL_LIMIT) {
      return { allowed: false, remaining: 0, reason: "limit_reached" };
    }
  }

  if (existing && existing.searches_used >= TRIAL_LIMIT) {
    return { allowed: false, remaining: 0, reason: "limit_reached" };
  }

  const { data: newCount } = await admin.rpc("trial_increment", { p_anon_id: anonId });
  const used = typeof newCount === "number" ? newCount : (existing?.searches_used ?? 0) + 1;

  // Record the IP alongside this row (upsert already happened in trial_increment).
  admin.from("trial_usage").update({ ip_address: ip }).eq("anon_id", anonId).then(() => {}, () => {});

  return { allowed: true, remaining: Math.max(0, TRIAL_LIMIT - used) };
}

export { TRIAL_LIMIT };
