"use client";

import { useCallback, useEffect, useState } from "react";
import { Play, Square, Coffee } from "lucide-react";
import type { EventType, LiveStatus, ShiftSummary } from "@/lib/attendance";

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
  MISSING_CHECKOUT: "Needs review — missing checkout",
};

function formatMinutes(total: number | null | undefined): string {
  if (total == null) return "0m";
  const abs = Math.abs(Math.round(total));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

export default function AttendanceStrip() {
  const [status, setStatus] = useState<LiveStatus>("NOT_CHECKED_IN");
  const [allowedActions, setAllowedActions] = useState<EventType[]>([]);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      /* non-fatal for this strip */
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
      if (!res.ok) setError(data.error || "Couldn't record that.");
      else await load();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-xl px-4 py-3 mb-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Attendance</div>
          <div className="text-sm text-ink font-medium">
            {STATUS_TEXT[status]}
            {summary?.netMinutes != null && (status === "WORKING" || status === "ON_BREAK") && (
              <span className="text-muted font-normal"> · {formatMinutes(summary.netMinutes)}</span>
            )}
          </div>
          {error && <div className="text-xs text-bad mt-0.5">{error}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {allowedActions.map((action) => {
            const cfg = ACTION_CONFIG[action];
            const Icon = cfg.icon;
            return (
              <button
                key={action}
                onClick={() => doAction(action)}
                disabled={busy}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg transition-colors disabled:opacity-50 ${cfg.className}`}
              >
                <Icon size={13} />
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
