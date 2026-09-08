"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Loader2, ShieldCheck, Building2, Mail } from "lucide-react";
import { MotusDetails, formatPhone } from "@/lib/types";
import CopyButton from "@/components/CopyButton";

export default function EnrichmentPanel({
  dotNumber,
  initial,
  endpoint,
}: {
  dotNumber: number;
  initial?: MotusDetails | null;
  endpoint?: string; // defaults to the authenticated endpoint; trial page passes its own
}) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<MotusDetails | null | undefined>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetails(initial);
    setOpen(false);
  }, [dotNumber, initial]);

  async function handleOpen() {
    setOpen((o) => !o);
    if (details !== undefined || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint || `/api/carriers/${dotNumber}/enrich`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDetails(data.details ?? null);
    } catch (e: any) {
      setError(e?.message || "Couldn't load additional details.");
    } finally {
      setLoading(false);
    }
  }

  const auth = details?.authority;

  return (
    <div className="mt-5">
      <button onClick={handleOpen} className="flex items-center gap-1.5 text-xs text-muted hover:text-ink transition-colors">
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        {open ? "Hide" : "Show"} owner, authority & more detail
      </button>

      {open && (
        <div className="mt-3 bg-surface2 border border-border rounded-xl p-4 animate-fade-in">
          {loading && (
            <div className="flex items-center gap-2 text-muted text-sm py-2">
              <Loader2 size={14} className="animate-spin" /> Checking additional public records — can take up to 15s…
            </div>
          )}
          {error && <div className="text-bad text-sm">{error}</div>}
          {!loading && details === null && (
            <div className="text-muted text-sm">No additional public record found for this carrier yet.</div>
          )}
          {details && (
            <div className="space-y-4">
              {auth && (auth.commonAuthority || auth.contractAuthority || auth.brokerAuthority) && (
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted mb-2 flex items-center gap-1">
                    <ShieldCheck size={12} /> Authority & insurance on file
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-muted">Common</div>
                      {auth.commonAuthority || "—"}
                    </div>
                    <div>
                      <div className="text-muted">Contract</div>
                      {auth.contractAuthority || "—"}
                    </div>
                    <div>
                      <div className="text-muted">Broker</div>
                      {auth.brokerAuthority || "—"}
                    </div>
                    <div>
                      <div className="text-muted">BI/PD</div>
                      {auth.bipdInsuranceOnFile || "—"}
                    </div>
                    <div>
                      <div className="text-muted">Cargo</div>
                      {auth.cargoInsuranceOnFile || "—"}
                    </div>
                    <div>
                      <div className="text-muted">Bond</div>
                      {auth.bondInsuranceOnFile || "—"}
                    </div>
                  </div>
                </div>
              )}
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
