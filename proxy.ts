import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Public anon values — see lib/supabase/client.ts for why a fallback is safe here.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qqvakzfncybcvfbobetl.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxdmFremZuY3liY3ZmYm9iZXRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2ODMyMTQsImV4cCI6MjEwMzI1OTIxNH0.E7husFPFmvYcNoQc14GL4PFwjtzs4LCI7bxSgtDrebs";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthRoute = request.nextUrl.pathname.startsWith("/login");
  const isPublicRoute =
    isAuthRoute ||
    request.nextUrl.pathname.startsWith("/trial") ||
    request.nextUrl.pathname.startsWith("/api/trial");
  const isPublicAsset = request.nextUrl.pathname.startsWith("/_next");

  if (user && !isPublicRoute) {
    const sessionStart = request.cookies.get("cd_session_start")?.value;
    const sessionId = request.cookies.get("cd_session_id")?.value;
    const ONE_HOUR = 60 * 60 * 1000;

    if (!sessionStart) {
      // No tracked start time yet — either this is a session from before
      // this feature existed, or the post-login call that sets it hasn't
      // landed. Either way, "unknown" must start the clock now, not be
      // treated as "already expired", or nobody could ever stay logged in.
      response.cookies.set("cd_session_start", new Date().toISOString(), {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
      });
    } else {
      const ageMs = Date.now() - new Date(sessionStart).getTime();

      let revoked = false;
      if (sessionId) {
        const { data: sessionRow } = await supabase
          .from("user_sessions")
          .select("revoked")
          .eq("id", sessionId)
          .maybeSingle();
        revoked = !!sessionRow?.revoked;
      }

      if (ageMs > ONE_HOUR || revoked) {
        await supabase.auth.signOut();
        const url = request.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("expired", "1");
        const redirect = NextResponse.redirect(url);
        redirect.cookies.delete("cd_session_start");
        redirect.cookies.delete("cd_session_id");
        return redirect;
      }
    }
  }

  if (!user && !isPublicRoute && !isPublicAsset) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dial";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
