"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Bell, Bookmark, ChevronDown, Download, History as HistoryIcon, Search, Star, Trash2, X } from "lucide-react";
import { formatPhone, statusClass } from "@/lib/types";
import { useCallStatuses } from "@/lib/useCallStatuses";
import { useLeadSaver } from "@/lib/useLeadSaver";
import { api, friendlyError, newKey, post } from "@/lib/leadClient";
import { BUCKET_LABEL, callbackBucket } from "@/lib/callbacks";
import { browserTimeZone } from "@/lib/callbackTime";
import CopyButton from "@/components/CopyButton";
import { CallbackSection, ConfirmedContact, HistoryPanel, NotesEditor, PendingNotes } from "@/components/LeadTools";

interface LeadRow {
  dot_number: number;
  status: string;
  priority: boolean;
  saved?: boolean;
  notes: string | null;
  last_called_at: string | null;
  updated_at: string;
  reminder_date: string | null;
  reminder_note: string | null;
  reminder_done: boolean;
  callback_at?: string | null;
  callback_timezone?: string | null;
  contact_override_name?: string | null;
  contact_override_role?: string | null;
  contact_confirmed_at?: string | null;
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

type SortKey = "recent" | "oldest" | "priority" | "name" | "callback";
type View = "" | "overdue" | "today" | "upcoming" | "completed";
interface Counts { overdue: number; today: number; upcoming: number; completed: number; dnc: number }

const PAGE = 25;
const selectCls = "bg-surface2 border border-border rounded-lg px-3 py-2.5 text-sm text-ink focus:border-accent outline-none";

export default function LeadsList({ userId }: { userId: string }) {
  const { statuses } = useCallStatuses();
  const [tz] = useState(() => browserTimeZone());

  const [rows, setRows] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [importantOnly, setImportantOnly] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [dncOnly, setDncOnly] = useState(false);
  const [view, setView] = useState<View>("");
  const [sort, setSort] = useState<SortKey>("recent");

  const [counts, setCounts] = useState<Counts | null>(null);
  const [countsUnavailable, setCountsUnavailable] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [panel, setPanel] = useState<"none" | "callback" | "history">("none");
  const [rowError, setRowError] = useState<{ dot: number; message: string; retry?: () => void } | null>(null);

  const seq = useRef(0);
  const ctrl = useRef<AbortController | null>(null);

  const patchRow = useCallback((dot: number, lead: any) => {
    setRows((prev) => prev.map((r) => (r.dot_number === dot ? { ...r, ...lead, carriers: r.carriers } : r)));
  }, []);
  const saver = useLeadSaver(userId, patchRow);

  // Debounce typing; the request itself is cancelled/ignored if a newer one starts.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const buildQuery = useCallback(
    (offset: number) => {
      const p = new URLSearchParams({ limit: String(PAGE), offset: String(offset), sort, tz });
      if (debouncedSearch) p.set("q", debouncedSearch);
      if (statusFilter) p.set("status", statusFilter);
      if (importantOnly) p.set("important", "1");
      if (savedOnly) p.set("saved", "1");
      if (dncOnly) p.set("dnc", "1");
      if (view) p.set("callback", view);
      return p;
    },
    [debouncedSearch, statusFilter, importantOnly, savedOnly, dncOnly, view, sort, tz]
  );

  const loadFirstPage = useCallback(async () => {
    const mine = ++seq.current;
    ctrl.current?.abort();
    ctrl.current = new AbortController();
    setLoading(true);
    setError(null);
    const r = await api(`/api/leads?${buildQuery(0)}`, undefined, ctrl.current.signal);
    if (mine !== seq.current) return; // a newer search started: ignore this answer
    setLoading(false);
    if (!r.ok) {
      if (r.code !== "aborted") setError(friendlyError(r));
      return;
    }
    setRows(r.data.leads ?? []);
    setTotal(r.data.total ?? 0);
    setDegraded(!!r.data.degraded);
  }, [buildQuery]);

