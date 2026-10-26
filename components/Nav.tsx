"use client";

import { flushAllDrafts, clearStoredDraftsForLogout } from "@/lib/useLeadSaver";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Phone, ListChecks, Clock, Settings, LogOut, Users, UserCircle, Coffee } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import ThemeToggle from "@/components/ThemeToggle";
import Logo from "@/components/Logo";

export default function Nav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const ping = () => fetch("/api/heartbeat", { method: "POST" }).catch(() => {});
    ping();
    const id = setInterval(ping, 45000);
    return () => clearInterval(id);
  }, []);

  const tabs = [
    { href: "/dial", label: "Dial", icon: Phone },
    { href: "/leads", label: "Leads", icon: ListChecks },
    { href: "/team", label: "Team", icon: Users },
    { href: "/log", label: "Log", icon: Clock },
    { href: "/attendance", label: "Attendance", icon: Coffee },
    ...(isAdmin ? [{ href: "/admin", label: "Admin", icon: Settings }] : []),
  ];

  async function signOut() {
    // Save any notes still waiting before the session ends, and never discard them silently.
    const { ok, failed } = await flushAllDrafts();
    if (!ok && !window.confirm(`${failed} note${failed === 1 ? "" : "s"} couldn't be saved. If you sign out now they will be lost. Sign out anyway?`)) {
      return;
    }
    clearStoredDraftsForLogout(); // drafts never outlive the login that typed them
    await supabase.auth.signOut();
    router.refresh();
    router.push("/login");
  }

  return (
    <>
      {/* Top bar: logo, main navigation (desktop and tablet), theme, account, sign out. Full width, 24px side padding. */}
      <header className="sticky top-0 z-30 border-b border-border bg-bg">
        <div className="flex h-14 items-center gap-6 px-6">
          <div className="flex items-center gap-2 shrink-0">
            <Logo variant="mark" className="h-7 w-auto" />
            <span className="font-display font-semibold tracking-wide text-accent-ink text-xs uppercase">
              Carrier Dialer
            </span>
          </div>

          <nav aria-label="Main" className="hidden md:flex items-center gap-1 flex-1 min-w-0">
            {tabs.map((tab) => {
              const active = pathname === tab.href;
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors ${
                    active ? "bg-accent/10 text-accent-ink" : "text-muted hover:bg-inset hover:text-ink"
                  }`}
                >
                  <Icon size={16} strokeWidth={active ? 2.4 : 1.9} />
                  {tab.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1 shrink-0">
            <ThemeToggle />
            <Link
              href="/account"
              aria-label="Account settings"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted hover:text-ink hover:bg-inset transition-colors"
            >
              <UserCircle size={18} strokeWidth={2} />
            </Link>
            <button
              onClick={signOut}
              aria-label="Sign out"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted hover:text-ink hover:bg-inset transition-colors"
            >
              <LogOut size={18} strokeWidth={2} />
            </button>
          </div>
        </div>
      </header>

      {/* Bottom tab bar: phones only (thumb-reachable). On larger screens the tabs live in the top bar. */}
      <nav
        aria-label="Main"
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-card"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          {tabs.map((tab) => {
            const active = pathname === tab.href;
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className="flex flex-col items-center gap-1 py-2.5 relative"
              >
                {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-accent" />}
                <Icon size={22} strokeWidth={active ? 2.4 : 1.8} className={active ? "text-accent-ink" : "text-muted"} />
                <span className={`text-xs ${active ? "text-ink font-medium" : "text-muted"}`}>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
