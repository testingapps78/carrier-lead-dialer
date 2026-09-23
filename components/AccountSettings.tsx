"use client";

import { useEffect, useState } from "react";
import { KeyRound, Monitor, LogOut } from "lucide-react";
import { describeUserAgent } from "@/lib/userAgent";

interface SessionRow {
  id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  last_active_at: string;
}

export default function AccountSettings() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);

  function loadSessions() {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((d) => {
        setSessions(d.sessions ?? []);
        setCurrentSessionId(d.currentSessionId ?? null);
      })
      .finally(() => setLoadingSessions(false));
  }

  useEffect(loadSessions, []);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setPwError(null);
    setPwSuccess(false);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPwSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
    } catch (e: any) {
      setPwError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(id: string) {
    if (id === currentSessionId) {
      if (!confirm("This is your current device — revoking it will sign you out right now. Continue?")) return;
    }
    await fetch("/api/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (id === currentSessionId) {
      window.location.href = "/login";
      return;
    }
    loadSessions();
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-5 pb-28">
      <h1 className="font-display text-2xl font-semibold tracking-tight mb-4">Account</h1>

      <div className="bg-surface border border-border rounded-xl p-5 mb-6">
        <h2 className="font-display text-lg font-semibold mb-1 flex items-center gap-2">
          <KeyRound size={16} /> Change password
        </h2>
        <p className="text-muted text-sm mb-4">You'll stay signed in on this device after changing it.</p>

        {pwSuccess && <div className="bg-good/10 border border-good/40 text-good text-sm rounded-lg px-3 py-2 mb-3">Password updated.</div>}
        {pwError && <div className="bg-bad/10 border border-bad/40 text-bad text-sm rounded-lg px-3 py-2 mb-3">{pwError}</div>}

        <form onSubmit={handlePasswordChange} className="space-y-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-muted mb-1">Current password</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-ink focus:border-accent outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-muted mb-1">New password</label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-ink focus:border-accent outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="bg-accent text-oncolor font-semibold rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            {submitting ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>

      <div className="bg-surface border border-border rounded-xl p-5">
        <h2 className="font-display text-lg font-semibold mb-1 flex items-center gap-2">
          <Monitor size={16} /> Your devices
        </h2>
        <p className="text-muted text-sm mb-4">
          Signed-in sessions on this account. Sessions sign out automatically after 1 hour of no activity — revoke
          one here
          to end it immediately instead.
        </p>

        {loadingSessions ? (
          <div className="text-muted text-sm py-4">Loading…</div>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-3 bg-surface2 rounded-lg px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">
                    {describeUserAgent(s.user_agent)}
                    {s.id === currentSessionId && <span className="text-accent text-xs ml-2">this device</span>}
                  </div>
                  <div className="text-muted text-xs mt-0.5">
                    Active {new Date(s.last_active_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {s.ip_address ? ` · ${s.ip_address}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => revoke(s.id)}
                  className="flex items-center gap-1 text-xs text-bad hover:underline shrink-0"
                >
                  <LogOut size={12} /> Sign out
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
