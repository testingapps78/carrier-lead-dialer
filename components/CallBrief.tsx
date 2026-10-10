"use client";

import { Loader2, Clock, ShieldCheck, Route, User, Package, Truck } from "lucide-react";
import type { Carrier, MotusDetails } from "@/lib/types";
import CopyButton from "@/components/CopyButton";
import { buildOpener, monthYear, operationLabel, registeredSince, safetyLabel, spokenSeconds, statusLabel } from "@/lib/callBrief";

export function FactLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted mb-0.5">
      {icon} {children}
    </div>
  );
}

/** One short line to say first, with a copy button. */
export function OpenerLine({ carrier, confirmedName }: { carrier: Carrier; confirmedName?: string | null }) {
  const opener = buildOpener(carrier, new Date(), confirmedName);
  return (
    <div className="flex items-center gap-2 bg-surface2 border border-accent/30 rounded-lg pl-3 pr-1.5 py-1.5">
      <span className="text-[10px] uppercase tracking-wide text-accent shrink-0">Say</span>
      <p className="text-sm leading-snug flex-1 min-w-0">&ldquo;{opener}&rdquo;</p>
      <span className="text-[10px] text-muted shrink-0 hidden sm:inline">~{spokenSeconds(opener)}s</span>
      <CopyButton value={opener} />
    </div>
  );
}

/** Registered / status & safety / operation, as grid cells for the facts grid. */
export function BriefFacts({ carrier }: { carrier: Carrier }) {
  const reg = registeredSince(carrier.add_date);
  const status = statusLabel(carrier.status_code);
  const safety = safetyLabel(carrier.safety_rating);
  const operation = operationLabel(carrier);
  const mcs150 = monthYear(carrier.mcs150_date);
  const toneClass = safety.tone === "good" ? "text-emerald-400" : safety.tone === "bad" ? "text-bad" : "text-ink";

  return (
    <>
      <div>
        <FactLabel icon={<Clock size={10} />}>Registered</FactLabel>
        {reg ? (
          <>
            <div className="text-sm font-medium">{reg.age}</div>
            <div className="text-muted text-xs">
              since {reg.long}
              {mcs150 ? ` · MCS-150 ${mcs150}` : ""}
            </div>
          </>
        ) : (
          <span className="text-muted text-sm">Unknown</span>
        )}
      </div>

      <div>
        <FactLabel icon={<ShieldCheck size={10} />}>Status &amp; safety</FactLabel>
        <div className={`text-sm font-medium ${status.ok === false ? "text-bad" : ""}`}>{status.label}</div>
        <div className={`text-xs ${toneClass}`}>Safety: {safety.label}</div>
      </div>

      <div>
        <FactLabel icon={<Route size={10} />}>Operation</FactLabel>
        <div className="text-sm">{operation || <span className="text-muted">Unknown</span>}</div>
      </div>
    </>
  );
}

/** Owner / trucks / cargo from the slower records lookup (lives under "View more"). */
export function OwnerTrucksCargo({
  details,
  loading,
  error,
  onLoadDetails,
}: {
  details?: MotusDetails | null;
  loading: boolean;
  error: string | null;
  onLoadDetails: () => void;
}) {
  const officials = details?.officials ?? [];
  const vehicles = (details?.vehicles ?? []).filter((v) => (v.owned && v.owned !== "0") || v.leased);
  const cargo = details?.cargoClasses?.length ? details.cargoClasses.join(", ") : null;
  const hasDetails = !!details && (officials.length > 0 || vehicles.length > 0 || !!cargo);

  if (!hasDetails) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onLoadDetails}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg border border-accent/50 text-accent hover:bg-accent/10 transition-colors disabled:opacity-60"
        >
          {loading ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> Loading (up to 15s)…
            </span>
          ) : (
            "Load owner, trucks & cargo"
          )}
        </button>
        {error && <span className="text-xs text-muted">{error}</span>}
      </div>
    );
  }

  return (
    <div className="grid sm:grid-cols-3 gap-3 text-sm">
      <div>
        <FactLabel icon={<User size={10} />}>Owner / officials</FactLabel>
        {officials.length > 0 ? (
          officials.map((o, i) => (
            <div key={i}>
              <span className="font-medium">{o.name}</span>
              {o.title && <span className="text-muted"> · {o.title}</span>}
            </div>
          ))
        ) : (
          <span className="text-muted text-xs">None listed</span>
        )}
      </div>
      <div>
        <FactLabel icon={<Truck size={10} />}>Trucks</FactLabel>
        {vehicles.length > 0 ? (
          vehicles.map((v, i) => (
            <div key={i}>
              {v.type}: {v.owned || "0"} owned{v.leased ? `, ${v.leased} leased` : ""}
            </div>
          ))
        ) : (
          <span className="text-muted text-xs">No breakdown listed</span>
        )}
      </div>
      <div>
        <FactLabel icon={<Package size={10} />}>Cargo carried</FactLabel>
        {cargo ? <div>{cargo}</div> : <span className="text-muted text-xs">None listed</span>}
      </div>
    </div>
  );
}
