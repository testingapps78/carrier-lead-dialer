"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Phone, ListChecks, Clock, Settings, LogOut, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import ThemeToggle from "@/components/ThemeToggle";

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
    ...(isAdmin ? [{ href: "/admin", label: "Admin", icon: Settings }] : []),
  ];

  async function signOut() {
    await supabase.auth.signOut();
    router.refresh();
    router.push("/login");
  }

  return (
    <>
      {/* Slim top bar — identity + sign out, no nav links here anymore */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-canvas/85 backdrop-blur-md">
        <div className="max-w-3xl mx-auto px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo-mark.png" alt="" className="h-5 w-auto opacity-90" />
            <span className="font-display font-semibold tracking-wide text-accent text-xs uppercase">
              Carrier Dialer
            </span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              onClick={signOut}
              aria-label="Sign out"
              className="text-muted hover:text-ink transition-colors p-1.5 rounded-full hover:bg-surface2"
            >
              <LogOut size={16} strokeWidth={2} />
            </button>
          </div>
        </div>
      </header>

      {/* Bottom tab bar — the primary navigation, thumb-reachable on a phone */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 border-t border-border/60 bg-surface/95 backdrop-blur-md"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="max-w-3xl mx-auto grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          {tabs.map((tab) => {
            const active = pathname === tab.href;
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className="flex flex-col items-center gap-1 py-2.5 relative"
              >
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-accent" />
                )}
                <Icon
                  size={22}
                  strokeWidth={active ? 2.4 : 1.8}
                  className={active ? "text-accent" : "text-muted"}
                />
                <span className={`text-[11px] ${active ? "text-ink font-medium" : "text-muted"}`}>
                  {tab.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
