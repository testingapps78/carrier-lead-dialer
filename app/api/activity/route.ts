import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// The browser pings this (at most every couple of minutes) while a person is
// actually tapping, typing or scrolling. The middleware treats any non-passive
// request as activity and refreshes the idle clock; nothing else to do here.
export async function POST() {
  return NextResponse.json({ ok: true });
}
