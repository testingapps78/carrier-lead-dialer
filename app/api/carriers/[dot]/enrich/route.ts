import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { fetchMotusEnrichment } from "@/lib/motus";
import { fetchAuthorityInsurance } from "@/lib/fmcsa";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ dot: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const dotNumber = Number((await params).dot);
  if (!Number.isFinite(dotNumber)) {
    return NextResponse.json({ error: "Invalid DOT number." }, { status: 400 });
  }

  const { data: cached } = await supabase
    .from("carriers")
    .select("motus_details")
    .eq("dot_number", dotNumber)
    .maybeSingle();

  if (cached?.motus_details) {
    return NextResponse.json({ details: cached.motus_details, source: "cache" });
  }

  try {
    const [motus, authority] = await Promise.allSettled([
      fetchMotusEnrichment(dotNumber),
      fetchAuthorityInsurance(dotNumber),
    ]);

    const details = {
      ...(motus.status === "fulfilled" && motus.value ? motus.value : {}),
      authority: authority.status === "fulfilled" ? authority.value : null,
    };

    const hasAnything =
      (motus.status === "fulfilled" && motus.value) || (authority.status === "fulfilled" && authority.value);

    if (!hasAnything) {
      return NextResponse.json({ details: null, message: "No additional public record found for this carrier." });
    }

    const admin = createAdminClient();
    await admin.from("carriers").update({ motus_details: details }).eq("dot_number", dotNumber);
    return NextResponse.json({ details, source: "live" });
  } catch (err: any) {
    console.error("enrich error:", err);
    return NextResponse.json({ error: "Couldn't reach the additional records source right now." }, { status: 502 });
  }
}
