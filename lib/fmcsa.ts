// FMCSA "Company Census File" — Socrata dataset az4n-8mr2 on data.transportation.gov.
// Public, free, no API key required for reasonable use. Docs: https://dev.socrata.com/
const SOCRATA_BASE = "https://data.transportation.gov/resource/az4n-8mr2.json";

export type ScanMode = "dot" | "mc";

export interface CarrierFilters {
  state?: string; // 2-letter state code
  minPowerUnits?: number;
  maxPowerUnits?: number;
  docketOnly?: boolean; // only MC/FF/MX authority holders
}

export interface RawFmcsaRecord {
  dot_number?: string;
  docket1prefix?: string;
  docket1?: string;
  legal_name?: string;
  dba_name?: string;
  phone?: string;
  cell_phone?: string;
  email_address?: string;
  company_rep1?: string;
  company_rep2?: string;
  phy_street?: string;
  phy_city?: string;
  phy_state?: string;
  phy_zip?: string;
  phy_country?: string;
  power_units?: string;
  truck_units?: string;
  total_drivers?: string;
  status_code?: string;
  carrier_operation?: string;
  classdef?: string;
  hm_ind?: string;
  add_date?: string;
  mcs150_date?: string;
  safety_rating?: string;
}

export interface NormalizedCarrier {
  dot_number: number;
  docket_prefix: string | null;
  docket_number: number | null;
  legal_name: string | null;
  dba_name: string | null;
  phone: string | null;
  cell_phone: string | null;
  email: string | null;
  company_rep1: string | null;
  company_rep2: string | null;
  phy_street: string | null;
  phy_city: string | null;
  phy_state: string | null;
  phy_zip: string | null;
  phy_country: string | null;
  power_units: number | null;
  truck_units: number | null;
  total_drivers: number | null;
  status_code: string | null;
  carrier_operation: string | null;
  classdef: string | null;
  hm_ind: string | null;
  add_date: string | null; // ISO date
  mcs150_date: string | null; // ISO date
  safety_rating: string | null;
}

