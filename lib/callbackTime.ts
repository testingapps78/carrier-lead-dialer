// Timezone-aware callback times. A callback is stored as an exact instant (UTC) plus the IANA
// timezone it was scheduled in, so it keeps meaning the same moment across daylight-saving changes.
// No dependencies: uses the platform's Intl.

export const US_TIMEZONES: { id: string; label: string }[] = [
  { id: "America/New_York", label: "Eastern (New York)" },
  { id: "America/Chicago", label: "Central (Chicago)" },
  { id: "America/Denver", label: "Mountain (Denver)" },
  { id: "America/Phoenix", label: "Mountain, no DST (Arizona)" },
  { id: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { id: "America/Anchorage", label: "Alaska" },
  { id: "Pacific/Honolulu", label: "Hawaii" },
];

export function isValidTimeZone(tz: string): boolean {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface Wall {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

function wallClock(utcMs: number, tz: string): Wall {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute") };
}

function sameWall(a: Wall, b: Wall): boolean {
  return a.y === b.y && a.mo === b.mo && a.d === b.d && a.h === b.h && a.mi === b.mi;
}

/** Offset of `tz` from UTC at an instant, in minutes (e.g. -240 for EDT). */
export function offsetMinutes(utcMs: number, tz: string): number {
  const w = wallClock(utcMs, tz);
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
  return Math.round((asUtc - Math.floor(utcMs / 60000) * 60000) / 60000);
}

export type Resolution =
  | { ok: true; utc: string; kind: "exact" | "gap_shifted" | "ambiguous_first"; note: string | null }
  | { ok: false; error: string };

/**
 * Turns "2026-11-01 01:30 in America/New_York" into an exact instant.
 *  - Normal times: exact.
 *  - A time that does not exist (clocks spring forward): moved forward to the same minute after the gap.
 *  - A time that happens twice (clocks fall back): the FIRST occurrence is used and the user is told.
 */
export function resolveLocalCallback(localDate: string, localTime: string, tz: string): Resolution {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate ?? "");
  const tm = /^(\d{2}):(\d{2})$/.exec(localTime ?? "");
  if (!dm || !tm) return { ok: false, error: "Use a date like 2026-11-01 and a time like 13:30." };
  if (!isValidTimeZone(tz)) return { ok: false, error: "That timezone isn't recognized." };

  const [y, mo, d, h, mi] = [Number(dm[1]), Number(dm[2]), Number(dm[3]), Number(tm[1]), Number(tm[2])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return { ok: false, error: "That date or time isn't valid." };
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return { ok: false, error: "That date doesn't exist." };

  const target: Wall = { y, mo, d, h, mi };
  const guess = Date.UTC(y, mo - 1, d, h, mi);

  // Offsets in force around that moment (covers both sides of any transition).
  const offsets = new Set<number>();
  for (const shiftH of [-26, -12, 0, 12, 26]) offsets.add(offsetMinutes(guess + shiftH * 3600000, tz));

  const matches = new Set<number>();
  for (const off of offsets) {
    const t = guess - off * 60000;
    if (sameWall(wallClock(t, tz), target)) matches.add(t);
  }
  const sorted = Array.from(matches).sort((a, b) => a - b);

  if (sorted.length === 1) return { ok: true, utc: new Date(sorted[0]).toISOString(), kind: "exact", note: null };

  if (sorted.length >= 2) {
    return {
      ok: true,
      utc: new Date(sorted[0]).toISOString(),
      kind: "ambiguous_first",
      note: "That clock time happens twice when clocks fall back. The first one was used.",
    };
  }

  // Nonexistent: use the offset from before the gap, which lands on the same minute after it.
  const before = offsetMinutes(guess - 26 * 3600000, tz);
  const t = guess - before * 60000;
  return {
    ok: true,
    utc: new Date(t).toISOString(),
    kind: "gap_shifted",
    note: "That clock time doesn't exist when clocks spring forward, so it was moved ahead by the length of the gap.",
  };
}

export function formatCallbackDisplay(utcIso: string, tz: string): string {
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime()) || !isValidTimeZone(tz)) return utcIso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

export function localDateInTimeZone(tz: string, now = new Date()): string {
  const w = wallClock(now.getTime(), isValidTimeZone(tz) ? tz : "UTC");
  return `${w.y}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

export function browserTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? tz : "UTC";
  } catch {
    return "UTC";
  }
}
