import { NextRequest, NextResponse } from "next/server";
import { requireUser, rpcError } from "@/lib/leadApi";

export const dynamic = "force-dynamic";

// Callback and Do Not Call counts computed in the database over ALL of the agent's leads,
// not over whichever page happens to be loaded.
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const tz = request.nextUrl.searchParams.get("tz") || "UTC";
  const { data, error } = await auth.supabase.rpc("lead_callback_counts", { p_tz: tz });
  if (error) return rpcError(error);
  return NextResponse.json({ counts: data });
}
