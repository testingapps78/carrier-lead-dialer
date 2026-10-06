"use client";

import { Loader2, Clock, ShieldCheck, Route, User, Package, Truck } from "lucide-react";
import type { Carrier, MotusDetails } from "@/lib/types";
import CopyButton from "@/components/CopyButton";
import { buildOpener, monthYear, operationLabel, registeredSince, safetyLabel, statusLabel } from "@/lib/callBrief";

function Label({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted mb-0.5">
      {icon} {children}
    </div>
  );
}

export default function CallBrief({
  carrier,
  details,
  loading,
  error,
  onLoadDetails,
}: {
  carrier: Carrier;
  details?: MotusDetails | null; // owner/truck/cargo details, if already loaded or cached
  loading: boolean;
  error: string | null;
  onLoadDetails: () => void;
}) {
  const opener = buildOpener(carrier);
  const reg = registeredSince(carrier.add_date);
  const status = statusLabel(carrier.status_code);
  const safety = safetyLabel(carrier.safety_rating);
  const operation = operationLabel(carrier);
  const mcs150 = monthYear(carrier.mcs150_date);

  const reps = [carrier.company_rep1, carrier.company_rep2].filter(Boolean) as string[];
  const officials = details?.officials ?? [];
  const vehicles = (details?.vehicles ?? []).filter((v) => (v.owned && v.owned !== "0") || v.leased);
  const cargo = details?.cargoClasses?.length ? details.cargoClasses.join(", ") : null;
  const hasDetails = !!details && (officials.length > 0 || vehicles.length > 0 || !!cargo);

  const toneClass = safety.tone === "good" ? "text-emerald-400" : safety.tone === "bad" ? "text-bad" : "text-ink";

  return (
    <div className="mt-5 bg-surface2 border border-accent/30 rounded-xl p-4">
      <div className="text-[11px] uppercase tracking-wide text-accent mb-2">Before you call</div>

      <div className="flex items-start gap-2">
        <p className="text-sm leading-relaxed flex-1">&ldquo;{opener}&rdquo;</p>
        <CopyButton value={opener} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-4 text-sm">
        <div>
          <Label icon={<Clock size={11} />}>Registered</Label>
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
          <Label icon={<ShieldCheck size={11} />}>Status &amp; safety</Label>
          <div className={`font-medium ${status.ok === false ? "text-bad" : ""}`}>{status.label}</div>
          <div className={`text-xs ${toneClass}`}>Safety: {safety.label}</div>
        </div>

        <div>
          <Label icon={<Route size={11} />}>Operation</Label>
          <div>{operation || <span className="text-muted">Unknown</span>}</div>
        </div>

        <div>
          <Label icon={<User size={11} />}>Contact on file</Label>
          {reps.length > 0 ? (
            reps.map((r, i) => <div key={i}>{r}</div>)
          ) : (
            <span className="text-muted text-xs">No contact name in FMCSA census</span>
          )}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-border/60">
        {hasDetails ? (
          <div className="space-y-3 text-sm">
            <div>
              <Label icon={<User size={11} />}>Owner / officials</Label>
              {officials.length > 0 ? (
                <div className="space-y-0.5">
                  {officials.map((o, i) => (
                    <div key={i}>
                      <span className="font-medium">{o.name}</span>
                      {o.title && <span className="text-muted"> · {o.title}</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-muted text-xs">None listed</span>
              )}
            </div>
            <div>
              <Label icon={<Truck size={11} />}>Trucks</Label>
              {vehicles.length > 0 ? (
                <div className="space-y-0.5">
                  {vehicles.map((v, i) => (
                    <div key={i}>
                      {v.type}: {v.owned || "0"} owned{v.leased ? `, ${v.leased} leased` : ""}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-muted text-xs">No truck breakdown listed</span>
              )}
            </div>
            <div>
              <Label icon={<Package size={11} />}>Cargo carried</Label>
              {cargo ? <div>{cargo}</div> : <span className="text-muted text-xs">None listed</span>}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onLoadDetails}
              disabled={loading}
              className="text-sm px-3 py-2 rounded-lg border border-accent/50 text-accent hover:bg-accent/10 transition-colors disabled:opacity-60 min-h-[40px]"
            >
              {loading ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 size={13} className="animate-spin" /> Loading (up to 15s)…
                </span>
              ) : (
                "Load owner, trucks & cargo"
              )}
            </button>
            {error && <span className="text-xs text-muted">{error}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
