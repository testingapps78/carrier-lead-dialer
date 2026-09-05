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

// Fetches a batch (ordered ascending) from the live FMCSA dataset.
export async function fetchFmcsaBatch(
  after: number,
  mode: ScanMode,
  filters: CarrierFilters,
  limit = 200
): Promise<NormalizedCarrier[]> {
  const where = buildWhereClause(after, mode, filters);
  const order = mode === "dot" ? "dot_number ASC" : "docket1::number ASC";
  const params = new URLSearchParams({
    $where: where,
    $order: order,
    $limit: String(limit),
  });

  const appToken = process.env.SOCRATA_APP_TOKEN;
  const headers: Record<string, string> = {};
  if (appToken) headers["X-App-Token"] = appToken;

  const res = await fetch(`${SOCRATA_BASE}?${params.toString()}`, { headers });
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
  const appToken = process.env.SOCRATA_APP_TOKEN;
  const headers: Record<string, string> = {};
  if (appToken) headers["X-App-Token"] = appToken;

  const res = await fetch(`${AUTHORITY_BASE}?${params.toString()}`, { headers });
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
