"use client";

import { useCallback, useEffect, useState } from "react";
import { Play, Coffee, Square, AlertCircle, Plus, Check } from "lucide-react";

// ---------- shared helpers ----------

function formatMinutes(total: number | null | undefined): string {
  if (total == null) return "—";
  const abs = Math.abs(Math.round(total));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

function formatClock(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  NOT_CHECKED_IN: { label: "Not checked in", className: "bg-slate/20 text-muted border-slate/40" },
  WORKING: { label: "Working", className: "bg-good/15 text-good border-good/40" },
  ON_BREAK: { label: "On break", className: "bg-accent/15 text-accent border-accent/40" },
  CHECKED_OUT: { label: "Checked out", className: "bg-slate/20 text-muted border-slate/40" },
  MISSING_CHECKOUT: { label: "Needs review", className: "bg-bad/15 text-bad border-bad/40" },
};

// ---------- Live tab ----------

interface LiveRow {
  userId: string;
  name: string;
  status: string;
  shiftDate: string;
  summary: {
    checkIn: string | null;
    checkOut: string | null;
    netMinutes: number | null;
    totalBreakMinutes: number;
    lateMinutes: number;
    overtimeMinutes: number;
    hasIncompleteBreak: boolean;
  };
}

function LiveTab() {
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [correctingFor, setCorrectingFor] = useState<LiveRow | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/attendance/admin/live");
      const data = await res.json();
      if (res.ok) {
        setRows(data.rows ?? []);
        setCounts(data.counts ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);

  const CARDS: { key: string; label: string }[] = [
    { key: "working", label: "Working" },
    { key: "onBreak", label: "On break" },
    { key: "checkedOut", label: "Checked out" },
    { key: "notCheckedIn", label: "Not checked in" },
    { key: "missingCheckout", label: "Missing checkout" },
    { key: "late", label: "Late" },
    { key: "overtime", label: "Overtime" },
  ];

  if (loading) return <div className="text-muted text-center py-12">Loading…</div>;

  return (
    <div>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-5">
        {CARDS.map((c) => (
          <div key={c.key} className="bg-surface border border-border rounded-xl px-3 py-2.5">
            <div className="text-lg font-display font-semibold">{counts?.[c.key] ?? 0}</div>
            <div className="text-[11px] text-muted">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {rows.map((r) => {
          const meta = STATUS_META[r.status] ?? STATUS_META.NOT_CHECKED_IN;
          return (
            <div key={r.userId} className="bg-surface border border-border rounded-xl px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{r.name}</div>
                  <div className="text-xs text-muted mt-0.5 flex items-center gap-2 flex-wrap">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium ${meta.className}`}
                    >
                      {meta.label}
                    </span>
                    {r.summary.checkIn && <span>in {formatClock(r.summary.checkIn)}</span>}
                    {r.summary.netMinutes != null && <span>· {formatMinutes(r.summary.netMinutes)}</span>}
                    {r.summary.lateMinutes > 0 && <span className="text-bad">· {r.summary.lateMinutes}m late</span>}
                    {r.summary.overtimeMinutes > 0 && (
                      <span className="text-accent">· {formatMinutes(r.summary.overtimeMinutes)} OT</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setCorrectingFor(r)}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-border text-muted hover:text-ink hover:border-accent transition-colors shrink-0"
                >
                  Fix
                </button>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <div className="text-center text-muted py-12">No team members found.</div>}
      </div>

      {correctingFor && (
        <CorrectionModal row={correctingFor} onClose={() => setCorrectingFor(null)} onDone={() => { setCorrectingFor(null); load(); }} />
      )}
    </div>
  );
}

const CORRECTION_ACTIONS = [
  { value: "add_missing_checkin", label: "Add missing check-in", needsTime: true },
  { value: "add_missing_checkout", label: "Add missing check-out", needsTime: true },
  { value: "add_break_out", label: "Add break start", needsTime: true },
  { value: "add_break_in", label: "Add break end", needsTime: true },
  { value: "resolve_incomplete_break", label: "Resolve incomplete break", needsTime: true },
  { value: "mark_absent", label: "Mark absent (today)", needsTime: false },
  { value: "mark_leave", label: "Mark on leave (today)", needsTime: false },
  { value: "mark_holiday", label: "Mark holiday (today)", needsTime: false },
];

function CorrectionModal({ row, onClose, onDone }: { row: LiveRow; onClose: () => void; onDone: () => void }) {
  const [actionType, setActionType] = useState(CORRECTION_ACTIONS[0].value);
  const [time, setTime] = useState(() => new Date().toISOString().slice(0, 16));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsTime = CORRECTION_ACTIONS.find((a) => a.value === actionType)?.needsTime;

  async function submit() {
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/attendance/admin/correction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: row.userId,
          actionType,
          reason,
          shiftDate: row.shiftDate,
          timestamp: needsTime ? new Date(time).toISOString() : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "Something went wrong.");
      else onDone();
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-surface elevated border border-border rounded-2xl p-5 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-lg font-semibold mb-1">Fix attendance — {row.name}</h3>
        <p className="text-xs text-muted mb-4">Shift date {row.shiftDate}. Every correction is logged with your name and reason.</p>

        <label className="text-xs text-muted mb-1 block">Action</label>
        <select
          value={actionType}
          onChange={(e) => setActionType(e.target.value)}
          className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm mb-3 outline-none focus:border-accent"
        >
          {CORRECTION_ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>

        {needsTime && (
          <>
            <label className="text-xs text-muted mb-1 block">Time</label>
            <input
              type="datetime-local"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm mb-3 outline-none focus:border-accent"
            />
          </>
        )}

        <label className="text-xs text-muted mb-1 block">Reason (required)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="e.g. Employee forgot to check out."
          className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm mb-3 outline-none focus:border-accent resize-none"
        />

        {error && (
          <div className="flex items-center gap-1.5 text-xs text-bad mb-3">
            <AlertCircle size={13} /> {error}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="text-sm px-3 py-2 rounded-lg text-muted hover:text-ink">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="text-sm px-3.5 py-2 rounded-lg bg-accent text-oncolor font-semibold disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save correction"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Shifts tab ----------

interface ShiftTypeRow {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  grace_minutes: number;
  expected_break_minutes: number;
  overtime_enabled: boolean;
  overtime_threshold_minutes: number;
  is_default: boolean;
  is_active: boolean;
}

function ShiftsTab() {
  const [shiftTypes, setShiftTypes] = useState<ShiftTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/attendance/admin/shift-types");
      const data = await res.json();
      if (res.ok) setShiftTypes(data.shiftTypes ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleActive(s: ShiftTypeRow) {
    await fetch("/api/attendance/admin/shift-types", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, isActive: !s.is_active }),
    });
    load();
  }

  async function makeDefault(s: ShiftTypeRow) {
    await fetch("/api/attendance/admin/shift-types", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, isDefault: true }),
    });
    load();
  }

  if (loading) return <div className="text-muted text-center py-12">Loading…</div>;

  return (
    <div>
      <div className="space-y-2 mb-4">
        {shiftTypes.map((s) => (
          <div key={s.id} className="bg-surface border border-border rounded-xl px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink flex items-center gap-2">
                  {s.name}
                  {s.is_default && (
                    <span className="text-[10px] uppercase tracking-wide bg-accent/15 text-accent border border-accent/30 rounded-full px-1.5 py-0.5">
                      Default
                    </span>
                  )}
                  {!s.is_active && <span className="text-[10px] text-muted">(inactive)</span>}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)} · {s.grace_minutes}m grace ·{" "}
                  {s.expected_break_minutes}m break
                  {s.overtime_enabled && <> · OT after {s.overtime_threshold_minutes}m</>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!s.is_default && (
                  <button onClick={() => makeDefault(s)} className="text-xs px-2 py-1.5 rounded-lg border border-border text-muted hover:text-ink">
                    Make default
                  </button>
                )}
                <button
                  onClick={() => toggleActive(s)}
                  className="text-xs px-2 py-1.5 rounded-lg border border-border text-muted hover:text-ink"
                >
                  {s.is_active ? "Deactivate" : "Activate"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showAdd ? (
        <AddShiftForm onDone={() => { setShowAdd(false); load(); }} onCancel={() => setShowAdd(false)} />
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg border border-dashed border-border text-muted hover:text-ink hover:border-accent w-full justify-center"
        >
          <Plus size={14} /> Add shift
        </button>
      )}
    </div>
  );
}

function AddShiftForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("17:00");
  const [endTime, setEndTime] = useState("03:00");
  const [graceMinutes, setGraceMinutes] = useState(10);
  const [expectedBreakMinutes, setExpectedBreakMinutes] = useState(60);
  const [overtimeThresholdMinutes, setOvertimeThresholdMinutes] = useState(15);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/attendance/admin/shift-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          startTime,
          endTime,
          graceMinutes,
          expectedBreakMinutes,
          overtimeEnabled: true,
          overtimeThresholdMinutes,
          postShiftOvertimeAllowed: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "Something went wrong.");
      else onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="col-span-2">
          <label className="text-xs text-muted mb-1 block">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Night Shift"
            className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="text-xs text-muted mb-1 block">Start</label>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="text-xs text-muted mb-1 block">End</label>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="text-xs text-muted mb-1 block">Grace (min)</label>
          <input
            type="number"
            value={graceMinutes}
            onChange={(e) => setGraceMinutes(Number(e.target.value))}
            className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="text-xs text-muted mb-1 block">Expected break (min)</label>
          <input
            type="number"
            value={expectedBreakMinutes}
            onChange={(e) => setExpectedBreakMinutes(Number(e.target.value))}
            className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-muted mb-1 block">Overtime after (min past scheduled end)</label>
          <input
            type="number"
            value={overtimeThresholdMinutes}
            onChange={(e) => setOvertimeThresholdMinutes(Number(e.target.value))}
            className="w-full bg-surface2 border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
      </div>
      {error && <div className="text-xs text-bad mb-3">{error}</div>}
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="text-sm px-3 py-2 rounded-lg text-muted hover:text-ink">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="flex items-center gap-1.5 text-sm px-3.5 py-2 rounded-lg bg-accent text-oncolor font-semibold disabled:opacity-50"
        >
          <Check size={14} /> {saving ? "Saving…" : "Create shift"}
        </button>
      </div>
    </div>
  );
}

// ---------- History tab ----------

interface CorrectionRow {
  id: string;
  employee_name: string;
  performed_by_name: string;
  action_type: string;
  reason: string;
  shift_date: string;
  created_at: string;
}

function HistoryTab() {
  const [corrections, setCorrections] = useState<CorrectionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/attendance/admin/correction")
      .then((r) => r.json())
      .then((d) => setCorrections(d.corrections ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-muted text-center py-12">Loading…</div>;
  if (corrections.length === 0) return <div className="text-center text-muted py-12">No corrections logged yet.</div>;

  return (
    <div className="space-y-2">
      {corrections.map((c) => (
        <div key={c.id} className="bg-surface border border-border rounded-xl px-4 py-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium text-ink">{c.employee_name}</span>
            <span className="text-xs text-muted">{new Date(c.created_at).toLocaleString()}</span>
          </div>
          <div className="text-xs text-muted mt-1">
            {c.action_type.replace(/_/g, " ")} · shift {c.shift_date} · by {c.performed_by_name}
          </div>
          <div className="text-sm mt-1">{c.reason}</div>
        </div>
      ))}
    </div>
  );
}

// ---------- Main panel ----------

export default function AttendanceAdminPanel() {
  const [tab, setTab] = useState<"live" | "shifts" | "history">("live");

  return (
    <div className="max-w-3xl mx-auto px-4 pt-5 pb-28">
      <h1 className="font-display text-2xl font-semibold tracking-tight mb-4">Attendance — Admin</h1>

      <div className="flex gap-1 mb-5 bg-surface2 rounded-lg p-1 w-fit">
        {[
          { key: "live", label: "Live" },
          { key: "shifts", label: "Shifts" },
          { key: "history", label: "History" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={`text-sm font-medium px-3.5 py-1.5 rounded-md transition-colors ${
              tab === t.key ? "bg-accent text-oncolor" : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "live" && <LiveTab />}
      {tab === "shifts" && <ShiftsTab />}
      {tab === "history" && <HistoryTab />}
    </div>
  );
}
