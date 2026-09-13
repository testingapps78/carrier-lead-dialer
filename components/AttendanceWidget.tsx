"use client";

import { useEffect, useState, useCallback } from "react";
import { Play, Square, Coffee } from "lucide-react";
import { formatClock } from "@/lib/types";
import type { EventType, LiveStatus, ShiftSummary, ShiftType } from "@/lib/attendance";

const ACTION_CONFIG: Record<EventType, { label: string; icon: any; className: string }> = {
  CHECK_IN: { label: "Check in", icon: Play, className: "bg-good text-oncolor" },
  BREAK_OUT: { label: "Start break", icon: Coffee, className: "bg-accent/15 text-accent border border-accent/30" },
  BREAK_IN: { label: "End break", icon: Play, className: "bg-good text-oncolor" },
  CHECK_OUT: { label: "Check out", icon: Square, className: "bg-bad/15 text-bad border border-bad/30" },
};

const STATUS_META: Record<LiveStatus, { label: string; className: string }> = {
  NOT_CHECKED_IN: { label: "NOT CHECKED IN", className: "bg-slate/20 text-muted border-slate/40" },
  WORKING: { label: "WORKING", className: "bg-good/15 text-good border-good/40" },
  ON_BREAK: { label: "ON BREAK", className: "bg-accent/15 text-accent border-accent/40" },
  CHECKED_OUT: { label: "CHECKED OUT", className: "bg-slate/20 text-muted border-slate/40" },
  MISSING_CHECKOUT: { label: "NEEDS REVIEW", className: "bg-bad/15 text-bad border-bad/40" },
};

function formatMinutes(total: number | null | undefined): string {
  if (total == null) return "—";
  const sign = total < 0 ? "-" : "";
  const abs = Math.abs(Math.round(total));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}m`;
  return `${sign}${h}h ${m}m`;
}

function formatShiftTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function AttendanceWidget() {
  const [status, setStatus] = useState<LiveStatus>("NOT_CHECKED_IN");
  const [allowedActions, setAllowedActions] = useState<EventType[]>([]);
  const [shiftType, setShiftType] = useState<ShiftType | null>(null);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/attendance");
      const data = await res.json();
      if (res.ok) {
        setStatus(data.status);
        setAllowedActions(data.allowedActions ?? []);
        setShiftType(data.shiftType ?? null);
        setSummary(data.summary ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the running duration reasonably live while an employee is on the
  // clock, mirroring the 45s heartbeat pattern already used in Nav.tsx.
  useEffect(() => {
    if (status !== "WORKING" && status !== "ON_BREAK") return;
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [status, load]);

  async function doAction(action: EventType) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
      } else {
        await load();
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  const meta = STATUS_META[status];

  return (
    <div className="max-w-3xl mx-auto px-4 pt-5 pb-28">
      <h1 className="font-display text-2xl font-semibold tracking-tight mb-4">Attendance</h1>

      <div className="bg-surface elevated border border-border/60 rounded-2xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <span
            className={`text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full border ${meta.className}`}
          >
            {meta.label}
          </span>
          {shiftType && (
            <span className="text-xs text-muted">
              {shiftType.name} · {formatShiftTime(shiftType.start_time)}–{formatShiftTime(shiftType.end_time)}
            </span>
          )}
        </div>

        <div className="flex items-end justify-between">
          <div>
            <div className="text-sm text-muted mb-1">Net working time</div>
            <div className="font-display text-3xl font-semibold">
              {loading ? "—" : formatMinutes(summary?.netMinutes)}
            </div>
            {summary?.checkIn && (
              <div className="text-xs text-muted mt-1">since {formatClock(summary.checkIn)}</div>
            )}
          </div>
          <div className="text-right">
            {!!summary?.lateMinutes && summary.lateMinutes > 0 && (
              <div className="text-xs text-bad font-medium mb-1">{summary.lateMinutes}m late</div>
            )}
            {!!summary?.overtimeMinutes && summary.overtimeMinutes > 0 && (
              <div className="text-xs text-accent font-medium">{formatMinutes(summary.overtimeMinutes)} OT</div>
            )}
          </div>
        </div>

        {!!summary?.totalBreakMinutes && summary.totalBreakMinutes > 0 && (
          <div className="text-xs text-muted mt-2">
            {formatMinutes(summary.totalBreakMinutes)} break so far
            {summary.hasIncompleteBreak ? " · currently on break" : ""}
          </div>
        )}

        {error && <div className="text-xs text-bad mt-3">{error}</div>}

        <div className="grid grid-cols-2 gap-3 mt-5 pt-5 border-t border-border">
          {allowedActions.map((action) => {
            const cfg = ACTION_CONFIG[action];
            const Icon = cfg.icon;
            return (
              <button
                key={action}
                onClick={() => doAction(action)}
                disabled={busy}
                className={`flex items-center justify-center gap-2 text-sm font-semibold px-4 py-3 rounded-xl transition-colors disabled:opacity-50 ${cfg.className}`}
              >
                <Icon size={16} /> {cfg.label}
              </button>
            );
          })}
          {allowedActions.length === 0 && !loading && (
            <div className="col-span-2 text-center text-muted text-sm py-2">
              {summary?.checkOut ? `Checked out at ${formatClock(summary.checkOut)}` : "No actions available."}
            </div>
          )}
        </div>
      </div>

      {!!summary?.breakSessions?.length && (
        <>
          <h2 className="text-sm uppercase tracking-wide text-muted mb-3">Break sessions</h2>
          <div className="space-y-2 mb-6">
            {summary.breakSessions.map((b, i) => (
              <div
                key={i}
                className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center justify-between text-sm"
              >
                <span>
                  {formatClock(b.start)} – {b.end ? formatClock(b.end) : "in progress"}
                </span>
                <span className="text-muted text-xs">
                  {b.minutes != null ? formatMinutes(b.minutes) : "incomplete"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
