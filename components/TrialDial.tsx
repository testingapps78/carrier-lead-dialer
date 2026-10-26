"use client";

import { useCallback, useState } from "react";
import { Phone, MapPin, Truck, Loader2, Mail } from "lucide-react";
import { Carrier, formatPhone } from "@/lib/types";
import CopyButton from "@/components/CopyButton";
import EnrichmentPanel from "@/components/EnrichmentPanel";

type Mode = "dot" | "mc";
const TRIAL_LIMIT = 10;

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA",
  "ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK",
  "OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

export default function TrialDial() {
  const [mode, setMode] = useState<Mode>("mc");
  const [startInput, setStartInput] = useState("");
  const [state, setState] = useState("");
  const [minPU, setMinPU] = useState("1");
  const [maxPU, setMaxPU] = useState("8");
  const [docketOnly, setDocketOnly] = useState(true);

  const [cursor, setCursor] = useState<number | null>(null);
  const [current, setCurrent] = useState<Carrier | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [started, setStarted] = useState(false);
  const [limitReached, setLimitReached] = useState(false);

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

  async function fetchNext(after: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/trial/next-carrier?${buildParams(after).toString()}`);
      const data = await res.json();
      if (data.limitReached) {
        setLimitReached(true);
        return;
      }
      if (!res.ok) throw new Error(data.error || "Lookup failed.");
      if (typeof data.remaining === "number") setRemaining(data.remaining);
      if (!data.carrier) {
        setExhausted(true);
        setCurrent(null);
      } else {
        setExhausted(false);
        setCurrent(data.carrier);
        const nextCursor = mode === "dot" ? data.carrier.dot_number : data.carrier.docket_number;
        setCursor(nextCursor);
      }
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

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

  const phone = formatPhone(current?.phone ?? null);
  const cell = formatPhone(current?.cell_phone ?? null);

  if (limitReached) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <div className="mile-marker inline-block border-2 border-accent text-accent-ink px-3 py-1 text-sm font-semibold tracking-widest rounded-lg mb-6">
          TRIAL COMPLETE
        </div>
        <h2 className="font-display text-2xl font-semibold mb-3">You've used all 10 free lookups</h2>
        <p className="text-muted text-sm mb-6">
          That's the full experience — live FMCSA data, officer contacts, authority and insurance on file. If this is
          useful for your work, let's talk about getting you set up with ongoing access.
        </p>
        <a
          href="mailto:mr.shahzaibali@yahoo.com?subject=Carrier Dialer access"
          className="inline-flex items-center gap-2 bg-accent text-oncolor font-semibold rounded-xl px-5 py-3 hover:bg-accent/90 transition-colors"
        >
          <Mail size={16} /> mr.shahzaibali@yahoo.com
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 pt-8 pb-16">
      <div className="tile text-center mb-4 !py-8">
        <div className="mile-marker inline-block border-2 border-accent text-accent-ink px-3 py-1 text-sm font-semibold tracking-widest rounded-xl mb-4">
          FREE TRIAL
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Carrier Dialer</h1>
        <p className="text-muted text-sm mt-2 max-w-md mx-auto">
          Everything FMCSA and SAFER show you — plus what they don't.
        </p>
        <div className="max-w-md mx-auto mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-left">
          <div className="bg-surface border border-border rounded-lg p-3">
            <span className="text-accent-ink font-semibold block mb-0.5">No dead ends</span>
            Inactive MC numbers skip themselves. Stop clicking into companies that can't take your call.
          </div>
          <div className="bg-surface border border-border rounded-lg p-3">
            <span className="text-accent-ink font-semibold block mb-0.5">Know who to ask for</span>
            Owner name and direct email, not just a front-desk number.
          </div>
          <div className="bg-surface border border-border rounded-lg p-3">
            <span className="text-accent-ink font-semibold block mb-0.5">One screen, not five tabs</span>
            Authority, insurance, and fleet size together — no more cross-checking SAFER and Motus separately.
          </div>
        </div>
        {remaining !== null && (
          <p className="text-xs text-accent-ink mt-4">{remaining} of {TRIAL_LIMIT} free lookups left</p>
        )}
      </div>

      <form onSubmit={handleStart} className="tile mb-4 flex flex-wrap items-end gap-3">
        <div className="flex rounded-xl border border-border overflow-hidden text-sm">
          <button type="button" onClick={() => setMode("mc")} className={`px-4 min-h-[40px] font-semibold ${mode === "mc" ? "bg-accent text-accent-text" : "text-muted"}`}>
            Scan by MC
          </button>
          <button type="button" onClick={() => setMode("dot")} className={`px-4 min-h-[40px] font-semibold ${mode === "dot" ? "bg-accent text-accent-text" : "text-muted"}`}>
            Scan by DOT
          </button>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Starting {mode === "mc" ? "MC" : "DOT"} #</label>
          <input
            value={startInput}
            onChange={(e) => setStartInput(e.target.value)}
            placeholder={mode === "mc" ? "e.g. 900000" : "e.g. 2500000"}
            className="w-36 bg-inset border border-border rounded-xl px-3 py-2.5 min-h-[40px] mile-marker text-ink focus:border-accent outline-none"
            inputMode="numeric"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">State</label>
          <select value={state} onChange={(e) => setState(e.target.value)} className="bg-inset border border-border rounded-xl px-3 py-2.5 min-h-[40px] text-ink focus:border-accent outline-none">
            <option value="">Any</option>
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Power units</label>
          <div className="flex items-center gap-1.5">
            <input value={minPU} onChange={(e) => setMinPU(e.target.value)} className="w-14 bg-surface2 border border-border rounded-lg px-2 py-2.5 text-ink focus:border-accent outline-none" inputMode="numeric" />
            <span className="text-muted">–</span>
            <input value={maxPU} onChange={(e) => setMaxPU(e.target.value)} className="w-14 bg-surface2 border border-border rounded-lg px-2 py-2.5 text-ink focus:border-accent outline-none" inputMode="numeric" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted pb-2.5">
          <input type="checkbox" checked={docketOnly} onChange={(e) => setDocketOnly(e.target.checked)} />
          Has MC authority
        </label>
        <button type="submit" className="btn btn-primary ml-auto">
          {started ? "Restart" : "Try it"}
        </button>
      </form>

      {error && <div className="bg-bad/10 border border-bad/40 text-bad text-sm rounded-xl px-4 py-3 mb-5">{error}</div>}

      {!started && !error && (
        <div className="text-center text-muted py-16 border border-dashed border-border rounded-xl">
          Enter a starting number above to see it in action.
        </div>
      )}

      {started && exhausted && (
        <div className="text-center text-muted py-16 border border-dashed border-border rounded-xl">
          No more active carriers match these filters from here on.
        </div>
      )}

      {loading && !current && (
        <div className="flex items-center justify-center gap-2 text-muted py-16">
          <Loader2 size={16} className="animate-spin" /> Looking up the next active carrier…
        </div>
      )}

      {current && !exhausted && (
        <div key={current.dot_number} className="tile !p-6 animate-fade-in">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {current.docket_prefix && current.docket_number && (
              <span className="mile-marker text-sm border border-accent text-accent-ink px-2.5 py-1 rounded-lg">
                {current.docket_prefix}-{current.docket_number}
              </span>
            )}
            <span className="mile-marker text-sm border border-border text-muted px-2.5 py-1 rounded-lg">DOT {current.dot_number}</span>
          </div>

          <h2 className="font-display text-2xl font-semibold tracking-tight">{current.legal_name || "Unnamed carrier"}</h2>
          {current.dba_name && <p className="text-muted text-sm mt-0.5">dba {current.dba_name}</p>}

          <div className="grid sm:grid-cols-2 gap-5 mt-6">
            <div className="flex gap-3">
              <Phone size={16} className="text-muted mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-medium text-muted mb-1">Phone</div>
                {phone ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="mile-marker text-lg">{phone}</span>
                    <CopyButton value={current.phone ?? ""} />
                  </div>
                ) : <span className="text-muted text-sm">Not on file</span>}
                {cell && <div className="mile-marker text-sm text-muted mt-1">{cell} (cell)</div>}
              </div>
            </div>
            <div className="flex gap-3">
              <MapPin size={16} className="text-muted mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-medium text-muted mb-1">Location</div>
                <div className="text-sm">{[current.phy_city, current.phy_state, current.phy_zip].filter(Boolean).join(", ") || "—"}</div>
              </div>
            </div>
            <div className="flex gap-3">
              <Truck size={16} className="text-muted mt-0.5 shrink-0" />
              <div>
                <div className="text-xs font-medium text-muted mb-1">Fleet</div>
                <div className="text-sm">{current.power_units ?? "?"} power units · {current.total_drivers ?? "?"} drivers</div>
              </div>
            </div>
          </div>

          <EnrichmentPanel dotNumber={current.dot_number} endpoint={`/api/trial/enrich/${current.dot_number}`} />

          <button onClick={handleNext} disabled={loading} className="btn btn-primary w-full mt-6 min-h-[48px] text-base disabled:opacity-50">
            {loading ? "Loading…" : "Next active carrier →"}
          </button>
        </div>
      )}
    </div>
  );
}
