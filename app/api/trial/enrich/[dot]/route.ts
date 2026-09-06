import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { fetchMotusEnrichment } from "@/lib/motus";
import { fetchAuthorityInsurance } from "@/lib/fmcsa";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ dot: string }> }) {
  const dotNumber = Number((await params).dot);
  if (!Number.isFinite(dotNumber)) {
    return NextResponse.json({ error: "Invalid DOT number." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: cached } = await admin.from("carriers").select("motus_details").eq("dot_number", dotNumber).maybeSingle();
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

    await admin.from("carriers").update({ motus_details: details }).eq("dot_number", dotNumber);
    return NextResponse.json({ details, source: "live" });
  } catch (err) {
    console.error("trial enrich error:", err);
    return NextResponse.json({ error: "Couldn't reach the additional records source right now." }, { status: 502 });
  }
}
