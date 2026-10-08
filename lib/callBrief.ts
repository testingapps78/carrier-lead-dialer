import type { Carrier } from "@/lib/types";

// Words that signal a business name rather than a person's name. Used to decide
// whether "JAMES B WILSON" is a sole proprietor (a person) or "ABC TRUCKING LLC".
const BUSINESS_WORDS = new Set([
  "LLC", "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LP", "LLP", "PLLC",
  "TRUCKING", "TRANSPORT", "TRANSPORTATION", "TRANSPORTS", "LOGISTICS", "FREIGHT", "EXPRESS", "LINES",
  "LINE", "HAULING", "HAUL", "CARRIERS", "CARRIER", "DELIVERY", "TRANSIT", "ENTERPRISES", "ENTERPRISE",
  "SERVICES", "SERVICE", "GROUP", "HOLDINGS", "TRUCKS", "FARMS", "FARM", "BROTHERS", "BROS", "SONS",
  "AND", "&", "OF", "THE", "SYSTEMS", "SOLUTIONS", "MOVING", "TOWING", "AUTO", "CONSTRUCTION",
]);

const TITLE_WORDS = new Set([
  "OWNER", "PRESIDENT", "CEO", "VP", "PARTNER", "MANAGER", "DISPATCHER", "MR", "MRS", "MS", "DR", "SR", "JR",
]);

const KEEP_UPPER = new Set(["LLC", "INC", "LP", "LLP", "PLLC", "LTD", "USA", "DBA", "II", "III"]);
const KEEP_LOWER = new Set(["for", "of", "and", "the"]);

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+)/)
    .map((w, i) => {
      if (KEEP_UPPER.has(w.toUpperCase().replace(/[.,]/g, ""))) return w.toUpperCase();
      if (i > 0 && KEEP_LOWER.has(w)) return w;
      return w.replace(/(^|[-'])([a-z])/g, (_, p, c) => p + c.toUpperCase());
    })
    .join("");
}

function words(s: string): string[] {
  return s
    .replace(/[.,()/]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** A person-style name (no business words, 2-3 words) such as a sole proprietor. */
export function looksLikePerson(name: string | null | undefined): boolean {
  if (!name) return false;
  const w = words(name.toUpperCase());
  if (w.length < 2 || w.length > 4) return false;
  return !w.some((x) => BUSINESS_WORDS.has(x) || /\d/.test(x));
}

/** Best-guess first name to greet: company rep first, else the legal name if it's a person. */
export function guessFirstName(c: Carrier): string | null {
  for (const rep of [c.company_rep1, c.company_rep2]) {
    if (!rep) continue;
    const w = words(rep.toUpperCase()).filter((x) => !TITLE_WORDS.has(x));
    if (w.length >= 1 && /^[A-Z'-]{2,}$/.test(w[0]) && !BUSINESS_WORDS.has(w[0])) return titleCase(w[0]);
  }
  if (looksLikePerson(c.legal_name)) {
    const first = words(c.legal_name!.toUpperCase())[0];
    if (first && /^[A-Z'-]{2,}$/.test(first)) return titleCase(first);
  }
  return null;
}

export function registeredSince(addDate: string | null, now = new Date()) {
  if (!addDate) return null;
  const d = new Date(addDate + "T00:00:00");
  if (Number.isNaN(d.getTime()) || d > now) return null;
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months -= 1;
  months = Math.max(months, 0);
  const years = Math.floor(months / 12);
  const rem = months % 12;
  const long = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  let age: string;
  if (years === 0) age = months <= 1 ? "under 1 month" : `${months} months`;
  else if (rem === 0) age = `${years} yr${years > 1 ? "s" : ""}`;
  else age = `${years} yr${years > 1 ? "s" : ""} ${rem} mo`;
  return { years, months, age, year: d.getFullYear(), long };
}

export function monthYear(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function statusLabel(code: string | null): { label: string; ok: boolean | null } {
  const c = (code ?? "").trim().toUpperCase();
  if (c === "A" || c === "ACTIVE") return { label: "Active", ok: true };
  if (c === "I" || c === "INACTIVE") return { label: "Inactive", ok: false };
  return { label: c || "Unknown", ok: null };
}

export function safetyLabel(rating: string | null): { label: string; tone: "good" | "bad" | "neutral" } {
  const r = (rating ?? "").trim().toUpperCase();
  if (!r) return { label: "Not rated", tone: "neutral" };
  if (r === "S" || r.startsWith("SATISF")) return { label: "Satisfactory", tone: "good" };
  if (r === "C" || r.startsWith("COND")) return { label: "Conditional", tone: "bad" };
  if (r === "U" || r.startsWith("UNSAT")) return { label: "Unsatisfactory", tone: "bad" };
  return { label: titleCase(r), tone: "neutral" };
}

export function operationLabel(c: Carrier): string | null {
  const op = (c.carrier_operation ?? "").trim().toUpperCase();
  const scope =
    op === "A" ? "Interstate" : op === "B" ? "Intrastate (hazmat)" : op === "C" ? "Intrastate" : op ? titleCase(op) : null;
  const cls = c.classdef
    ? c.classdef
        .split(/[;,]/)
        .map((x) => titleCase(x.trim()))
        .filter(Boolean)
        .join(", ")
    : null;
  return [scope, cls].filter(Boolean).join(" · ") || null;
}

/** A tel: link that works on phones: normalizes US numbers to +1XXXXXXXXXX. */
export function telHref(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  return `tel:${digits || raw || ""}`;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Rough spoken length: about 2.5 words per second. */
export function spokenSeconds(text: string): number {
  return Math.max(1, Math.round(wordCount(text) / 2.5));
}

/**
 * Facts-only opener kept under ~6 seconds spoken (about 15 words): leads with
 * specifics, no permission-seeking, and stops so the carrier can answer.
 */
export function buildOpener(c: Carrier, now = new Date()): string {
  void now;
  const first = guessFirstName(c);
  const person = looksLikePerson(c.legal_name);
  const city = c.phy_city ? titleCase(c.phy_city) : null;
  const place = [city, c.phy_state].filter(Boolean).join(", ");
  const trucks = c.power_units && c.power_units > 0 ? c.power_units : null;
  const company = c.dba_name ? titleCase(c.dba_name) : c.legal_name ? titleCase(c.legal_name) : null;

  const greeting = first ? `Hi ${first},` : "Hi,";
  const fleet = trucks ? `${trucks} truck${trucks > 1 ? "s" : ""}` : null;

  if (person) {
    const what = fleet ? `your ${fleet}` : "your trucks";
    return `${greeting} calling about ${what}${place ? ` out of ${place}` : ""}.`;
  }
  const who = company ?? "your company";
  const bits = [fleet, place ? `in ${place}` : null].filter(Boolean).join(" ");
  return `${greeting} calling about ${who}${bits ? `, ${bits}` : ""}.`;
}
