"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, MapPin, Truck, Star, Play, Square, Loader2 } from "lucide-react";
import { Carrier, Shift, formatPhone, getLead, statusClass, formatDuration } from "@/lib/types";
import { useCallStatuses } from "@/lib/useCallStatuses";
import CopyButton from "@/components/CopyButton";

type Mode = "dot" | "mc";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA",
  "ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK",
  "OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

function ShiftStrip() {
  const [shift, setShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [, forceTick] = useState(0);

  useEffect(() => {
    fetch("/api/shifts")
      .then((r) => r.json())
      .then((d) => setShift(d.open ?? null))
      .finally(() => setLoading(false));
  }, []);

  // Re-render every 30s so the running duration stays live.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  async function toggle() {
    setBusy(true);
    try {
      if (shift) {
        const res = await fetch("/api/shifts", { method: "PATCH" });
        const data = await res.json();
        if (res.ok) setShift(null);
      } else {
        const res = await fetch("/api/shifts", { method: "POST" });
        const data = await res.json();
        if (res.ok) setShift(data.shift);
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  return (
    <div className="flex items-center justify-between bg-surface border border-border rounded-xl px-4 py-3 mb-4">
      <div className="min-w-0">
        {shift ? (
          <>
            <div className="text-sm text-ink font-medium">
              Checked in · {formatDuration(shift.check_in, null)}
            </div>
            <div className="text-xs text-muted mt-0.5">{shift.carriers_viewed} carriers viewed this shift</div>
          </>
        ) : (
          <div className="text-sm text-muted">Not checked in</div>
        )}
      </div>
      <button
        onClick={toggle}
        disabled={busy}
        className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg shrink-0 transition-colors disabled:opacity-50 ${
          shift ? "bg-bad/15 text-bad border border-bad/30" : "bg-good/15 text-good border border-good/30"
        }`}
      >
        {shift ? <Square size={13} /> : <Play size={13} />}
        {shift ? "Check out" : "Check in"}
      </button>
    </div>
  );
}

export default function DialTool() {
  const { statuses } = useCallStatuses();
  const [mode, setMode] = useState<Mode>("mc");
  const [startInput, setStartInput] = useState("");
  const [state, setState] = useState("");
  const [minPU, setMinPU] = useState("1");
  const [maxPU, setMaxPU] = useState("8");
  const [docketOnly, setDocketOnly] = useState(true);

  const [cursor, setCursor] = useState<number | null>(null);
  const [current, setCurrent] = useState<Carrier | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [started, setStarted] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingLead, setSavingLead] = useState(false);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildParams = useCallback(
    (after: number) => {
      const params = new URLSearchParams({ after: String(after), mode });
      if (state) params.set("state", state);
      if (minPU) params.set("minPowerUnits", minPU);
      if (maxPU) params.set("maxPowerUnits", maxPU);
      if (docketOnly) params.set("docketOnly", "true");
      return params;
    },
    [mode, state, minPU, maxPU, docketOnly]
  );

  const fetchNext = useCallback(
    async (after: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/next-carrier?${buildParams(after).toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Lookup failed.");
        if (!data.carrier) {
          setExhausted(true);
          setCurrent(null);
        } else {
          setExhausted(false);
          setCurrent(data.carrier);
          setNotesDraft(getLead(data.carrier)?.notes ?? "");
          const nextCursor = mode === "dot" ? data.carrier.dot_number : data.carrier.docket_number;
          setCursor(nextCursor);
        }
      } catch (e: any) {
        setError(e?.message || "Something went wrong.");
      } finally {
        setLoading(false);
      }
    },
    [buildParams, mode]
  );

  function handleStart(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseInt(startInput.replace(/\D/g, ""), 10);
    const after = Number.isFinite(parsed) ? parsed - 1 : 0;
    setStarted(true);
    fetchNext(after);
  }

  function handleNext() {
    if (cursor === null) return;
    fetchNext(cursor);
  }

  async function updateLead(patch: { status?: string; priority?: boolean; notes?: string }) {
    if (!current) return;
    setSavingLead(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dot_number: current.dot_number, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCurrent((prev) => (prev ? { ...prev, leads: data.lead } : prev));
    } catch (e) {
      console.error(e);
    } finally {
      setSavingLead(false);
    }
  }

  function handleNotesChange(value: string) {
    setNotesDraft(value);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => updateLead({ notes: value }), 700);
  }

  const lead = getLead(current);
  const phone = formatPhone(current?.phone ?? null);
  const cell = formatPhone(current?.cell_phone ?? null);

  return (
    <div className="max-w-3xl mx-auto px-4 pt-5 pb-28">
      <ShiftStrip />

      {/* Filters */}
      <form
        onSubmit={handleStart}
        className="bg-surface border border-border rounded-xl p-4 mb-5 flex flex-wrap items-end gap-3"
      >
        <div className="flex rounded-lg border border-border overflow-hidden text-sm">
          <button
            type="button"
            onClick={() => setMode("mc")}
            className={`px-3 py-2.5 font-medium ${mode === "mc" ? "bg-accent text-base" : "text-muted"}`}
          >
            Scan by MC
          </button>
          <button
            type="button"
            onClick={() => setMode("dot")}
            className={`px-3 py-2.5 font-medium ${mode === "dot" ? "bg-accent text-base" : "text-muted"}`}
          >
            Scan by DOT
          </button>
        </div>

        <div>
          <label className="block text-[11px] uppercase tracking-wide text-muted mb-1">
            Starting {mode === "mc" ? "MC" : "DOT"} #
          </label>
          <input
            value={startInput}
            onChange={(e) => setStartInput(e.target.value)}
            placeholder={mode === "mc" ? "e.g. 900000" : "e.g. 2500000"}
            className="w-36 bg-surface2 border border-border rounded-lg px-3 py-2.5 mile-marker text-ink focus:border-accent outline-none"
            inputMode="numeric"
          />
        </div>

        <div>
          <label className="block text-[11px] uppercase tracking-wide text-muted mb-1">State</label>
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="bg-surface2 border border-border rounded-lg px-3 py-2.5 text-ink focus:border-accent outline-none"
          >
            <option value="">Any</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] uppercase tracking-wide text-muted mb-1">Power units</label>
          <div className="flex items-center gap-1.5">
            <input
              value={minPU}
              onChange={(e) => setMinPU(e.target.value)}
              className="w-14 bg-surface2 border border-border rounded-lg px-2 py-2.5 text-ink focus:border-accent outline-none"
              inputMode="numeric"
            />
            <span className="text-muted">–</span>
            <input
              value={maxPU}
              onChange={(e) => setMaxPU(e.target.value)}
              className="w-14 bg-surface2 border border-border rounded-lg px-2 py-2.5 text-ink focus:border-accent outline-none"
              inputMode="numeric"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-muted pb-2.5">
          <input type="checkbox" checked={docketOnly} onChange={(e) => setDocketOnly(e.target.checked)} />
          Has MC authority
        </label>

        <button
          type="submit"
          className="ml-auto bg-accent text-base font-semibold rounded-lg px-4 py-2.5 hover:bg-accent/90 active:scale-[0.98] transition-all"
        >
          {started ? "Restart scan" : "Start scan"}
        </button>
      </form>

      {error && (
        <div className="bg-bad/10 border border-bad/40 text-bad text-sm rounded-xl px-4 py-3 mb-5">
          {error}
        </div>
      )}

      {!started && !error && (
        <div className="text-center text-muted py-16 border border-dashed border-border rounded-xl">
          Set a starting {mode === "mc" ? "MC" : "DOT"} number above and hit{" "}
          <span className="text-ink">Start scan</span>.
        </div>
      )}

      {started && exhausted && (
        <div className="text-center text-muted py-16 border border-dashed border-border rounded-xl">
          No more active carriers match these filters from here on. Try raising the range or loosening a filter.
        </div>
      )}

      {loading && !current && (
        <div className="flex items-center justify-center gap-2 text-muted py-16">
          <Loader2 size={16} className="animate-spin" />
          Looking up the next active carrier…
        </div>
      )}

      {current && !exhausted && (
        <div key={current.dot_number} className="bg-surface elevated border border-border/60 rounded-2xl p-6 animate-fade-in">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {current.docket_prefix && current.docket_number && (
              <span className="mile-marker text-sm border border-accent text-accent px-2.5 py-1 rounded-lg">
                {current.docket_prefix}-{current.docket_number}
              </span>
            )}
            <span className="mile-marker text-sm border border-border text-muted px-2.5 py-1 rounded-lg">
              DOT {current.dot_number}
            </span>
            {current.hm_ind === "Y" && (
              <span className="text-xs border border-bad/50 text-bad px-2.5 py-1 rounded-lg uppercase">Hazmat</span>
            )}
            {savingLead && <span className="text-xs text-muted ml-auto">Saving…</span>}
          </div>

          <h2 className="font-display text-2xl font-semibold tracking-tight">
            {current.legal_name || "Unnamed carrier"}
          </h2>
          {current.dba_name && <p className="text-muted text-sm mt-0.5">dba {current.dba_name}</p>}

          <div className="grid sm:grid-cols-2 gap-5 mt-6">
            <div className="flex gap-3">
              <Phone size={16} className="text-muted mt-0.5 shrink-0" />
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Phone</div>
                {phone ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="mile-marker text-lg">{phone}</span>
                    <CopyButton value={current.phone ?? ""} />
                  </div>
                ) : (
                  <span className="text-muted text-sm">Not on file</span>
                )}
                {cell && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="mile-marker text-sm text-muted">{cell} (cell)</span>
                    <CopyButton value={current.cell_phone ?? ""} />
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <MapPin size={16} className="text-muted mt-0.5 shrink-0" />
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Location</div>
                <div className="text-sm">
                  {[current.phy_city, current.phy_state, current.phy_zip].filter(Boolean).join(", ") || "—"}
                </div>
                <div className="text-muted text-xs mt-0.5">{current.phy_street}</div>
              </div>
            </div>

            <div className="flex gap-3">
              <Truck size={16} className="text-muted mt-0.5 shrink-0" />
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Fleet</div>
                <div className="text-sm">
                  {current.power_units ?? "?"} power units · {current.total_drivers ?? "?"} drivers
                </div>
                <div className="text-muted text-xs mt-0.5">{current.classdef || "—"}</div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-5 border-t border-border">
            <div className="text-[11px] uppercase tracking-wide text-muted mb-2">Call status</div>
            <div className="flex flex-wrap gap-2">
              {statuses.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => updateLead({ status: opt.value })}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${statusClass(opt.color)} ${
                    lead?.status === opt.value ? "ring-1 ring-accent" : "opacity-70 hover:opacity-100"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              <button
                onClick={() => updateLead({ priority: !lead?.priority })}
                className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  lead?.priority
                    ? "bg-accent/20 text-accent border-accent"
                    : "text-muted border-border hover:text-ink"
                }`}
              >
                <Star size={12} fill={lead?.priority ? "currentColor" : "none"} />
                Important
              </button>
            </div>

            <textarea
              value={notesDraft}
              onChange={(e) => handleNotesChange(e.target.value)}
              placeholder="Notes — call back after 3pm, spoke with dispatcher, etc."
              rows={2}
              className="w-full mt-3 bg-surface2 border border-border rounded-xl px-3 py-2.5 text-sm text-ink focus:border-accent outline-none resize-none"
            />
          </div>

          <button
            onClick={handleNext}
            disabled={loading}
            className="w-full mt-6 bg-accent glow-accent text-base font-semibold rounded-xl py-3.5 hover:bg-accent/90 disabled:opacity-50 transition-all"
          >
            {loading ? "Loading…" : "Next active carrier →"}
          </button>
        </div>
      )}
    </div>
  );
}
