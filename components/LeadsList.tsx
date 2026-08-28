"use client";

import { useEffect, useState } from "react";
import { Star, Trash2, ChevronDown, Search, X } from "lucide-react";
import { formatPhone, statusClass } from "@/lib/types";
import { useCallStatuses } from "@/lib/useCallStatuses";

interface LeadRow {
  dot_number: number;
  status: string;
  priority: boolean;
  notes: string | null;
  last_called_at: string | null;
  updated_at: string;
  carriers: {
    legal_name: string | null;
    dba_name: string | null;
    phone: string | null;
    phy_city: string | null;
    phy_state: string | null;
    power_units: number | null;
    docket_prefix: string | null;
    docket_number: number | null;
  } | null;
}

export default function LeadsList() {
  const { statuses } = useCallStatuses();
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<number, string>>({});

  function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (search) params.set("q", search);
    fetch(`/api/leads?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => setLeads(d.leads ?? []))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, search]);

  async function patchLead(dotNumber: number, patch: Record<string, unknown>) {
    await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dot_number: dotNumber, ...patch }),
    });
    load();
  }

  async function deleteLead(dotNumber: number, name: string) {
    if (!confirm(`Remove ${name} from your leads? This can't be undone.`)) return;
    await fetch(`/api/leads?dot_number=${dotNumber}`, { method: "DELETE" });
    setLeads((prev) => prev.filter((l) => l.dot_number !== dotNumber));
  }

  const statusLabel = (value: string) => statuses.find((s) => s.value === value)?.label ?? value;
  const statusColorClass = (value: string) => statusClass(statuses.find((s) => s.value === value)?.color);

  return (
    <div className="max-w-4xl mx-auto px-4 pt-5 pb-28">
      <h1 className="font-display text-2xl font-semibold tracking-tight mb-4">Worked leads</h1>

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[160px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or MC/DOT"
            className="w-full bg-surface2 border border-border rounded-lg pl-9 pr-8 py-2.5 text-sm text-ink focus:border-accent outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted">
              <X size={14} />
            </button>
          )}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-surface2 border border-border rounded-lg px-3 py-2.5 text-sm text-ink focus:border-accent outline-none"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {loading && <div className="text-muted text-center py-12">Loading…</div>}

      {!loading && leads.length === 0 && (
        <div className="text-center text-muted py-16 border border-dashed border-border rounded-xl">
          No leads yet — start a scan on the Dial tab and any carrier you tag will show up here.
        </div>
      )}

      <div className="space-y-2">
        {leads.map((lead) => {
          const name = lead.carriers?.legal_name || `DOT ${lead.dot_number}`;
          const isOpen = expanded === lead.dot_number;
          return (
            <div key={lead.dot_number} className="bg-surface border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => setExpanded(isOpen ? null : lead.dot_number)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left"
              >
                {lead.priority && <Star size={14} className="text-accent shrink-0" fill="currentColor" />}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{name}</div>
                  <div className="text-muted text-xs mt-0.5 truncate">
                    {lead.carriers?.docket_prefix && lead.carriers?.docket_number
                      ? `${lead.carriers.docket_prefix}-${lead.carriers.docket_number} · `
                      : ""}
                    {[lead.carriers?.phy_city, lead.carriers?.phy_state].filter(Boolean).join(", ")}
                    {lead.carriers?.power_units ? ` · ${lead.carriers.power_units} PU` : ""}
                  </div>
                </div>
                <span className="mile-marker text-xs text-muted hidden sm:block shrink-0">
                  {formatPhone(lead.carriers?.phone ?? null) || "—"}
                </span>
                <span className={`text-[11px] px-2 py-1 rounded-full border shrink-0 ${statusColorClass(lead.status)}`}>
                  {statusLabel(lead.status)}
                </span>
                <ChevronDown
                  size={16}
                  className={`text-muted shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>

              {isOpen && (
                <div className="px-4 pb-4 pt-1 border-t border-border/60 animate-fade-in">
                  <div className="flex flex-wrap gap-1.5 mb-3 mt-3">
                    {statuses.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => patchLead(lead.dot_number, { status: s.value })}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${statusClass(s.color)} ${
                          lead.status === s.value ? "ring-1 ring-accent" : "opacity-60 hover:opacity-100"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    defaultValue={lead.notes ?? ""}
                    onChange={(e) => setNotesDraft((d) => ({ ...d, [lead.dot_number]: e.target.value }))}
                    onBlur={(e) => patchLead(lead.dot_number, { notes: e.target.value })}
                    placeholder="Notes…"
                    rows={2}
                    className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm text-ink focus:border-accent outline-none resize-none mb-3"
                  />
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => patchLead(lead.dot_number, { priority: !lead.priority })}
                      className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                        lead.priority ? "bg-accent/20 text-accent border-accent" : "text-muted border-border"
                      }`}
                    >
                      <Star size={12} fill={lead.priority ? "currentColor" : "none"} />
                      {lead.priority ? "Important" : "Mark important"}
                    </button>
                    <button
                      onClick={() => deleteLead(lead.dot_number, name)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-bad/30 text-bad hover:bg-bad/10 transition-colors"
                    >
                      <Trash2 size={12} />
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
