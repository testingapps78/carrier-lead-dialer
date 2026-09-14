"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ThemeToggle from "@/components/ThemeToggle";

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
      setError("Your session ended (1 hour limit, or signed out remotely). Please sign in again.");
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
    <main className="min-h-screen flex items-center justify-center px-4 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-8 text-center">
          <div className="mile-marker inline-block border-2 border-accent text-accent px-3 py-1 text-sm font-semibold tracking-widest rounded-lg glow-accent">
            DISPATCH
          </div>
          <h1 className="font-display text-3xl font-semibold mt-5 tracking-tight">
            Carrier Dialer
          </h1>
          <p className="text-muted text-sm mt-1.5">Sign in to start working carriers.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-surface elevated border border-border/60 rounded-2xl p-6 space-y-4">
          {error && (
            <div className="bg-bad/10 border border-bad/40 text-bad text-sm rounded-lg px-3 py-2.5">
              {error}
            </div>
          )}
          <div>
            <label className="block text-xs uppercase tracking-wide text-muted mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-surface2 border border-border rounded-lg px-3.5 py-2.5 text-ink focus:border-accent outline-none"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-muted mb-1.5">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-surface2 border border-border rounded-lg px-3.5 py-2.5 text-ink focus:border-accent outline-none"
              autoComplete="current-password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent glow-accent text-oncolor font-semibold rounded-lg py-3 hover:bg-accent/90 disabled:opacity-50 transition-all"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="text-muted text-xs text-center mt-5">
          No account yet? Ask your admin to add you from the Admin panel, or{" "}
          <a href="/trial" className="text-accent hover:underline">
            try it free
          </a>
          .
        </p>

        <div className="mt-10 pt-6 border-t border-border/40 flex flex-col items-center gap-2">
          <img src="/logo-lockup.png" alt="Carrier Dialer" className="h-9 w-auto opacity-80" />
          <p className="text-muted text-xs">
            Developed by Shah Zaib Ali ·{" "}
            <a
              href="mailto:mr.shahzaibali@yahoo.com"
              className="text-muted hover:text-accent underline underline-offset-2 transition-colors"
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
