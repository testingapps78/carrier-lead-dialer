"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, MapPin, Truck, Star, Play, Square, Loader2, ChevronLeft, ChevronDown, Mail, Building2 } from "lucide-react";
import { Carrier, Shift, MotusDetails, formatPhone, getLead, statusClass, formatDuration } from "@/lib/types";
import { useCallStatuses } from "@/lib/useCallStatuses";
import CopyButton from "@/components/CopyButton";

type Mode = "dot" | "mc";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA",
  "ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK",
  "OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

function useOpenShift() {
  const [shift, setShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    return fetch("/api/shifts")
      .then((r) => r.json())
      .then((d) => setShift(d.open ?? null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { shift, setShift, loading, reload: load };
}

function ShiftStrip({ shift, setShift, onCheckIn }: { shift: Shift | null; setShift: (s: Shift | null) => void; onCheckIn: () => void }) {
  const [busy, setBusy] = useState(false);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  async function toggle() {
    setBusy(true);
    try {
      if (shift) {
        const res = await fetch("/api/shifts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "checkout" }),
        });
        if (res.ok) setShift(null);
      } else {
        const res = await fetch("/api/shifts", { method: "POST" });
        const data = await res.json();
        if (res.ok) {
          setShift(data.shift);
          onCheckIn();
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between bg-surface border border-border rounded-xl px-4 py-3 mb-4">
      <div className="min-w-0">
        {shift ? (
          <>
            <div className="text-sm text-ink font-medium">Checked in · {formatDuration(shift.check_in, null)}</div>
            <div className="text-xs text-muted mt-0.5">
              {shift.carriers_viewed} viewed
              {shift.start_number ? ` · from ${shift.start_number} to ${shift.end_number ?? shift.start_number}` : ""}
            </div>
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

function EnrichmentPanel({ dotNumber, initial }: { dotNumber: number; initial?: MotusDetails | null }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<MotusDetails | null | undefined>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen() {
    setOpen((o) => !o);
    if (details !== undefined || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/carriers/${dotNumber}/enrich`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDetails(data.details ?? null);
    } catch (e: any) {
      setError(e?.message || "Couldn't load additional details.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-5">
      <button
        onClick={handleOpen}
        className="flex items-center gap-1.5 text-xs text-muted hover:text-ink transition-colors"
      >
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        {open ? "Hide" : "Show"} owner, officers & more detail
      </button>

      {open && (
        <div className="mt-3 bg-surface2 border border-border rounded-xl p-4 animate-fade-in">
          {loading && (
            <div className="flex items-center gap-2 text-muted text-sm py-2">
              <Loader2 size={14} className="animate-spin" /> Checking the additional public record…
            </div>
          )}
          {error && <div className="text-bad text-sm">{error}</div>}
          {!loading && details === null && (
            <div className="text-muted text-sm">No additional public record found for this carrier yet.</div>
          )}
          {details && (
            <div className="space-y-4">
              {details.officials?.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted mb-2">Company officials</div>
                  <div className="space-y-2">
                    {details.officials.map((o, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <Building2 size={14} className="text-muted mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-medium">
                            {o.name} {o.title && <span className="text-muted font-normal">· {o.title}</span>}
                          </div>
                          <div className="flex flex-wrap gap-x-3 text-xs text-muted mt-0.5">
                            {o.phone && <span className="mile-marker">{formatPhone(o.phone)}</span>}
                            {o.email && (
                              <span className="flex items-center gap-1">
                                <Mail size={11} /> {o.email}
                                <CopyButton value={o.email} label="" />
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {details.businessEmail && (
                <div className="text-sm flex items-center gap-2">
                  <span className="text-muted text-xs uppercase tracking-wide">Business email</span>
                  <span>{details.businessEmail}</span>
                  <CopyButton value={details.businessEmail} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {details.formOfBusiness && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted">Form of business</div>
                    {details.formOfBusiness}
                  </div>
                )}
                {details.stateIncorporated && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted">Incorporated in</div>
                    {details.stateIncorporated}
                  </div>
                )}
                {details.dunsBradstreet && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted">D&B number</div>
                    {details.dunsBradstreet}
                  </div>
                )}
              </div>
              {details.vehicles?.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Vehicles</div>
                  <div className="text-sm space-y-0.5">
                    {details.vehicles.map((v, i) => (
                      <div key={i}>
                        {v.type}: {v.owned || "0"} owned{v.leased ? `, ${v.leased} leased` : ""}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {details.cargoClasses?.length > 0 && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Cargo</div>
                  <div className="text-sm">{details.cargoClasses.join(", ")}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DialTool() {
  const { statuses } = useCallStatuses();
  const { shift, setShift, reload: reloadShift } = useOpenShift();
  const [mode, setMode] = useState<Mode>("mc");
  const [startInput, setStartInput] = useState("");
  const [state, setState] = useState("");
  const [minPU, setMinPU] = useState("1");
  const [maxPU, setMaxPU] = useState("8");
  const [docketOnly, setDocketOnly] = useState(true);

  const [cursor, setCursor] = useState<number | null>(null);
  const [startNumber, setStartNumber] = useState<number | null>(null);
  const [current, setCurrent] = useState<Carrier | null>(null);
  const [history, setHistory] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [started, setStarted] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingLead, setSavingLead] = useState(false);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Warn before leaving the tab if a shift is currently open.
  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (shift) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [shift]);

  // If we reload mid-shift with progress already saved, offer to resume exactly
  // where we left off instead of losing the scan position.
  useEffect(() => {
    if (shift && shift.end_number && !started) {
      setMode((shift.mode as Mode) || "mc");
      setState(shift.state || "");
      if (shift.min_power_units != null) setMinPU(String(shift.min_power_units));
      if (shift.max_power_units != null) setMaxPU(String(shift.max_power_units));
      if (shift.docket_only != null) setDocketOnly(shift.docket_only);
      setCursor(shift.end_number);
      setStartNumber(shift.start_number ?? shift.end_number);
      setStarted(true);
      fetchNext(shift.end_number, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift]);

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

  const persistProgress = useCallback(
    (endNumber: number, firstStart?: number) => {
      if (!shift) return;
      fetch("/api/shifts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          state: state || null,
          minPowerUnits: minPU ? Number(minPU) : null,
          maxPowerUnits: maxPU ? Number(maxPU) : null,
          docketOnly,
          startNumber: firstStart,
          endNumber,
        }),
      }).catch(() => {});
    },
    [shift, mode, state, minPU, maxPU, docketOnly]
  );

  const fetchNext = useCallback(
    async (after: number, isResume = false) => {
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
          if (current && !isResume) setHistory((h) => [...h, current]);
          setCurrent(data.carrier);
          setNotesDraft(getLead(data.carrier)?.notes ?? "");
          const nextCursor = mode === "dot" ? data.carrier.dot_number : data.carrier.docket_number;
          setCursor(nextCursor);
          const firstStart = startNumber ?? nextCursor;
          if (startNumber === null) setStartNumber(nextCursor);
          persistProgress(nextCursor, startNumber === null ? firstStart : undefined);
        }
      } catch (e: any) {
        setError(e?.message || "Something went wrong.");
      } finally {
        setLoading(false);
      }
    },
    [buildParams, mode, current, startNumber, persistProgress]
  );

  function handleStart(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseInt(startInput.replace(/\D/g, ""), 10);
    const after = Number.isFinite(parsed) ? parsed - 1 : 0;
    setStarted(true);
    setHistory([]);
    setStartNumber(null);
    fetchNext(after);
  }

  function handleNext() {
    if (cursor === null) return;
    fetchNext(cursor);
  }

  function handleBack() {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setCurrent(prev);
    setNotesDraft(getLead(prev)?.notes ?? "");
    const prevCursor = mode === "dot" ? prev.dot_number : prev.docket_number;
    if (prevCursor) setCursor(prevCursor);
    setExhausted(false);
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
      <ShiftStrip shift={shift} setShift={setShift} onCheckIn={() => { setStarted(false); setCurrent(null); setHistory([]); }} />

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
              <span className="flex items-center gap-1 mile-marker text-sm border border-accent text-accent px-2.5 py-1 rounded-lg">
                {current.docket_prefix}-{current.docket_number}
                <CopyButton value={String(current.docket_number)} label="" />
              </span>
            )}
            <span className="flex items-center gap-1 mile-marker text-sm border border-border text-muted px-2.5 py-1 rounded-lg">
              DOT {current.dot_number}
              <CopyButton value={String(current.dot_number)} label="" />
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

          <EnrichmentPanel dotNumber={current.dot_number} initial={current.motus_details} />

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

          <div className="flex gap-2 mt-6">
            <button
              onClick={handleBack}
              disabled={history.length === 0 || loading}
              className="flex items-center gap-1 bg-surface2 border border-border text-ink font-medium rounded-xl px-4 py-3.5 disabled:opacity-40 hover:border-accent transition-colors"
            >
              <ChevronLeft size={16} />
              Back
            </button>
            <button
              onClick={handleNext}
              disabled={loading}
              className="flex-1 bg-accent glow-accent text-base font-semibold rounded-xl py-3.5 hover:bg-accent/90 disabled:opacity-50 transition-all"
            >
              {loading ? "Loading…" : "Next active carrier →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
