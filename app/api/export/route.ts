import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function toCsvValue(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => toCsvValue(row[h])).join(","));
  }
  return lines.join("\n");
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const kind = params.get("kind") || "leads"; // "leads" | "shifts" | "saved"
  const from = params.get("from"); // ISO date
  const to = params.get("to"); // ISO date
  const requestedUserId = params.get("user_id");

  let targetUserId = user.id;
  if (requestedUserId && requestedUserId !== user.id) {
    const { data: profile } = await supabase.from("profiles").select("role, organization_id").eq("id", user.id).single();
    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Only admins can export another teammate's data." }, { status: 403 });
    }
    // Service-role calls below bypass RLS, so confirm the target is
    // actually in this admin's own organization before using their id.
    const admin0 = createAdminClient();
    const { data: target } = await admin0.from("profiles").select("organization_id").eq("id", requestedUserId).maybeSingle();
    if (!target || target.organization_id !== profile.organization_id) {
      return NextResponse.json({ error: "That user isn't in your organization." }, { status: 404 });
    }
    targetUserId = requestedUserId;
  }

  const admin = createAdminClient();

  if (kind === "shifts") {
    let query = admin.from("shifts").select("*").eq("user_id", targetUserId).order("check_in", { ascending: false });
    if (from) query = query.gte("check_in", from);
    if (to) query = query.lte("check_in", to + "T23:59:59");
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []).map((s: any) => ({
      check_in: s.check_in,
      check_out: s.check_out ?? "",
      mode: s.mode ?? "",
      start_number: s.start_number ?? "",
      end_number: s.end_number ?? "",
      carriers_covered: s.start_number && s.end_number ? Math.abs(s.end_number - s.start_number) + 1 : "",
      carriers_viewed: s.carriers_viewed,
      carriers_logged: s.carriers_logged,
    }));

    return new NextResponse(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="shifts-${targetUserId.slice(0, 8)}.csv"`,
      },
    });
  }

  if (kind === "saved") {
    const { data, error } = await admin
      .from("leads")
      .select("*, carriers(*)")
      .eq("user_id", targetUserId)
      .eq("saved", true)
      .order("saved_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []).map((l: any) => {
      const c = l.carriers ?? {};
      const m = c.motus_details ?? {};
      const officials: any[] = Array.isArray(m.officials) ? m.officials : [];
      const owners = [
        ...officials.map((o) => [o.name, o.title].filter(Boolean).join(" - ")),
        ...[c.company_rep1, c.company_rep2].filter(Boolean),
      ];
      const emails = [c.email, m.businessEmail, ...officials.map((o) => o.email)].filter(Boolean);
      const trucks = (Array.isArray(m.vehicles) ? m.vehicles : [])
        .map((v: any) => `${v.type}: ${v.owned || 0} owned${v.leased ? `, ${v.leased} leased` : ""}`)
        .join("; ");
      return {
        mc_number: c.docket_number ? `${c.docket_prefix || "MC"}-${c.docket_number}` : "",
        dot_number: l.dot_number,
        legal_name: c.legal_name ?? "",
        dba_name: c.dba_name ?? "",
        owner_names: Array.from(new Set(owners)).join(" | "),
        phone: c.phone ?? "",
        cell_phone: c.cell_phone ?? "",
        email: Array.from(new Set(emails)).join(" | "),
        truck_types: trucks,
        power_units: c.power_units ?? "",
        cargo: Array.isArray(m.cargoClasses) ? m.cargoClasses.join("; ") : "",
        city: c.phy_city ?? "",
        state: c.phy_state ?? "",
        registered_since: c.add_date ?? "",
        status: l.status,
        notes: l.notes ?? "",
        saved_at: l.saved_at ?? "",
      };
    });

    // BOM so Excel opens the UTF-8 file with correct characters.
    return new NextResponse("\uFEFF" + toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="saved-mcs-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  let query = admin
    .from("leads")
    .select("*, carriers(legal_name, dba_name, phone, phy_city, phy_state, power_units, docket_prefix, docket_number)")
    .eq("user_id", targetUserId)
    .order("updated_at", { ascending: false });
  if (from) query = query.gte("updated_at", from);
  if (to) query = query.lte("updated_at", to + "T23:59:59");
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map((l: any) => ({
    dot_number: l.dot_number,
    mc_number: l.carriers?.docket_number ?? "",
    legal_name: l.carriers?.legal_name ?? "",
    phone: l.carriers?.phone ?? "",
    city: l.carriers?.phy_city ?? "",
    state: l.carriers?.phy_state ?? "",
    power_units: l.carriers?.power_units ?? "",
    status: l.status,
    priority: l.priority,
    notes: l.notes ?? "",
    reminder_date: l.reminder_date ?? "",
    last_called_at: l.last_called_at ?? "",
    updated_at: l.updated_at,
  }));

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="leads-${targetUserId.slice(0, 8)}.csv"`,
    },
  });
}
