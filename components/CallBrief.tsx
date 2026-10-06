"use client";

import { useState } from "react";
import { Loader2, Clock, ShieldCheck, Route, Package } from "lucide-react";
import type { Carrier, MotusDetails } from "@/lib/types";
import CopyButton from "@/components/CopyButton";
import { buildOpener, monthYear, operationLabel, registeredSince, safetyLabel, statusLabel } from "@/lib/callBrief";

export default function CallBrief({
  carrier,
  details,
  onDetails,
}: {
  carrier: Carrier;
  details?: MotusDetails | null; // cargo/officials details, if already loaded or cached
  onDetails: (d: MotusDetails | null) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opener = buildOpener(carrier);
  const reg = registeredSince(carrier.add_date);
  const status = statusLabel(carrier.status_code);
  const safety = safetyLabel(carrier.safety_rating);
  const operation = operationLabel(carrier);
  const mcs150 = monthYear(carrier.mcs150_date);
  const cargo = details?.cargoClasses?.length ? details.cargoClasses.join(", ") : null;

  async function loadCargo() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/carriers/${carrier.dot_number}/enrich`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Couldn't load cargo details.");
      onDetails(data.details ?? null);
      if (!data.details?.cargoClasses?.length) setError("No cargo details on file for this carrier.");
    } catch (e: any) {
      setError(e?.message || "Couldn't load cargo details.");
    } finally {
      setLoading(false);
    }
  }

  const toneClass =
    safety.tone === "good" ? "text-emerald-400" : safety.tone === "bad" ? "text-bad" : "text-ink";

  return (
    <div className="mt-5 bg-surface2 border border-accent/30 rounded-xl p-4">
      <div className="text-[11px] uppercase tracking-wide text-accent mb-2">Before you call</div>

      <div className="flex items-start gap-2">
        <p className="text-sm leading-relaxed flex-1">&ldquo;{opener}&rdquo;</p>
        <CopyButton value={opener} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-4 text-sm">
        <div>
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted mb-0.5">
            <Clock size={11} /> Registered
          </div>
          {reg ? (
            <>
              <div className="font-medium">{reg.age}</div>
              <div className="text-muted text-xs">since {reg.long}</div>
            </>
          ) : (
            <span className="text-muted">Unknown</span>
          )}
          {mcs150 && <div className="text-muted text-xs mt-0.5">Last MCS-150 update: {mcs150}</div>}
        </div>

        <div>
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted mb-0.5">
            <ShieldCheck size={11} /> Status &amp; safety
          </div>
          <div className={`font-medium ${status.ok === false ? "text-bad" : ""}`}>{status.label}</div>
          <div className={`text-xs ${toneClass}`}>Safety: {safety.label}</div>
        </div>

        <div>
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted mb-0.5">
            <Route size={11} /> Operation
          </div>
          <div>{operation || <span className="text-muted">Unknown</span>}</div>
        </div>

        <div>
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted mb-0.5">
            <Package size={11} /> Cargo carried
          </div>
          {cargo ? (
            <div>{cargo}</div>
          ) : (
            <button
              type="button"
              onClick={loadCargo}
              disabled={loading}
              className="text-xs px-2 py-1 rounded border border-border text-muted hover:text-ink hover:border-accent transition-colors disabled:opacity-60"
            >
              {loading ? (
                <span className="flex items-center gap-1">
                  <Loader2 size={11} className="animate-spin" /> Loading (up to 15s)…
                </span>
              ) : (
                "Load cargo"
              )}
            </button>
          )}
          {error && <div className="text-xs text-muted mt-1">{error}</div>}
        </div>
      </div>
    </div>
  );
}
