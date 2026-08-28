"use client";

import { useEffect, useState } from "react";
import { Trash2, Plus, GripVertical } from "lucide-react";
import { statusClass } from "@/lib/types";
import { useCallStatuses } from "@/lib/useCallStatuses";

interface UserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  created_at: string;
}

const COLOR_OPTIONS = ["slate", "blue", "green", "red", "amber", "violet"] as const;

function StatusManager() {
  const { statuses, reload } = useCallStatuses();
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<(typeof COLOR_OPTIONS)[number]>("slate");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function addStatus(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/statuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, color }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLabel("");
      reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  }

  async function recolor(value: string, newColor: string) {
    await fetch("/api/statuses", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value, color: newColor }),
    });
    reload();
  }

  async function removeStatus(value: string, label: string) {
    if (!confirm(`Remove the "${label}" status?`)) return;
    const res = await fetch(`/api/statuses?value=${encodeURIComponent(value)}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    reload();
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-5 mb-6">
      <h2 className="font-display text-lg font-semibold mb-1">Call statuses</h2>
      <p className="text-muted text-sm mb-4">
        These are the tags you can put on a lead after a call. Add, recolor, or remove them here — every screen
        that shows statuses updates automatically.
      </p>

      {error && <div className="bg-bad/10 border border-bad/40 text-bad text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}

      <div className="space-y-2 mb-4">
        {statuses.map((s) => (
          <div key={s.value} className="flex items-center gap-2 bg-surface2 rounded-lg px-3 py-2">
            <GripVertical size={14} className="text-muted shrink-0" />
            <span className={`text-xs px-2.5 py-1 rounded-full border shrink-0 ${statusClass(s.color)}`}>
              {s.label}
            </span>
            <div className="flex gap-1 ml-auto">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  onClick={() => recolor(s.value, c)}
                  aria-label={c}
                  className={`w-5 h-5 rounded-full border-2 ${statusClass(c).split(" ")[0]} ${
                    s.color === c ? "border-ink" : "border-transparent"
                  }`}
                />
              ))}
            </div>
            {!s.is_default && (
              <button
                onClick={() => removeStatus(s.value, s.label)}
                className="text-muted hover:text-bad transition-colors shrink-0"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={addStatus} className="flex flex-wrap gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="New status name — e.g. Left voicemail"
          className="flex-1 min-w-[160px] bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-ink focus:border-accent outline-none"
        />
        <select
          value={color}
          onChange={(e) => setColor(e.target.value as any)}
          className="bg-surface2 border border-border rounded-lg px-2 py-2 text-sm text-ink focus:border-accent outline-none"
        >
          {COLOR_OPTIONS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={adding}
          className="flex items-center gap-1.5 bg-accent text-base font-semibold rounded-lg px-3 py-2 text-sm disabled:opacity-50"
        >
          <Plus size={14} /> Add
        </button>
      </form>
    </div>
  );
}

export default function AdminPanel({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function loadUsers() {
    setLoading(true);
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setUsers(d.users ?? []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(loadUsers, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFullName("");
      setEmail("");
      setPassword("");
      setShowForm(false);
      loadUsers();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(id: string, label: string) {
    if (!confirm(`Remove ${label}'s access? They won't be able to sign in anymore.`)) return;
    const res = await fetch(`/api/admin/users?id=${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    loadUsers();
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pt-5 pb-28">
      <h1 className="font-display text-2xl font-semibold tracking-tight mb-4">Admin</h1>

      <StatusManager />

      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-semibold">Team access</h2>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="bg-accent text-base font-semibold rounded-lg px-3.5 py-2 text-sm hover:bg-accent/90 transition-colors"
        >
          {showForm ? "Cancel" : "+ Add teammate"}
        </button>
      </div>

      {error && (
        <div className="bg-bad/10 border border-bad/40 text-bad text-sm rounded-lg px-4 py-3 mb-4">{error}</div>
      )}

      {showForm && (
        <form onSubmit={handleAdd} className="bg-surface border border-border rounded-xl p-4 mb-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-muted mb-1">Full name</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-ink focus:border-accent outline-none"
              />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-muted mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-ink focus:border-accent outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-muted mb-1">Temporary password</label>
            <input
              type="text"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters — share this with them directly"
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-ink focus:border-accent outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="bg-accent text-base font-semibold rounded-lg px-4 py-2 text-sm hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Adding…" : "Add teammate"}
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-muted text-center py-12">Loading…</div>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{u.full_name || u.email}</div>
                <div className="text-muted text-xs mt-0.5">{u.email}</div>
              </div>
              <span className="text-xs px-2 py-1 rounded-full border border-border text-muted uppercase">
                {u.role}
              </span>
              {u.id !== currentUserId && (
                <button
                  onClick={() => handleRemove(u.id, u.full_name || u.email || "this user")}
                  className="text-xs text-bad hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
