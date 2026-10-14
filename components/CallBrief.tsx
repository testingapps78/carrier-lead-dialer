"use client";

import { Loader2, Clock, ShieldCheck, Route, User, Package } from "lucide-react";
import type { Carrier, MotusDetails } from "@/lib/types";
import CopyButton from "@/components/CopyButton";
import { buildOpener, monthYear, operationLabel, registeredSince, safetyLabel, spokenSeconds, statusLabel } from "@/lib/callBrief";

export function FactLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted mb-1">
      {icon} {children}
    </div>
  );
}

/** One short line to say first, with a copy button. */
export function OpenerLine({ carrier, confirmedName }: { carrier: Carrier; confirmedName?: string | null }) {
  const opener = buildOpener(carrier, new Date(), confirmedName);
  return (
    <div className="flex items-center gap-2 bg-inset border border-border rounded-xl pl-3 pr-2 py-2">
      <span className="text-xs uppercase tracking-wide text-accent-ink shrink-0">Say</span>
      <p className="text-sm leading-snug flex-1 min-w-0">&ldquo;{opener}&rdquo;</p>
      <span className="text-xs text-muted shrink-0 hidden sm:inline">~{spokenSeconds(opener)}s</span>
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
  const toneClass = safety.tone === "good" ? "text-good" : safety.tone === "bad" ? "text-bad" : "text-ink";

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

type Details = MotusDetails | null | undefined;

function loadedParts(details: Details) {
  const officials = details?.officials ?? [];
  const vehicles = (details?.vehicles ?? []).filter((v) => (v.owned && v.owned !== "0") || v.leased);
  const cargo = details?.cargoClasses?.length ? details.cargoClasses.join(", ") : null;
  const has = !!details && (officials.length > 0 || vehicles.length > 0 || !!cargo);
  return { officials, vehicles, cargo, has };
}

/** Truck types (Fleet tile): the breakdown once loaded, otherwise the button for the slower records lookup. */
export function TruckTypes({
  details,
  loading,
  error,
  onLoadDetails,
}: {
  details?: Details;
  loading: boolean;
  error: string | null;
  onLoadDetails: () => void;
}) {
  const { vehicles, has } = loadedParts(details);

  if (!has) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onLoadDetails}
          disabled={loading}
          className="btn btn-secondary !min-h-[40px] !text-sm !font-medium text-accent-ink !border-accent/50 hover:!bg-accent/10 disabled:opacity-60"
        >
          {loading ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={14} className="animate-spin" /> Loading (up to 15s)…
            </span>
          ) : (
            "Load owner, trucks & cargo"
          )}
        </button>
        {error && <span className="text-xs text-muted">{error}</span>}
      </div>
    );
  }

  return vehicles.length > 0 ? (
    <ul className="space-y-0.5 text-sm">
      {vehicles.map((v, i) => (
        <li key={i} className="num">
          {v.type}: {v.owned || "0"} owned{v.leased ? `, ${v.leased} leased` : ""}
        </li>
      ))}
    </ul>
  ) : (
    <span className="text-muted text-xs">No breakdown listed</span>
  );
}

/** Owner / officials and cargo (inside "View more"), shown once the records lookup has been loaded. */
export function OwnerAndCargo({ details }: { details?: Details }) {
  const { officials, cargo, has } = loadedParts(details);
  if (!has) return null;
  return (
    <div className="grid sm:grid-cols-2 gap-4 text-sm">
      <div>
        <FactLabel icon={<User size={12} />}>Owner / officials</FactLabel>
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
        <FactLabel icon={<Package size={12} />}>Cargo carried</FactLabel>
        {cargo ? <div>{cargo}</div> : <span className="text-muted text-xs">None listed</span>}
      </div>
    </div>
  );
}
