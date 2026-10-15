"use client";

import { useEffect, useState, useCallback } from "react";
import Tile from "@/components/Tile";
import { Play, Square, Coffee } from "lucide-react";
import { formatClock } from "@/lib/types";
import type { EventType, LiveStatus, ShiftSummary, ShiftType } from "@/lib/attendance";

const ACTION_CONFIG: Record<EventType, { label: string; icon: any; className: string }> = {
  CHECK_IN: { label: "Check in", icon: Play, className: "bg-good text-accent-text" },
  BREAK_OUT: { label: "Start break", icon: Coffee, className: "bg-accent/10 text-accent-ink border border-accent/40" },
  BREAK_IN: { label: "End break", icon: Play, className: "bg-good text-accent-text" },
  CHECK_OUT: { label: "Check out", icon: Square, className: "bg-bad/10 text-bad border border-bad/40" },
};

const STATUS_META: Record<LiveStatus, { label: string; className: string }> = {
  NOT_CHECKED_IN: { label: "NOT CHECKED IN", className: "bg-slate/10 text-muted border-slate/40" },
  WORKING: { label: "WORKING", className: "bg-good/10 text-good border-good/40" },
  ON_BREAK: { label: "ON BREAK", className: "bg-accent/10 text-accent-ink border-accent/40" },
  CHECKED_OUT: { label: "CHECKED OUT", className: "bg-slate/10 text-muted border-slate/40" },
  MISSING_CHECKOUT: { label: "NEEDS REVIEW", className: "bg-bad/10 text-bad border-bad/40" },
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
    <div className="w-full px-6 pt-4 pb-24 md:pb-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight mb-4">Attendance</h1>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12 mb-4">
        <Tile label="Status" className="xl:col-span-4">
          <span className={`inline-block text-xs font-semibold uppercase tracking-wide px-3 py-1 rounded-full border ${meta.className}`}>
            {meta.label}
          </span>
          {shiftType && (
            <div className="text-sm text-muted mt-3 num">
              {shiftType.name} · {formatShiftTime(shiftType.start_time)}–{formatShiftTime(shiftType.end_time)}
            </div>
          )}
          {summary?.checkIn && <div className="text-sm text-muted mt-1 num">since {formatClock(summary.checkIn)}</div>}
        </Tile>

        <Tile label="Net working time" className="xl:col-span-4">
          <div className="num font-display text-2xl font-semibold">{loading ? "—" : formatMinutes(summary?.netMinutes)}</div>
          <div className="mt-2 space-y-0.5">
            {!!summary?.lateMinutes && summary.lateMinutes > 0 && <div className="text-sm text-bad font-medium num">{summary.lateMinutes}m late</div>}
            {!!summary?.overtimeMinutes && summary.overtimeMinutes > 0 && (
              <div className="text-sm text-accent-ink font-medium num">{formatMinutes(summary.overtimeMinutes)} OT</div>
            )}
            {!!summary?.totalBreakMinutes && summary.totalBreakMinutes > 0 && (
              <div className="text-sm text-muted num">
                {formatMinutes(summary.totalBreakMinutes)} break so far
                {summary.hasIncompleteBreak ? " · currently on break" : ""}
              </div>
            )}
          </div>
        </Tile>

        <Tile label="Actions" className="xl:col-span-4">
          {error && <div className="text-sm text-bad mb-3">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            {allowedActions.map((action) => {
              const cfg = ACTION_CONFIG[action];
              const Icon = cfg.icon;
              return (
                <button
                  key={action}
                  onClick={() => doAction(action)}
                  disabled={busy}
                  className={`btn min-h-[48px] disabled:opacity-50 ${cfg.className}`}
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
        </Tile>
      </div>

      {!!summary?.breakSessions?.length && (
        <Tile label="Break sessions" className="!p-0 overflow-hidden">
          <div className="px-[18px] pt-[18px] pb-2 tile-label">Break sessions</div>
          {summary.breakSessions.map((b, i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-[18px] min-h-[44px] py-2 border-t border-border text-sm hover:bg-inset transition-colors">
              <span className="num">
                {formatClock(b.start)} – {b.end ? formatClock(b.end) : "in progress"}
              </span>
              <span className="text-muted text-sm num">{b.minutes != null ? formatMinutes(b.minutes) : "incomplete"}</span>
            </div>
          ))}
        </Tile>
      )}
    </div>
  );
}