function toInt(v: string | undefined | null): number | null {
  if (v === undefined || v === null || v.trim() === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// FMCSA dates come as "YYYYMMDD" or "YYYYMMDD HHMM" — normalize to ISO (YYYY-MM-DD).
function toIsoDate(v: string | undefined | null): string | null {
  if (!v) return null;
  const digits = v.trim().split(" ")[0];
  if (!/^\d{8}$/.test(digits)) return null;
  const year = digits.slice(0, 4);
  const month = digits.slice(4, 6);
  const day = digits.slice(6, 8);
  if (year === "0000" || month === "00" || day === "00") return null;
  return `${year}-${month}-${day}`;
}

export function normalize(raw: RawFmcsaRecord): NormalizedCarrier | null {
  const dot = toInt(raw.dot_number);
  if (dot === null) return null;
  return {
    dot_number: dot,
    docket_prefix: raw.docket1prefix ?? null,
    docket_number: toInt(raw.docket1),
    legal_name: raw.legal_name ?? null,
    dba_name: raw.dba_name ?? null,
    phone: raw.phone ?? null,
    cell_phone: raw.cell_phone ?? null,
    email: raw.email_address ?? null,
    // Per FMCSA's official Census File data dictionary: "Name and title of
    // the [first/second] company representative." Comes from the same
    // response as everything else here — no extra request, no MOTUS.
    company_rep1: raw.company_rep1 ?? null,
    company_rep2: raw.company_rep2 ?? null,
    phy_street: raw.phy_street ?? null,
    phy_city: raw.phy_city ?? null,
    phy_state: raw.phy_state ?? null,
    phy_zip: raw.phy_zip ?? null,
    phy_country: raw.phy_country ?? null,
    power_units: toInt(raw.power_units),
    truck_units: toInt(raw.truck_units),
    total_drivers: toInt(raw.total_drivers),
    status_code: raw.status_code ?? null,
    carrier_operation: raw.carrier_operation ?? null,
    classdef: raw.classdef ?? null,
    hm_ind: raw.hm_ind ?? null,
    add_date: toIsoDate(raw.add_date),
    mcs150_date: toIsoDate(raw.mcs150_date),
    safety_rating: raw.safety_rating ?? null,
  };
}

function escapeSoql(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildWhereClause(
  after: number,
  mode: ScanMode,
  filters: CarrierFilters
): string {
  const clauses: string[] = [];

  if (mode === "dot") {
    clauses.push(`dot_number > ${after}`);
  } else {
    clauses.push(`docket1prefix = 'MC'`);
    clauses.push(`docket1::number > ${after}`);
  }

  clauses.push(`status_code = 'A'`);

  if (filters.state) {
    clauses.push(`phy_state = '${escapeSoql(filters.state.toUpperCase())}'`);
  }
  if (filters.docketOnly) {
    clauses.push(`docket1prefix IS NOT NULL`);
  }
  if (filters.minPowerUnits !== undefined) {
    clauses.push(`power_units::number >= ${filters.minPowerUnits}`);
  }
  if (filters.maxPowerUnits !== undefined) {
    clauses.push(`power_units::number <= ${filters.maxPowerUnits}`);
  }

  return clauses.join(" AND ");
}

// ---------------------------------------------------------------------------
// Socrata request helper — adds the app token, a per-request timeout, and
// automatic retry with backoff when data.transportation.gov answers with
// 429 (rate limited) or a transient 5xx. Anonymous requests from Vercel's
// shared IPs get throttled aggressively, so the app token matters.
// ---------------------------------------------------------------------------
export class FmcsaRateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds = 5) {
    super("FMCSA is busy right now (too many requests).");
    this.name = "FmcsaRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 8000;
const RETRY_BUDGET_MS = 15000; // never spend longer than this retrying
let warnedNoToken = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function socrataGet(url: string): Promise<Response> {
  const appToken = process.env.SOCRATA_APP_TOKEN;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (appToken) {
    headers["X-App-Token"] = appToken;
  } else if (!warnedNoToken) {
    warnedNoToken = true;
    console.warn(
      "SOCRATA_APP_TOKEN is not set — FMCSA requests are anonymous and will be rate limited (429) often."
    );
  }

  const startedAt = Date.now();
  let lastStatus = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      // Network error or timeout — treat like a transient failure and retry.
    }

    if (res && res.ok) return res;
    if (res) {
      lastStatus = res.status;
      // Non-retryable (bad query, not found, etc.) — hand it back to the caller.
      if (res.status !== 429 && res.status < 500) return res;
    }

    if (attempt === MAX_RETRIES) break;

    const retryAfterHeader = res ? Number(res.headers.get("retry-after")) : NaN;
    const backoff = 500 * 2 ** attempt + Math.floor(Math.random() * 250); // ~0.5s, 1s, 2s
    const delay = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? Math.min(retryAfterHeader * 1000, 3000)
      : backoff;
    if (Date.now() - startedAt + delay > RETRY_BUDGET_MS) break;
    await sleep(delay);
  }

  if (lastStatus === 429) throw new FmcsaRateLimitError(5);
  throw new Error(
    lastStatus
      ? `FMCSA request failed (${lastStatus}) after retries.`
      : "FMCSA did not respond in time. Try again in a moment."
  );
}

// Fetches a batch (ordered ascending) from the live FMCSA dataset.
export async function fetchFmcsaBatch(
  after: number,
  mode: ScanMode,
  filters: CarrierFilters,
  limit = 50
): Promise<NormalizedCarrier[]> {
  const where = buildWhereClause(after, mode, filters);
  const order = mode === "dot" ? "dot_number ASC" : "docket1::number ASC";
  const params = new URLSearchParams({
    $where: where,
    $order: order,
    $limit: String(limit),
  });

  const res = await socrataGet(`${SOCRATA_BASE}?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`FMCSA request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const rows: RawFmcsaRecord[] = await res.json();
  return rows.map(normalize).filter((r): r is NormalizedCarrier => r !== null);
}

// "Carrier - All With History" (resource 6eyk-hxee) — a separate, structured
// FMCSA dataset (not the Census File) carrying authority-type status and
// insurance amounts on file. Its dot_number is stored zero-padded as text,
// so we cast rather than string-match.
const AUTHORITY_BASE = "https://data.transportation.gov/resource/6eyk-hxee.json";

export interface AuthorityInsurance {
  commonAuthority: string | null;
  contractAuthority: string | null;
  brokerAuthority: string | null;
  bipdInsuranceOnFile: string | null;
  cargoInsuranceOnFile: string | null;
  bondInsuranceOnFile: string | null;
}

export async function fetchAuthorityInsurance(dotNumber: number): Promise<AuthorityInsurance | null> {
  const params = new URLSearchParams({
    $where: `dot_number::number = ${dotNumber}`,
    $limit: "1",
  });
  let res: Response;
  try {
    res = await socrataGet(`${AUTHORITY_BASE}?${params.toString()}`);
  } catch {
    return null; // best-effort panel — never block the card if FMCSA is busy
  }
  if (!res.ok) return null;
  const rows: any[] = await res.json();
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    commonAuthority: r.common_stat ?? null,
    contractAuthority: r.contract_stat ?? null,
    brokerAuthority: r.broker_stat ?? null,
    bipdInsuranceOnFile: r.bipd_file ?? null,
    cargoInsuranceOnFile: r.cargo_file ?? null,
    bondInsuranceOnFile: r.bond_file ?? null,
  };
}
