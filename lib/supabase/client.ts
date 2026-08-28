import { createBrowserClient } from "@supabase/ssr";

// These two are the public "anon" values — safe to ship in client code by
// design (Supabase's row-level security is what actually protects data, not
// secrecy of this key). Falls back to the project's real values so the app
// works without extra setup; override via env vars if you ever rotate them.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://qqvakzfncybcvfbobetl.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxdmFremZuY3liY3ZmYm9iZXRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2ODMyMTQsImV4cCI6MjEwMzI1OTIxNH0.E7husFPFmvYcNoQc14GL4PFwjtzs4LCI7bxSgtDrebs";

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
