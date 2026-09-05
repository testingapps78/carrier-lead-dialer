"use client";

import { useEffect, useState } from "react";
import { Play, Square, Phone, Tag, Trash2 } from "lucide-react";
import { Shift, formatDuration, formatClock } from "@/lib/types";

export default function ShiftLog() {
  const [open, setOpen] = useState<Shift | null>(null);
  const [history, setHistory] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    fetch("/api/shifts")
      .then((r) => r.json())
      .then((d) => {
        setOpen(d.open ?? null);
        setHistory(d.history ?? []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function toggle() {
    setBusy(true);
    try {
      await fetch("/api/shifts", {
        method: open ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: open ? JSON.stringify({ action: "checkout" }) : undefined,
      });
      load();
    } finally {
      setBusy(false);
    }
  }

  async function deleteShift(id: string) {
    if (!confirm("Delete this shift entry? This can't be undone.")) return;
    await fetch(`/api/shifts?id=${id}`, { method: "DELETE" });
    setHistory((h) => h.filter((s) => s.id !== id));
  }

  const todayTotal = history
    .filter((s) => new Date(s.check_in).toDateString() === new Date().toDateString())
    .reduce((sum, s) => sum + s.carriers_viewed, 0) + (open?.carriers_viewed ?? 0);

  return (
    <div className="max-w-3xl mx-auto px-4 pt-5 pb-28">
      <h1 className="font-display text-2xl font-semibold tracking-tight mb-4">Dialing log</h1>

      <div className="bg-surface elevated border border-border/60 rounded-2xl p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted mb-1">{open ? "Currently checked in" : "Not checked in"}</div>
            <div className="font-display text-2xl font-semibold">
              {open ? formatDuration(open.check_in, null) : "—"}
            </div>
            {open && <div className="text-xs text-muted mt-1">since {formatClock(open.check_in)}</div>}
          </div>
          <button
            onClick={toggle}
            disabled={busy}
            className={`flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50 ${
              open ? "bg-bad/15 text-bad border border-bad/30" : "bg-good text-base"
            }`}
          >
            {open ? <Square size={14} /> : <Play size={14} />}
            {open ? "Check out" : "Check in"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-5 pt-5 border-t border-border">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Viewed today</div>
            <div className="text-xl font-display font-semibold">{todayTotal}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted mb-1">This shift</div>
            <div className="text-xl font-display font-semibold">{open?.carriers_logged ?? 0} logged</div>
          </div>
        </div>
      </div>

      <h2 className="text-sm uppercase tracking-wide text-muted mb-3">Past shifts</h2>

      {loading && <div className="text-muted text-center py-8">Loading…</div>}

      {!loading && history.length === 0 && (
        <div className="text-center text-muted py-12 border border-dashed border-border rounded-xl">
          Your completed shifts will show up here.
        </div>
      )}

      <div className="space-y-2">
        {history.map((s) => (
          <div key={s.id} className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-4">
            <div className="flex-1">
              <div className="text-sm font-medium">
                {new Date(s.check_in).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              </div>
              <div className="text-xs text-muted mt-0.5">
                {formatClock(s.check_in)} – {s.check_out ? formatClock(s.check_out) : "—"} ·{" "}
                {formatDuration(s.check_in, s.check_out)}
                {s.start_number ? ` · ${(s.mode || "").toUpperCase()} ${s.start_number}–${s.end_number}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted">
              <Phone size={12} /> {s.carriers_viewed}
            </div>
            <div className="flex items-center gap-1 text-xs text-muted">
              <Tag size={12} /> {s.carriers_logged}
            </div>
            <button onClick={() => deleteShift(s.id)} className="text-muted hover:text-bad transition-colors">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