  async function loadMore() {
    const mine = seq.current;
    setLoadingMore(true);
    const r = await api(`/api/leads?${buildQuery(rows.length)}`);
    setLoadingMore(false);
    if (mine !== seq.current) return; // filters changed while loading
    if (!r.ok) return setError(friendlyError(r));
    setRows((prev) => {
      const seen = new Set(prev.map((x) => x.dot_number));
      return [...prev, ...(r.data.leads ?? []).filter((x: LeadRow) => !seen.has(x.dot_number))];
    });
    setTotal(r.data.total ?? total);
  }

  const refreshCounts = useCallback(async () => {
    const r = await api(`/api/leads/counts?tz=${encodeURIComponent(tz)}`);
    if (r.ok) {
      setCounts(r.data.counts);
      setCountsUnavailable(false);
    } else if (r.code === "migration_pending") {
      setCountsUnavailable(true);
    }
  }, [tz]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);
  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts]);

  // Edits update only the affected row once the server confirms them.
  async function rowEdit(dot: number, patch: Record<string, unknown>, key: string = newKey()) {
    setRowError(null);
    const r = await post("/api/leads", { dot_number: dot, ...patch, idempotency_key: key, expected_user_id: userId });
    if (!r.ok) return setRowError({ dot, message: friendlyError(r), retry: () => void rowEdit(dot, patch, key) });
    patchRow(dot, r.data.lead);
    void refreshCounts();
  }

  async function deleteLead(dot: number, name: string) {
    if (!confirm(`Remove ${name} from your leads? This can't be undone.`)) return;
    setRowError(null);
    const r = await api(`/api/leads?dot_number=${dot}`, { method: "DELETE" });
    if (!r.ok) return setRowError({ dot, message: friendlyError(r) });
    setRows((prev) => prev.filter((l) => l.dot_number !== dot));
    setTotal((t) => Math.max(t - 1, 0));
    void refreshCounts();
  }

  const statusLabel = (value: string) => statuses.find((s) => s.value === value)?.label ?? value;
  const statusColorClass = (value: string) => statusClass(statuses.find((s) => s.value === value)?.color);
  const nameOf = (l: LeadRow) => l.carriers?.legal_name || `DOT ${l.dot_number}`;
  const filtersActive = !!(debouncedSearch || statusFilter || importantOnly || savedOnly || dncOnly || view);

  const exportParams = new URLSearchParams({ kind: "leads" });
  if (statusFilter) exportParams.set("status", statusFilter);
  if (importantOnly) exportParams.set("important", "1");
  if (savedOnly) exportParams.set("saved", "1");
  if (dncOnly) exportParams.set("dnc", "1");

  const chip = (active: boolean) =>
    `flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border transition-colors ${active ? "bg-accent/20 text-accent border-accent" : "text-muted border-border"}`;

  return (
    <div className="max-w-4xl mx-auto px-4 pt-5 pb-28">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Worked leads</h1>
        <div className="flex gap-2">
          <a
            href={`/api/export?${exportParams.toString()}`}
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-border text-muted hover:text-ink hover:border-accent transition-colors"
            title="Download your leads (with the status, important, saved and Do Not Call filters below) as a spreadsheet"
          >
            <Download size={14} /> Export leads
          </a>
          <a
            href="/api/export?kind=saved"
            className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-accent/50 text-accent hover:bg-accent/10 transition-colors"
            title="Download all saved MCs as a spreadsheet (CSV)"
          >
            <Download size={14} /> Export saved
          </a>
        </div>
      </div>

      <PendingNotes saver={saver} labelFor={(d) => { const l = rows.find((r) => r.dot_number === d); return l ? nameOf(l) : `DOT ${d}`; }} />

      {degraded && (
        <div className="bg-accent/10 border border-accent/40 text-accent text-sm rounded-xl px-4 py-2 mb-4">
          Showing your 500 most recent leads with basic search. Full search, callback views and Do Not Call filtering turn on after a database update is applied.
        </div>
      )}

      {/* Callback views: counts come from the database, over every lead you have */}
      {!countsUnavailable && (
        <div className="flex flex-wrap gap-2 mb-3">
          {(["overdue", "today", "upcoming", "completed"] as const).map((v) => (
            <button key={v} onClick={() => setView((cur) => (cur === v ? "" : v))} className={chip(view === v)}>
              <Bell size={13} /> {BUCKET_LABEL[v]}
              {counts && <span className={`text-xs ${v === "overdue" && counts.overdue > 0 ? "text-bad font-semibold" : "text-muted"}`}>{counts[v]}</span>}
            </button>
          ))}
          <button onClick={() => setDncOnly((p) => !p)} className={chip(dncOnly)}>
            <AlertTriangle size={13} /> Do Not Call
            {counts && <span className="text-xs text-muted">{counts.dnc}</span>}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[160px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, DBA, MC, DOT or phone"
            maxLength={100}
            className="w-full bg-surface2 border border-border rounded-lg pl-9 pr-8 py-2.5 text-sm text-ink focus:border-accent outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={selectCls}>
          <option value="recent">Recently updated</option>
          <option value="oldest">Oldest first</option>
          <option value="priority">Important first</option>
          <option value="name">Company name A–Z</option>
          <option value="callback">Callback time</option>
        </select>
        <button onClick={() => setImportantOnly((p) => !p)} className={chip(importantOnly)}>
          <Star size={13} fill={importantOnly ? "currentColor" : "none"} /> Important
        </button>
        <button onClick={() => setSavedOnly((p) => !p)} className={chip(savedOnly)}>
          <Bookmark size={13} fill={savedOnly ? "currentColor" : "none"} /> Saved
        </button>
      </div>

      {loading && rows.length === 0 && <div className="text-muted text-center py-12">Loading…</div>}

      {error && (
        <div className="flex items-center gap-3 flex-wrap bg-bad/10 border border-bad/40 text-bad text-sm rounded-xl px-4 py-3 mb-4">
          <span>Couldn&apos;t load your leads: {error}</span>
          <button onClick={() => void loadFirstPage()} className="underline font-medium">Try again</button>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="text-center text-muted py-16 border border-dashed border-border rounded-xl">
          {filtersActive ? "No leads match these filters." : "No leads yet. Work some carriers on the Dial screen and they will show up here."}
        </div>
      )}

      {rows.length > 0 && (
        <div className="text-xs text-muted mb-2">
          Showing {rows.length} of {total}
        </div>
      )}

      <div className="space-y-2">
        {rows.map((lead) => {
          const name = nameOf(lead);
          const isOpen = expanded === lead.dot_number;
          const dnc = lead.status === "do_not_call";
          const bucket = callbackBucket(lead, tz);
          return (
            <div key={lead.dot_number} className="bg-surface border border-border rounded-xl overflow-hidden">
              <button
                onClick={() => {
                  setExpanded(isOpen ? null : lead.dot_number);
                  setPanel("none");
                  setRowError(null);
                }}
                className="w-full px-4 py-3 flex items-center gap-3 text-left"
              >
                {lead.priority && <Star size={14} className="text-accent shrink-0" fill="currentColor" />}
                {lead.saved && <Bookmark size={14} className="text-accent shrink-0" fill="currentColor" />}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{name}</div>
                  <div className="text-muted text-xs mt-0.5 truncate">
                    {lead.carriers?.docket_prefix && lead.carriers?.docket_number ? `${lead.carriers.docket_prefix}-${lead.carriers.docket_number} · ` : ""}
                    {[lead.carriers?.phy_city, lead.carriers?.phy_state].filter(Boolean).join(", ")}
                    {lead.carriers?.power_units ? ` · ${lead.carriers.power_units} PU` : ""}
                    {lead.contact_override_name ? ` · ${lead.contact_override_name}` : ""}
                  </div>
                </div>
                {bucket && bucket !== "completed" && (
                  <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0 ${bucket === "overdue" ? "text-bad border-bad/40" : "text-accent border-accent/40"}`}>
                    {BUCKET_LABEL[bucket]}
                  </span>
                )}
                <span className="mile-marker text-xs text-muted hidden sm:block shrink-0">{formatPhone(lead.carriers?.phone ?? null) || "—"}</span>
                <span className={`text-[11px] px-2 py-1 rounded-full border shrink-0 ${statusColorClass(lead.status)}`}>{statusLabel(lead.status)}</span>
                <ChevronDown size={16} className={`text-muted shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>

              {isOpen && (
                <div className="px-4 pb-4 pt-1 border-t border-border/60 animate-fade-in">
                  <div className="flex items-center gap-2 mb-1 mt-3 text-xs text-muted">
                    {lead.carriers?.docket_number && (
                      <span className="flex items-center gap-1 mile-marker">
                        MC {lead.carriers.docket_number}
                        <CopyButton value={String(lead.carriers.docket_number)} label="" />
                      </span>
                    )}
                    <span className="flex items-center gap-1 mile-marker">
                      DOT {lead.dot_number}
                      <CopyButton value={String(lead.dot_number)} label="" />
                    </span>
                  </div>

                  <div className="mb-3">
                    <ConfirmedContact dot={lead.dot_number} lead={lead} userId={userId} onLead={patchRow} />
                  </div>

                  {dnc && (
                    <div className="flex items-center gap-2 bg-bad/10 border border-bad/40 text-bad text-xs rounded-lg px-3 py-2 mb-3">
                      <AlertTriangle size={13} /> Do Not Call. Dialing and callbacks are off for this lead.
                    </div>
                  )}

                  {rowError?.dot === lead.dot_number && (
                    <div className="flex items-center gap-2 flex-wrap text-bad text-xs mb-3">
                      <span>Couldn&apos;t save: {rowError.message}</span>
                      {rowError.retry && (
                        <button onClick={rowError.retry} className="underline font-medium">Retry</button>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {statuses.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => void rowEdit(lead.dot_number, { status: s.value })}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${statusClass(s.color)} ${lead.status === s.value ? "ring-1 ring-accent" : "opacity-60 hover:opacity-100"}`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>

                  <div className="mb-3">
                    <NotesEditor dot={lead.dot_number} serverNotes={lead.notes} saver={saver} rows={2} placeholder="Notes…" />
                  </div>

                  <div className="mb-3">
                    <CallbackSection
                      dot={lead.dot_number}
                      lead={lead}
                      userId={userId}
                      onLead={(d, l) => {
                        patchRow(d, l);
                        void refreshCounts();
                      }}
                      open={panel === "callback"}
                      onOpenChange={(v) => setPanel(v ? "callback" : "none")}
                    />
                    {!dnc && panel !== "callback" && !(lead.callback_at || lead.reminder_date) && (
                      <button onClick={() => setPanel("callback")} className="flex items-center gap-1 text-xs text-muted hover:text-accent underline decoration-dotted">
                        <Bell size={12} /> Add a callback
                      </button>
                    )}
                  </div>

                  <div className="mb-3">
                    <button
                      onClick={() => setPanel((p) => (p === "history" ? "none" : "history"))}
                      className="flex items-center gap-1 text-xs text-muted hover:text-accent underline decoration-dotted"
                    >
                      <HistoryIcon size={12} /> {panel === "history" ? "Hide history" : "History"}
                    </button>
                    {panel === "history" && (
                      <div className="mt-2">
                        <HistoryPanel dot={lead.dot_number} statusLabel={statusLabel} />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => void rowEdit(lead.dot_number, { priority: !lead.priority })}
                      className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${lead.priority ? "bg-accent/20 text-accent border-accent" : "text-muted border-border"}`}
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

      {rows.length < total && !degraded && (
        <div className="text-center mt-4">
          <button onClick={loadMore} disabled={loadingMore} className="text-sm px-4 py-2 rounded-lg border border-border text-muted hover:text-ink hover:border-accent disabled:opacity-60">
            {loadingMore ? "Loading…" : `Show more (${total - rows.length} left)`}
          </button>
        </div>
      )}
    </div>
  );
}
