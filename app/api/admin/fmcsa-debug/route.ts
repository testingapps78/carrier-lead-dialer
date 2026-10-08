import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Admin-only diagnostic: shows exactly what FMCSA's sources return for one carrier,
// so we can see which fields actually carry the owner/officer and business names.
// Usage: /api/admin/fmcsa-debug?dot=515973
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const dot = Number(request.nextUrl.searchParams.get("dot"));
  if (!Number.isFinite(dot) || dot <= 0) {
    return NextResponse.json({ error: "Add ?dot=<DOT number> to the URL." }, { status: 400 });
  }

  const out: Record<string, unknown> = { dot };

  // 1) The census file we use today.
  try {
    const appToken = process.env.SOCRATA_APP_TOKEN;
    const res = await fetch(`https://data.transportation.gov/resource/az4n-8mr2.json?dot_number=${dot}`, {
      headers: appToken ? { "X-App-Token": appToken, Accept: "application/json" } : { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    const body = await res.json().catch(() => null);
    const row = Array.isArray(body) ? body[0] : null;
    out.census = {
      status: res.status,
      field_names: row ? Object.keys(row) : null,
      record: row ?? body,
    };
  } catch (e: any) {
    out.census = { error: String(e?.message || e) };
  }

  // 2) FMCSA's QCMobile API (needs a WebKey from the FMCSA developer site).
  const webKey = process.env.FMCSA_WEBKEY;
  if (!webKey) {
    out.qcmobile = "FMCSA_WEBKEY is not set in Vercel, so this source was skipped.";
  } else {
    try {
      const res = await fetch(
        `https://mobile.fmcsa.dot.gov/qc/services/carriers/${dot}?webKey=${encodeURIComponent(webKey)}`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) }
      );
      const text = await res.text();
      let body: unknown = text.slice(0, 4000);
      try {
        body = JSON.parse(text);
      } catch {
        /* keep the raw text */
      }
      out.qcmobile = { status: res.status, body };
    } catch (e: any) {
      out.qcmobile = { error: String(e?.message || e) };
    }
  }

  return new NextResponse(JSON.stringify(out, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
