"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, Mail, MapPin, Truck, Star, Bookmark, Loader2, ChevronLeft, User, Bell, History as HistoryIcon, PhoneCall } from "lucide-react";
import { Carrier, MotusDetails, Shift, formatPhone, getLead, statusClass } from "@/lib/types";
import { useLeadSaver } from "@/lib/useLeadSaver";
import { friendlyError, newKey, post, api } from "@/lib/leadClient";
import { callbackBucket } from "@/lib/callbacks";
import { browserTimeZone } from "@/lib/callbackTime";
import { CallbackSection, ConfirmedContact, DialButton, DncBanner, HistoryPanel, LogCallForm, NotesEditor, PendingNotes } from "@/components/LeadTools";
import { OpenerLine, BriefFacts, TruckTypes, OwnerAndCargo, FactLabel } from "@/components/CallBrief";
import Tile from "@/components/Tile";
import ViewMore from "@/components/ViewMore";
import AIPanel from "@/components/AIPanel";
import { useCallStatuses } from "@/lib/useCallStatuses";
import CopyButton from "@/components/CopyButton";
import EnrichmentPanel from "@/components/EnrichmentPanel";
import SessionBar from "@/components/SessionBar";

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

export default function DialTool({ userId }: { userId: string }) {
  const { statuses } = useCallStatuses();
  const { shift, setShift, loading: shiftLoading } = useOpenShift();
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
  const [notice, setNotice] = useState<string | null>(null);
  const [enriched, setEnriched] = useState<{ dot: number; details: MotusDetails | null } | null>(null);
  const [detailsState, setDetailsState] = useState<{ dot: number; loading: boolean; error: string | null }>({ dot: 0, loading: false, error: null });
  const [exhausted, setExhausted] = useState(false);
  const [started, setStarted] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [pendingEdits, setPendingEdits] = useState(0);
  const savingLead = pendingEdits > 0;
  const [editError, setEditError] = useState<{ dot: number; message: string; retry: () => void } | null>(null);
  const [panel, setPanel] = useState<"none" | "log" | "callback" | "history">("none");
  const [continuation, setContinuation] = useState<string | null>(null);
  const editChains = useRef(new Map<number, Promise<unknown>>());

  // A server-confirmed lead is applied ONLY to the carrier it belongs to (on screen or in Back history),
  // never to whichever carrier happens to be showing when a slow response arrives.
  const applyLead = useCallback((dot: number, lead: any) => {
    setCurrent((prev) => (prev && prev.dot_number === dot ? { ...prev, leads: lead } : prev));
    setHistory((h) => h.map((c) => (c.dot_number === dot ? { ...c, leads: lead } : c)));
  }, []);
  const saver = useLeadSaver(userId, applyLead);

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

  // Restore exactly where we left off — independent of check-in status, and
  // survives a full refresh or a crashed/closed browser, because this reads
  // from the database rather than in-memory component state.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/scan-state");
        const data = await res.json();
        const s = data.state;
        if (!s || !s.cursor) return;

        setMode(s.mode || "mc");
        setState(s.filterState || "");
        if (s.minPowerUnits != null) setMinPU(String(s.minPowerUnits));
        if (s.maxPowerUnits != null) setMaxPU(String(s.maxPowerUnits));
        setDocketOnly(!!s.docketOnly);
        setStartNumber(s.startNumber ?? null);
        setCursor(s.cursor);

        const dotsToFetch = [...(s.history ?? []), s.currentDot].filter(Boolean);
        if (dotsToFetch.length > 0) {
          const lookup = await api(`/api/carriers/lookup?dots=${dotsToFetch.join(",")}`);
          if (!lookup.ok) {
            setError(`Couldn't restore your last scan (${friendlyError(lookup)}). Press Start scan to continue, or reload.`);
            return;
          }
          const byDot = new Map<number, Carrier>(lookup.data.carriers.map((c: Carrier) => [c.dot_number, c]));
          const restoredHistory = (s.history ?? []).map((d: number) => byDot.get(d)).filter(Boolean) as Carrier[];
          const restoredCurrent = byDot.get(s.currentDot) as Carrier | undefined;
          setHistory(restoredHistory);
          if (restoredCurrent) setCurrent(restoredCurrent);
        }
        setStarted(true);
      } catch {
        // No saved state, or it failed to load — just start fresh.
      } finally {
        setRestoring(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Persists to profiles.scan_state (always) and to the open shift's ledger
  // fields (only when checked in) — two different concerns that both need
  // the same numbers.
  const persistProgress = useCallback(
    (endNumber: number, firstStart: number | null, historyDots: number[], currentDot: number) => {
      fetch("/api/scan-state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          filterState: state || null,
          minPowerUnits: minPU ? Number(minPU) : null,
          maxPowerUnits: maxPU ? Number(maxPU) : null,
          docketOnly,
          startNumber: firstStart,
          cursor: endNumber,
          history: historyDots,
          currentDot,
        }),
      }).catch(() => {});

      if (shift) {
        fetch("/api/shifts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            state: state || null,
            minPowerUnits: minPU ? Number(minPU) : null,
            maxPowerUnits: maxPU ? Number(maxPU) : null,
            docketOnly,
            startNumber: firstStart ?? undefined,
            endNumber,
          }),
        }).catch(() => {});
      }
    },
    [shift, mode, state, minPU, maxPU, docketOnly]
  );

  const fetchNext = useCallback(
    async (after: number) => {
      setLoading(true);
      setError(null);
      setNotice(null);
      try {
        // FMCSA's public API rate-limits (429) now and then. The server already
        // retries briefly; if it still reports "busy", wait and retry here
        // automatically instead of making the user hit Next again.
        const MAX_AUTO_RETRIES = 2;
        let data: any = null;
        for (let attempt = 0; ; attempt++) {
          const res = await fetch(`/api/next-carrier?${buildParams(after).toString()}`);
          data = await res.json().catch(() => ({}));
          if (res.ok) break;
          if (data?.code === "rate_limited" && attempt < MAX_AUTO_RETRIES) {
            const wait = Math.min(Math.max(Number(data.retryAfterSeconds) || 5, 3), 10);
            for (let s = wait; s > 0; s--) {
              setNotice(`FMCSA is busy — retrying in ${s}s… (try ${attempt + 2} of ${MAX_AUTO_RETRIES + 1})`);
              await new Promise((r) => setTimeout(r, 1000));
            }
            setNotice("Retrying…");
            continue;
          }
          throw new Error(data?.error || "Lookup failed.");
        }
        if (!data.carrier && data.continuation) {
          // Everything in this stretch was on the agent's Do Not Call list: keep going from the cursor.
          setExhausted(false);
          setCursor(data.continuation.cursor);
          setContinuation(data.continuation.message);
        } else if (!data.carrier) {
          setContinuation(null);
          setExhausted(true);
          setCurrent(null);
        } else {
          setContinuation(null);
          setExhausted(false);
          setCurrent((prevCurrent) => {
            setHistory((h) => (prevCurrent ? [...h, prevCurrent] : h));
            return data.carrier;
          });
          const nextCursor = mode === "dot" ? data.carrier.dot_number : data.carrier.docket_number;
          setCursor(nextCursor);
          setStartNumber((prevStart) => {
            const effectiveStart = prevStart ?? nextCursor;
            setHistory((h) => {
              const historyDots = h.map((c) => c.dot_number);
              persistProgress(nextCursor, effectiveStart, historyDots, data.carrier.dot_number);
              return h;
            });
            return effectiveStart;
          });
        }
      } catch (e: any) {
        setError(e?.message || "Something went wrong.");
      } finally {
        setNotice(null);
        setLoading(false);
      }
    },
    [buildParams, mode, persistProgress]
  );

  function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (current) void saver.flush(current.dot_number);
    const parsed = parseInt(startInput.replace(/\D/g, ""), 10);
    const after = Number.isFinite(parsed) ? parsed - 1 : 0;
    setStarted(true);
    setCurrent(null);
    setHistory([]);
    setStartNumber(null);
    setExhausted(false);
    fetchNext(after);
  }

  function handleNext() {
    if (cursor === null) return;
    if (current) void saver.flush(current.dot_number);
    fetchNext(cursor);
  }

  function handleBack() {
    if (history.length === 0) return;
    if (current) void saver.flush(current.dot_number);
    const prev = history[history.length - 1];
    const newHistory = history.slice(0, -1);
    setHistory(newHistory);
    setCurrent(prev);
    const prevCursor = mode === "dot" ? prev.dot_number : prev.docket_number ?? prev.dot_number;
    setCursor(prevCursor);
    setExhausted(false);
    persistProgress(
      prevCursor,
      startNumber,
      newHistory.map((c) => c.dot_number),
      prev.dot_number
    );
  }

  // Status / important / saved edits: sent one at a time per lead, in order, with the lead's identity
  // captured now. The confirmed lead from each response is applied to that same lead only.
  function leadEdit(patch: { status?: string; priority?: boolean; saved?: boolean }, key: string = newKey()): Promise<boolean> {
    if (!current) return Promise.resolve(false);
    const dot = current.dot_number;
    setPendingEdits((n) => n + 1);
    setEditError(null);
    const previous = editChains.current.get(dot) ?? Promise.resolve();
    const run = previous.then(async () => {
      const r = await post("/api/leads", { dot_number: dot, ...patch, idempotency_key: key, expected_user_id: userId });
      if (r.ok) {
        applyLead(dot, r.data.lead);
        return true;
      }
      setEditError({ dot, message: friendlyError(r), retry: () => void leadEdit(patch, key) });
      return false;
    });
    editChains.current.set(dot, run.catch(() => false));
    return run.finally(() => setPendingEdits((n) => n - 1));
  }

  // Owner names, truck types and cargo come from FMCSA's newer registration records.
  // It is a slower lookup (up to ~15s), so it only runs on request (or when saving).
  async function loadDetails(dot: number) {
    setDetailsState({ dot, loading: true, error: null });
    try {
      const res = await fetch(`/api/carriers/${dot}/enrich`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Couldn't load details. Try again.");
      setEnriched({ dot, details: data.details ?? null });
      setDetailsState({ dot, loading: false, error: data.details ? null : "No extra public record found for this carrier." });
    } catch (e: any) {
      setDetailsState({ dot, loading: false, error: e?.message || "Couldn't load details. Try again." });
    }
  }

  async function toggleSaved() {
    if (!current) return;
    const dot = current.dot_number;
    const next = !getLead(current)?.saved;
    const ok = await leadEdit({ saved: next });
    // When saving, also fetch owner/truck details in the background so the
    // exported spreadsheet has them (they are cached on the carrier).
    const haveDetails = !!current.motus_details || (enriched?.dot === dot && !!enriched.details);
    if (ok && next && !haveDetails && !(detailsState.dot === dot && detailsState.loading)) {
      loadDetails(dot);
    }
  }

  async function handleStatusClick(value: string) {
    if (value === "callback") {
      // A callback is a status plus a time: if the lead was Do Not Call, lift that first, then ask for the time.
      if (getLead(current)?.status === "do_not_call") {
        const ok = await leadEdit({ status: "callback" });
        if (!ok) return;
      }
      setPanel("callback");
      return;
    }
    setPanel((p) => (p === "callback" ? "none" : p));
    void leadEdit({ status: value });
  }

  // A different carrier is on screen: close the small panels.
  useEffect(() => {
    setPanel("none");
  }, [current?.dot_number]);

  const lead = getLead(current);
  const isDnc = lead?.status === "do_not_call";
  const viewerTz = browserTimeZone();
  const dotLabel = (d: number) => {
    const c = [current, ...history].find((x) => x && x.dot_number === d);
    return c?.legal_name ? `${c.legal_name} (DOT ${d})` : `DOT ${d}`;
  };
  const phone = formatPhone(current?.phone ?? null);
  const cell = formatPhone(current?.cell_phone ?? null);

  const inputCls = "bg-inset border border-border rounded-xl px-3 h-10 text-sm text-ink focus:border-accent outline-none";
  const labelCls = "block text-xs font-medium text-muted mb-1";
  const details = current ? current.motus_details ?? (enriched?.dot === current.dot_number ? enriched.details : null) : null;
  const detailsLoading = !!current && detailsState.dot === current.dot_number && detailsState.loading;
  const detailsError = current && detailsState.dot === current.dot_number ? detailsState.error : null;
  const pill = (active: boolean) =>
    `inline-flex items-center gap-1.5 text-sm px-3 min-h-[32px] rounded-full border transition-colors ${
      active ? "bg-accent/15 text-accent-ink border-accent" : "text-muted border-border hover:text-ink hover:bg-inset"
    }`;

  return (
    <div className="w-full px-6 pt-4 pb-24 md:pb-6">
      {/* Row 1: scan controls and the merged check-in */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12 mb-4">
        <Tile label="Scan" className="xl:col-span-8">
          <form onSubmit={handleStart} className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <div className="flex rounded-xl border border-border overflow-hidden text-sm h-10">
              <button
                type="button"
                onClick={() => setMode("mc")}
                className={`px-4 font-semibold ${mode === "mc" ? "bg-accent text-accent-text" : "text-muted hover:bg-inset"}`}
              >
                MC
              </button>
              <button
                type="button"
                onClick={() => setMode("dot")}
                className={`px-4 font-semibold ${mode === "dot" ? "bg-accent text-accent-text" : "text-muted hover:bg-inset"}`}
              >
                DOT
              </button>
            </div>

            <div>
              <label className={labelCls}>Starting {mode === "mc" ? "MC" : "DOT"} #</label>
              <input
                value={startInput}
                onChange={(e) => setStartInput(e.target.value)}
                placeholder={mode === "mc" ? "e.g. 900000" : "e.g. 2500000"}
                className={`w-36 mile-marker ${inputCls}`}
                inputMode="numeric"
              />
            </div>

            <div>
              <label className={labelCls}>State</label>
              <select value={state} onChange={(e) => setState(e.target.value)} className={inputCls}>
                <option value="">Any</option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>Power units</label>
              <div className="flex items-center gap-1.5">
                <input value={minPU} onChange={(e) => setMinPU(e.target.value)} className={`w-14 mile-marker ${inputCls}`} inputMode="numeric" />
                <span className="text-muted">–</span>
                <input value={maxPU} onChange={(e) => setMaxPU(e.target.value)} className={`w-14 mile-marker ${inputCls}`} inputMode="numeric" />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-muted min-h-[40px]">
              <input type="checkbox" checked={docketOnly} onChange={(e) => setDocketOnly(e.target.checked)} />
              Has MC authority
            </label>

            <button type="submit" className="btn btn-primary ml-auto">
              {started ? "Restart scan" : "Start scan"}
            </button>
          </form>
        </Tile>

        <Tile label="Check-in" className="xl:col-span-4">
          <SessionBar shift={shift} setShift={setShift} shiftReady={!shiftLoading} />
        </Tile>
      </div>

      <PendingNotes saver={saver} labelFor={dotLabel} />

      {editError && (
        <div className="flex items-center gap-2 flex-wrap bg-danger/10 border border-danger/40 text-danger text-sm rounded-tile px-4 py-2.5 mb-4">
          <span>Couldn&apos;t save the change for {dotLabel(editError.dot)}: {editError.message}</span>
          <button type="button" onClick={editError.retry} className="underline font-medium">Retry</button>
        </div>
      )}

      {notice && (
        <div className="bg-accent/10 border border-accent/40 text-accent-ink text-sm rounded-tile px-4 py-2.5 mb-4">{notice}</div>
      )}

      {continuation && (
        <div className="flex items-center gap-3 flex-wrap bg-accent/10 border border-accent/40 text-accent-ink text-sm rounded-tile px-4 py-2.5 mb-4">
          <span>{continuation}</span>
          {!current && (
            <button type="button" onClick={handleNext} disabled={loading} className="btn btn-primary disabled:opacity-50">
              Keep scanning
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="bg-danger/10 border border-danger/40 text-danger text-sm rounded-tile px-4 py-2.5 mb-4">{error}</div>
      )}

      {restoring && (
        <div className="flex items-center justify-center gap-2 text-muted py-12">
          <Loader2 size={16} className="animate-spin" /> Checking for a scan in progress…
        </div>
      )}

      {!restoring && !started && !error && (
        <div className="text-center text-muted py-12 border border-dashed border-border rounded-tile">
          Set a starting {mode === "mc" ? "MC" : "DOT"} number above and hit <span className="text-ink">Start scan</span>.
        </div>
      )}

      {!restoring && started && exhausted && (
        <div className="text-center text-muted py-12 border border-dashed border-border rounded-tile">
          No more active carriers match these filters from here on. Try raising the range or loosening a filter.
        </div>
      )}

      {loading && !current && (
        <div className="flex items-center justify-center gap-2 text-muted py-12">
          <Loader2 size={16} className="animate-spin" />
          Looking up the next active carrier…
        </div>
      )}

      {current && !exhausted && (
        <div key={current.dot_number} className="grid gap-4 md:grid-cols-2 xl:grid-cols-12 items-start animate-fade-in">
          {/* Left: who they are, how to reach them, what they run */}
          <div className="grid gap-4 xl:col-span-7">
            <Tile label="Carrier">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {current.docket_prefix && current.docket_number && (
                  <span className="flex items-center gap-1.5 mile-marker text-sm border border-accent text-accent-ink pl-2.5 pr-1 py-0.5 rounded-lg">
                    {current.docket_prefix}-{current.docket_number}
                    <CopyButton value={String(current.docket_number)} label="" />
                  </span>
                )}
                <span className="flex items-center gap-1.5 mile-marker text-sm border border-border text-muted pl-2.5 pr-1 py-0.5 rounded-lg">
                  DOT {current.dot_number}
                  <CopyButton value={String(current.dot_number)} label="" />
                </span>
                {current.hm_ind === "Y" && (
                  <span className="text-xs border border-danger/50 text-danger px-2 py-0.5 rounded-lg uppercase">Hazmat</span>
                )}
                {savingLead && <span className="text-xs text-muted">Saving…</span>}
                <button
                  onClick={toggleSaved}
                  disabled={savingLead}
                  className={`ml-auto inline-flex items-center gap-1.5 text-sm font-medium px-3 min-h-[40px] rounded-xl border transition-colors disabled:opacity-60 ${
                    lead?.saved ? "bg-accent/15 text-accent-ink border-accent" : "text-ink border-border hover:bg-inset"
                  }`}
                  title="Save this MC to export later"
                >
                  <Bookmark size={15} fill={lead?.saved ? "currentColor" : "none"} />
                  {lead?.saved ? "Saved" : "Save MC"}
                </button>
              </div>

              <h2 className="font-display text-2xl font-semibold tracking-tight leading-tight">
                {current.legal_name || "Unnamed carrier"}
                {current.dba_name && <span className="text-muted text-sm font-normal"> · dba {current.dba_name}</span>}
              </h2>

              {(current.company_rep1 || current.company_rep2) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mt-1.5 text-accent-ink">
                  {current.company_rep1 && (
                    <span className="flex items-center gap-1.5 text-base font-semibold">
                      <User size={16} className="shrink-0" /> {current.company_rep1}
                    </span>
                  )}
                  {current.company_rep2 && (
                    <span className="flex items-center gap-1.5 text-sm font-medium text-accent-ink">
                      <User size={14} className="shrink-0" /> {current.company_rep2}
                    </span>
                  )}
                </div>
              )}

              <ConfirmedContact dot={current.dot_number} lead={lead} userId={userId} onLead={applyLead} />

              {isDnc && (
                <div className="mt-3">
                  <DncBanner />
                </div>
              )}
            </Tile>

            <div className="grid gap-4 xl:grid-cols-5">
              <Tile label="Call" accent={!isDnc && !!phone} className="xl:col-span-3">
                {phone ? (
                  <>
                    <div className="num text-2xl font-semibold tracking-tight">{phone}</div>
                    <div className="flex items-start gap-2 mt-3">
                      <DialButton number={current.phone} dot={current.dot_number} userId={userId} blocked={isDnc} size="lg" tone="onAccent" onLead={applyLead} />
                      <CopyButton value={current.phone ?? ""} tone="onAccent" />
                    </div>
                  </>
                ) : (
                  <span className="text-muted text-sm">Not on file</span>
                )}
                {cell && (
                  <div className="flex items-start gap-2 mt-3">
                    <span className="num text-sm pt-2.5">{cell}</span>
                    <DialButton number={current.cell_phone} dot={current.dot_number} userId={userId} blocked={isDnc} label="Cell" variant="secondary" tone="onAccent" onLead={applyLead} />
                    <CopyButton value={current.cell_phone ?? ""} tone="onAccent" />
                  </div>
                )}
              </Tile>

              <Tile label="Contact" className="xl:col-span-2">
                <div className="space-y-3">
                  <div>
                    <FactLabel icon={<Mail size={12} />}>Email</FactLabel>
                    {current.email ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm break-all">{current.email}</span>
                        <CopyButton value={current.email} />
                      </div>
                    ) : (
                      <span className="text-muted text-sm">No email on file</span>
                    )}
                  </div>
                  <div>
                    <FactLabel icon={<MapPin size={12} />}>Location</FactLabel>
                    <div className="text-sm">
                      {[current.phy_city, current.phy_state, current.phy_zip].filter(Boolean).join(", ") || "—"}
                    </div>
                    <div className="text-muted text-xs">{current.phy_street}</div>
                  </div>
                </div>
              </Tile>
            </div>

            <div className="grid gap-4 xl:grid-cols-5">
              <Tile label="Fleet" className="xl:col-span-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted mb-1">
                  <Truck size={12} /> Fleet size
                </div>
                <div className="num text-sm">
                  {current.power_units ?? "?"} power units · {current.total_drivers ?? "?"} drivers
                </div>
                <div className="mt-3">
                  <TruckTypes details={details} loading={detailsLoading} error={detailsError} onLoadDetails={() => loadDetails(current.dot_number)} />
                </div>
              </Tile>

              <Tile label="Status" className="xl:col-span-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <BriefFacts carrier={current} />
                </div>
              </Tile>
            </div>

            <ViewMore>
              <OwnerAndCargo details={details} />
              <EnrichmentPanel dotNumber={current.dot_number} initial={current.motus_details ?? (enriched?.dot === current.dot_number ? enriched.details : undefined)} />
            </ViewMore>
          </div>

          {/* Right: the opener, the call itself, and moving on */}
          <div className="flex flex-col gap-4 xl:col-span-5">
            <Tile label="Opener">
              <OpenerLine carrier={current} confirmedName={lead?.contact_override_name} />
              <div className="mt-3">
                <AIPanel
                  carrier={current}
                  notes={saver.getDraft(current.dot_number) ?? lead?.notes ?? ""}
                  statuses={statuses}
                  onApplyNotes={(text) => saver.setNotes(current.dot_number, text)}
                  onApplyStatus={handleStatusClick}
                />
              </div>
            </Tile>

            <Tile label="Call notes">
              <div className="flex flex-wrap gap-2">
                {statuses.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleStatusClick(opt.value)}
                    className={`text-sm px-3 min-h-[32px] rounded-full border transition-colors ${statusClass(opt.color)} ${
                      lead?.status === opt.value ? "ring-2 ring-accent font-semibold" : "hover:brightness-95"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                <button onClick={() => void leadEdit({ priority: !lead?.priority })} className={pill(!!lead?.priority)}>
                  <Star size={14} fill={lead?.priority ? "currentColor" : "none"} />
                  Important
                </button>
              </div>

              <div className="mt-3">
                <CallbackSection
                  dot={current.dot_number}
                  lead={lead}
                  userId={userId}
                  onLead={applyLead}
                  open={panel === "callback"}
                  onOpenChange={(v) => setPanel(v ? "callback" : "none")}
                  onSaved={() => {
                    // Setting a callback also marks the lead as Callback (a separate, confirmed edit).
                    if (getLead(current)?.status !== "callback") void leadEdit({ status: "callback" });
                  }}
                />
              </div>

              <div className="mt-3">
                <NotesEditor dot={current.dot_number} serverNotes={lead?.notes} saver={saver} />
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-3">
                {!isDnc && (
                  <button type="button" onClick={() => setPanel((p) => (p === "log" ? "none" : "log"))} className={pill(panel === "log")}>
                    <PhoneCall size={14} /> Log call
                  </button>
                )}
                {!isDnc && (
                  <button type="button" onClick={() => setPanel((p) => (p === "callback" ? "none" : "callback"))} className={pill(panel === "callback")}>
                    <Bell size={14} /> Callback
                  </button>
                )}
                <button type="button" onClick={() => setPanel((p) => (p === "history" ? "none" : "history"))} className={pill(panel === "history")}>
                  <HistoryIcon size={14} /> History
                </button>
              </div>

              {panel === "log" && !isDnc && (
                <div className="mt-3">
                  <LogCallForm dot={current.dot_number} userId={userId} statuses={statuses} onLead={applyLead} />
                </div>
              )}
              {panel === "history" && (
                <div className="mt-3">
                  <HistoryPanel dot={current.dot_number} statusLabel={(v) => statuses.find((x) => x.value === v)?.label ?? v} />
                </div>
              )}
            </Tile>

            <Tile label="Browse">
              <div className="flex gap-3">
                <button onClick={handleBack} disabled={history.length === 0 || loading} className="btn btn-secondary min-h-[48px] disabled:opacity-40">
                  <ChevronLeft size={16} />
                  Back
                </button>
                <button onClick={handleNext} disabled={loading} className="btn btn-primary flex-1 min-h-[48px] text-base disabled:opacity-50">
                  {loading ? "Loading…" : "Next active carrier →"}
                </button>
              </div>
            </Tile>
          </div>
        </div>
      )}
    </div>
  );
}
