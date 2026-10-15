"use client";

import { useEffect, useState } from "react";
import { Play, Square, Phone, Tag, Trash2, Download } from "lucide-react";
import Tile from "@/components/Tile";
import { Shift, formatDuration, formatClock } from "@/lib/types";

export default function ShiftLog() {
  const [open, setOpen] = useState<Shift | null>(null);
  const [history, setHistory] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

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

  function exportCsv(kind: "leads" | "shifts") {
    const params = new URLSearchParams({ kind });
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    window.location.href = `/api/export?${params.toString()}`;
  }

  const todayTotal = history
    .filter((s) => new Date(s.check_in).toDateString() === new Date().toDateString())
    .reduce((sum, s) => sum + s.carriers_viewed, 0) + (open?.carriers_viewed ?? 0);

  return (
    <div className="w-full px-6 pt-4 pb-24 md:pb-6">
      <h1 className="font-display text-2xl font-semibold tracking-tight mb-4">Dialing log</h1>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12 mb-4">
        <Tile label="Shift" className="xl:col-span-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-muted mb-1">{open ? "Currently checked in" : "Not checked in"}</div>
              <div className="num font-display text-2xl font-semibold">{open ? formatDuration(open.check_in, null) : "—"}</div>
              {open && <div className="text-xs text-muted mt-1 num">since {formatClock(open.check_in)}</div>}
            </div>
            <button
              onClick={toggle}
              disabled={busy}
              className={`btn disabled:opacity-50 ${open ? "bg-bad/10 text-bad border border-bad/40" : "bg-good text-accent-text"}`}
            >
              {open ? <Square size={14} /> : <Play size={14} />}
              {open ? "Check out" : "Check in"}
            </button>
          </div>
        </Tile>
        <Tile label="Viewed today" className="xl:col-span-3">
          <div className="num font-display text-2xl font-semibold">{todayTotal}</div>
        </Tile>
        <Tile label="This shift" className="xl:col-span-3">
          <div className="num font-display text-2xl font-semibold">{open?.carriers_logged ?? 0} logged</div>
        </Tile>
      </div>

      <div className="grid gap-4 xl:grid-cols-12 items-start">
        <Tile label="Export" className="xl:col-span-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">From</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="bg-inset border border-border rounded-xl px-3 h-10 text-sm text-ink focus:border-accent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">To</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="bg-inset border border-border rounded-xl px-3 h-10 text-sm text-ink focus:border-accent outline-none"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <button onClick={() => exportCsv("leads")} className="btn btn-secondary">
              <Download size={14} /> Export my leads
            </button>
            <button onClick={() => exportCsv("shifts")} className="btn btn-secondary">
              <Download size={14} /> Export my shifts
            </button>
          </div>
        </Tile>

        <Tile label="Past shifts" className="xl:col-span-8 !p-0 overflow-hidden">
          <div className="px-[18px] pt-[18px] pb-2 tile-label">Past shifts</div>

          {loading && <div className="text-muted text-center py-8">Loading…</div>}

          {!loading && history.length === 0 && (
            <div className="text-center text-muted py-12 mx-[18px] mb-[18px] border border-dashed border-border rounded-tile">
              Your completed shifts will show up here.
            </div>
          )}

          {history.length > 0 && (
            <div className="max-h-[60vh] overflow-y-auto">
              <div className="sticky top-0 z-10 grid grid-cols-[1.2fr_2fr_1.4fr_auto_auto_40px] gap-3 px-[18px] py-2 bg-card border-y border-border text-xs font-semibold uppercase tracking-wide text-muted">
                <span>Date</span>
                <span>Time</span>
                <span>Range</span>
                <span>Viewed</span>
                <span>Logged</span>
                <span />
              </div>
              {history.map((s) => (
                <div
                  key={s.id}
                  className="grid grid-cols-[1.2fr_2fr_1.4fr_auto_auto_40px] items-center gap-3 px-[18px] min-h-[44px] py-2 border-b border-border last:border-b-0 hover:bg-inset transition-colors"
                >
                  <div className="text-sm font-medium">
                    {new Date(s.check_in).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                  </div>
                  <div className="text-sm text-muted num">
                    {formatClock(s.check_in)} – {s.check_out ? formatClock(s.check_out) : "—"} · {formatDuration(s.check_in, s.check_out)}
                  </div>
                  <div className="text-sm text-muted num">
                    {s.start_number ? `${(s.mode || "").toUpperCase()} ${s.start_number}–${s.end_number}` : "—"}
                  </div>
                  <div className="flex items-center gap-1 text-sm text-muted num">
                    <Phone size={13} /> {s.carriers_viewed}
                  </div>
                  <div className="flex items-center gap-1 text-sm text-muted num">
                    <Tag size={13} /> {s.carriers_logged}
                  </div>
                  <button
                    onClick={() => deleteShift(s.id)}
                    aria-label="Delete shift"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted hover:text-bad hover:bg-bad/10 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Tile>
      </div>
    </div>
  );
}
