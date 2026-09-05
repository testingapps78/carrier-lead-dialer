export interface Lead {
  dot_number: number;
  status: string;
  priority: boolean;
  notes: string | null;
  last_called_at: string | null;
  reminder_date?: string | null;
  reminder_note?: string | null;
  reminder_done?: boolean;
}

export interface MotusOfficial {
  name: string;
  title: string;
  phone: string;
  email: string;
}

export interface MotusDetails {
  dunsBradstreet: string | null;
  formOfBusiness: string | null;
  stateIncorporated: string | null;
  businessEmail: string | null;
  officials: MotusOfficial[];
  operationTypes: string[];
  cargoClasses: string[];
  vehicles: { type: string; owned: string; leased: string }[];
  fetchedAt: string;
  authority?: {
    commonAuthority: string | null;
    contractAuthority: string | null;
    brokerAuthority: string | null;
    bipdInsuranceOnFile: string | null;
    cargoInsuranceOnFile: string | null;
    bondInsuranceOnFile: string | null;
  } | null;
}

export interface Carrier {
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
  add_date: string | null;
  mcs150_date: string | null;
  safety_rating: string | null;
  motus_details?: MotusDetails | null;
  leads?: Lead | Lead[] | null;
}

export interface CallStatus {
  id: string;
  value: string;
  label: string;
  color: "slate" | "blue" | "green" | "red" | "amber" | "violet";
  sort_order: number;
  is_default: boolean;
}

export interface Shift {
  id: string;
  user_id: string;
  check_in: string;
  check_out: string | null;
  carriers_viewed: number;
  carriers_logged: number;
  mode?: string | null;
  state?: string | null;
  min_power_units?: number | null;
  max_power_units?: number | null;
  docket_only?: boolean | null;
  start_number?: number | null;
  end_number?: number | null;
  user_name?: string;
}

export interface TeamPost {
  id: string;
  author_id: string;
  body: string;
  dot_number: number | null;
  is_broadcast: boolean;
  created_at: string;
  profiles?: { full_name: string | null } | null;
  carriers?: { legal_name: string | null } | null;
}

export function getLead(carrier: Carrier | null | undefined): Lead | null {
  if (!carrier?.leads) return null;
  return Array.isArray(carrier.leads) ? carrier.leads[0] ?? null : carrier.leads;
}

export function formatPhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

// Tailwind classes for each status color. Kept centralized so a status
// created in the admin panel with e.g. color "green" renders identically
// everywhere it appears.
export const STATUS_COLOR_CLASSES: Record<string, string> = {
  slate: "bg-slate/20 text-muted border-slate/40",
  blue: "bg-info/15 text-info border-info/40",
  green: "bg-good/15 text-good border-good/40",
  red: "bg-bad/15 text-bad border-bad/40",
  amber: "bg-accent/15 text-accent border-accent/40",
  violet: "bg-violet-400/15 text-violet-300 border-violet-400/40",
};

export function statusClass(color: string | undefined): string {
  return STATUS_COLOR_CLASSES[color ?? "slate"] ?? STATUS_COLOR_CLASSES.slate;
}

export function formatDuration(startIso: string, endIso: string | null): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const totalMinutes = Math.max(0, Math.round((end - start) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isReminderDue(dateIso: string | null | undefined): boolean {
  if (!dateIso) return false;
  return dateIso <= todayIso();
}
