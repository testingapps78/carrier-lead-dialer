"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, Coffee } from "lucide-react";
import type { EventType, LiveStatus, ShiftSummary } from "@/lib/attendance";
import type { Shift } from "@/lib/types";
import { formatDuration } from "@/lib/types";

const ACTION_CONFIG: Record<EventType, { label: string; icon: any; className: string }> = {
  CHECK_IN: { label: "Check in", icon: Play, className: "bg-good/15 text-good border border-good/30" },
  BREAK_OUT: { label: "Break", icon: Coffee, className: "bg-accent/15 text-accent border border-accent/30" },
  BREAK_IN: { label: "Resume", icon: Play, className: "bg-good/15 text-good border border-good/30" },
  CHECK_OUT: { label: "Check out", icon: Square, className: "bg-bad/15 text-bad border border-bad/30" },
};

const STATUS_TEXT: Record<LiveStatus, string> = {
  NOT_CHECKED_IN: "Not checked in",
  WORKING: "Working",
  ON_BREAK: "On break",
  CHECKED_OUT: "Checked out",
  MISSING_CHECKOUT: "Needs review: missing checkout",
};

const DOT_CLASS: Record<LiveStatus, string> = {
  NOT_CHECKED_IN: "bg-muted",
  WORKING: "bg-good",
  ON_BREAK: "bg-accent",
  CHECKED_OUT: "bg-muted",
  MISSING_CHECKOUT: "bg-bad",
};

function formatMinutes(total: number | null | undefined): string {
  if (total == null) return "0m";
  const abs = Math.abs(Math.round(total));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

/**
 * One check-in for everything: it records attendance (check in, break, resume,
 * check out) AND opens/closes the dial session that tracks the MC range covered,
 * so shift reports keep working without a second button.
 */
export default function SessionBar({
  shift,
  setShift,
  shiftReady,
}: {
  shift: Shift | null;
  setShift: (s: Shift | null) => void;
  shiftReady: boolean;
}) {
  const [status, setStatus] = useState<LiveStatus>("NOT_CHECKED_IN");
  const [allowedActions, setAllowedActions] = useState<EventType[]>([]);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, forceTick] = useState(0);
  const autoStarted = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/attendance");
      const data = await res.json();
      if (res.ok) {
        setStatus(data.status);
        setAllowedActions(data.allowedActions ?? []);
        setSummary(data.summary ?? null);
      }
    } catch {
      /* non-fatal for this bar */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (status !== "WORKING" && status !== "ON_BREAK") return;
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, [status, load]);

  // Keeps the elapsed time on an open dial session ticking.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const startShift = useCallback(async () => {
    try {
      const res = await fetch("/api/shifts", { method: "POST" }); // safe to repeat: returns the open one
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.shift) setShift(data.shift);
    } catch {
      /* attendance is the source of truth; the dial session can retry later */
    }
  }, [setShift]);

  // Checked in elsewhere (e.g. the Attendance page) but no dial session yet: open one,
  // once, so the MC range and matched count still get recorded.
  useEffect(() => {
    if (autoStarted.current || !loaded || !shiftReady || shift) return;
    if (status === "WORKING" || status === "ON_BREAK") {
      autoStarted.current = true;
      startShift();
    }
  }, [loaded, shiftReady, shift, status, startShift]);

  async function endShift() {
    try {
      const res = await fetch("/api/shifts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "checkout" }),
      });
      if (res.ok) setShift(null);
    } catch {
      /* attendance check-out already succeeded */
    }
  }

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
        setError(data.error || "Couldn't record that.");
        return;
      }
      if (action === "CHECK_IN" && !shift) await startShift();
      if (action === "CHECK_OUT" && shift) await endShift();
      await load();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  const covered = shift?.start_number && shift?.end_number ? Math.abs(shift.end_number - shift.start_number) + 1 : null;
  const working = status === "WORKING" || status === "ON_BREAK";

  return (
    <div className="flex items-center justify-between gap-3 bg-surface border border-border rounded-xl px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${DOT_CLASS[status]}`} />
          <span className="truncate">
            {STATUS_TEXT[status]}
            {working && summary?.netMinutes != null && (
              <span className="text-muted font-normal"> · {formatMinutes(summary.netMinutes)}</span>
            )}
          </span>
        </div>
        {shift && (
          <div className="text-xs text-muted truncate mt-0.5">
            {covered !== null && (
              <>
                {shift.mode?.toUpperCase()} {shift.start_number}–{shift.end_number} ({covered} covered) ·{" "}
              </>
            )}
            {shift.carriers_viewed} matched · session {formatDuration(shift.check_in, null)}
          </div>
        )}
        {error && <div className="text-xs text-bad mt-0.5">{error}</div>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {allowedActions.map((action) => {
          const cfg = ACTION_CONFIG[action];
          const Icon = cfg.icon;
          return (
            <button
              key={action}
              onClick={() => doAction(action)}
              disabled={busy}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${cfg.className}`}
            >
              <Icon size={12} />
              {cfg.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
