"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ThemeToggle from "@/components/ThemeToggle";
import Tile from "@/components/Tile";
import Logo from "@/components/Logo";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (searchParams.get("expired") === "1") {
      setError("You were signed out after an hour of inactivity (or from another device). Please sign in again.");
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }
    await fetch("/api/sessions/start", { method: "POST" }).catch(() => {});
    setLoading(false);
    router.refresh();
    router.push("/dial");
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-10 relative">
      <div className="absolute top-4 right-6">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md grid gap-4 animate-fade-in">
        <Tile className="text-center !py-8">
          <div className="mile-marker inline-block border-2 border-accent text-accent-ink px-3 py-1 text-sm font-semibold tracking-widest rounded-xl">
            DISPATCH
          </div>
          <h1 className="font-display text-2xl font-semibold mt-5 tracking-tight">
            Carrier Dialer
          </h1>
          <p className="text-muted text-sm mt-1.5">Sign in to start working carriers.</p>
        </Tile>

        <Tile label="Sign in">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-bad/10 border border-bad/40 text-bad text-sm rounded-xl px-3 py-2.5">
                {error}
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-inset border border-border rounded-xl px-3.5 py-2.5 min-h-[44px] text-ink focus:border-accent outline-none"
                autoComplete="email"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-inset border border-border rounded-xl px-3.5 py-2.5 min-h-[44px] text-ink focus:border-accent outline-none"
                autoComplete="current-password"
              />
            </div>
            <button type="submit" disabled={loading} className="btn btn-primary w-full min-h-[48px] text-base disabled:opacity-50">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </Tile>

        <p className="text-muted text-xs text-center">
          No account yet? Ask your admin to add you from the Admin panel, or{" "}
          <a href="/trial" className="text-accent-ink hover:underline">
            try it free
          </a>
          .
        </p>

        <div className="pt-4 border-t border-border flex flex-col items-center gap-2">
          <Logo variant="lockup" className="h-9 w-auto" />
          <p className="text-muted text-xs">
            Developed by Shah Zaib Ali ·{" "}
            <a
              href="mailto:mr.shahzaibali@yahoo.com"
              className="text-muted hover:text-accent-ink underline underline-offset-2 transition-colors"
            >
              mr.shahzaibali@yahoo.com
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
