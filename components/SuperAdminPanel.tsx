"use client";

import { useEffect, useState } from "react";
import { Building2, Plus } from "lucide-react";

interface Org {
  id: string;
  name: string;
  created_at: string;
  member_count: number;
}

export default function SuperAdminPanel() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [orgName, setOrgName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function load() {
    setLoading(true);
    fetch("/api/superadmin/organizations")
      .then((r) => r.json())
      .then((d) => setOrgs(d.organizations ?? []))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/superadmin/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgName, fullName, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccess(`${orgName} is set up — send ${email} their password to get them started.`);
      setOrgName("");
      setFullName("");
      setEmail("");
      setPassword("");
      setShowForm(false);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 pt-5 pb-28">
      <h1 className="font-display text-2xl font-semibold tracking-tight mb-1">Platform</h1>
      <p className="text-muted text-sm mb-4">Onboard a new paying company — each one gets fully separate data, teams, and statuses.</p>

      <button
        onClick={() => setShowForm((s) => !s)}
        className="flex items-center gap-1.5 bg-accent text-oncolor font-semibold rounded-lg px-3.5 py-2 text-sm mb-4"
      >
        <Plus size={14} /> {showForm ? "Cancel" : "New customer"}
      </button>

      {success && <div className="bg-good/10 border border-good/40 text-good text-sm rounded-lg px-4 py-3 mb-4">{success}</div>}
      {error && <div className="bg-bad/10 border border-bad/40 text-bad text-sm rounded-lg px-4 py-3 mb-4">{error}</div>}

      {showForm && (
        <form onSubmit={handleCreate} className="bg-surface border border-border rounded-xl p-4 mb-5 space-y-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-muted mb-1">Company name</label>
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} required className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-ink focus:border-accent outline-none" />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-muted mb-1">Their admin's name</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-ink focus:border-accent outline-none" />
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-muted mb-1">Their email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-ink focus:border-accent outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-muted mb-1">Temporary password</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-ink focus:border-accent outline-none" />
          </div>
          <button type="submit" disabled={submitting} className="bg-accent text-oncolor font-semibold rounded-lg px-4 py-2 text-sm disabled:opacity-50">
            {submitting ? "Setting up…" : "Create company"}
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-muted text-center py-12">Loading…</div>
      ) : (
        <div className="space-y-2">
          {orgs.map((o) => (
            <div key={o.id} className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-3">
              <Building2 size={16} className="text-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{o.name}</div>
                <div className="text-muted text-xs mt-0.5">
                  {o.member_count} {o.member_count === 1 ? "member" : "members"} · since{" "}
                  {new Date(o.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
