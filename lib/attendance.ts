// lib/attendance.ts
//
// Core attendance logic for Carrier Dialer.
// Mirrors the pattern used in lib/fmcsa.ts: pure functions, no framework
// dependencies, calculations done in TypeScript (not SQL) so shift/overtime
// rules can be tweaked without a migration.
//
// Design principles this file follows:
// 1. Raw events (attendance_events) are NEVER modified after insert.
// 2. shift_date is inherited from the open shift, not derived from
//    "today's date" — this is what makes overnight shifts (5pm -> 3am)
//    collapse into a single shift instead of splitting across two days.
// 3. All summary numbers (gross/net/late/overtime) are computed on read
//    from raw events + the assigned shift config, never stored.

export type EventType = "CHECK_IN" | "BREAK_OUT" | "BREAK_IN" | "CHECK_OUT";
export type EventSource = "WEB" | "ADMIN";

export interface AttendanceEvent {
  id: string;
  organization_id: string;
  user_id: string;
  event_type: EventType;
  event_timestamp: string; // ISO timestamptz
  shift_date: string; // YYYY-MM-DD
  source: EventSource;
  is_duplicate: boolean;
  notes: string | null;
  created_by: string;
  created_at: string;
}

export interface ShiftType {
  id: string;
  organization_id: string;
  name: string;
  start_time: string; // "HH:MM:SS"
  end_time: string; // "HH:MM:SS"
  is_overnight: boolean;
  grace_minutes: number;
  expected_break_minutes: number;
  max_break_minutes: number | null;
  overtime_enabled: boolean;
  overtime_threshold_minutes: number;
  pre_shift_overtime_allowed: boolean;
  post_shift_overtime_allowed: boolean;
  working_days: number[]; // 0 = Sunday ... 6 = Saturday
  is_default: boolean;
  is_active: boolean;
}

export type LiveStatus =
  | "NOT_CHECKED_IN"
  | "WORKING"
  | "ON_BREAK"
  | "CHECKED_OUT"
  | "MISSING_CHECKOUT";

export interface NextActionResult {
  status: LiveStatus;
  /** Actions the employee is currently allowed to take. Empty after CHECK_OUT. */
  allowedActions: EventType[];
  /** shift_date to stamp on the NEXT event. Null means "start a new shift today". */
  shiftDate: string | null;
}

const DUPLICATE_WINDOW_SECONDS = 60;
// If a shift has been open this long with no checkout, flag it instead of
// silently treating it as still "working".
const STALE_SHIFT_HOURS = 20;

/**
 * Returns today's date (YYYY-MM-DD) in a given IANA timezone.
 * Pass your org's timezone in; defaults to UTC if omitted.
 */
export function todayInTimezone(timeZone = "UTC", now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/**
 * Given the most recent event for a user (or null if they have none / their
 * last shift is closed), determine what they're allowed to do next and
 * which shift_date the next event belongs to.
 *
 * This is the ENTIRE overnight-shift trick: we never compute shift_date from
 * "what day is it now" for anything except a fresh CHECK_IN. Every
 * subsequent event in an open shift just inherits shift_date from the
 * CHECK_IN that opened it.
 */
export function getNextAction(
  lastEvent: AttendanceEvent | null,
  now: Date = new Date(),
  timeZone = "UTC"
): NextActionResult {
  if (!lastEvent || lastEvent.event_type === "CHECK_OUT") {
    return { status: "NOT_CHECKED_IN", allowedActions: ["CHECK_IN"], shiftDate: null };
  }

  const hoursSinceLast =
    (now.getTime() - new Date(lastEvent.event_timestamp).getTime()) / 36e5;
  const isStale = hoursSinceLast > STALE_SHIFT_HOURS;

  if (lastEvent.event_type === "CHECK_IN" || lastEvent.event_type === "BREAK_IN") {
    return {
      status: isStale ? "MISSING_CHECKOUT" : "WORKING",
      // Even when stale we still technically allow check-out / break-out;
      // the UI should just show a "needs review" banner alongside it.
      allowedActions: ["BREAK_OUT", "CHECK_OUT"],
      shiftDate: lastEvent.shift_date,
    };
  }

  // lastEvent.event_type === "BREAK_OUT"
  return {
    status: isStale ? "MISSING_CHECKOUT" : "ON_BREAK",
    // CHECK_OUT is intentionally excluded here per spec — an employee
    // shouldn't be able to check out while mid-break through the normal
    // flow. Admin force-actions bypass this via the ADMIN source path.
    allowedActions: ["BREAK_IN"],
    shiftDate: lastEvent.shift_date,
  };
}

/**
 * Decide the shift_date to stamp on a brand new event before insert.
 * Call this in your API route right before writing to attendance_events.
 */
export function resolveShiftDateForNewEvent(
  eventType: EventType,
  lastEvent: AttendanceEvent | null,
  now: Date = new Date(),
  timeZone = "UTC"
): string {
  if (eventType === "CHECK_IN") {
    // Starting a fresh shift always anchors to today's calendar date.
    return todayInTimezone(timeZone, now);
  }
  // Every other event type must belong to an open shift; inherit its date.
  if (!lastEvent || lastEvent.event_type === "CHECK_OUT") {
    throw new Error(
      `Cannot record ${eventType}: no open shift found. Employee must CHECK_IN first.`
    );
  }
  return lastEvent.shift_date;
}

/**
 * Server-side duplicate-scan guard. Doesn't block the insert — per spec,
 * raw events are never dropped — just flags it so the UI/admin can see it
 * was a double-press rather than a real second action.
 */
export function isLikelyDuplicate(
  lastEvent: AttendanceEvent | null,
  requestedType: EventType,
  now: Date = new Date(),
  windowSeconds: number = DUPLICATE_WINDOW_SECONDS
): boolean {
  if (!lastEvent) return false;
  const secondsSinceLast =
    (now.getTime() - new Date(lastEvent.event_timestamp).getTime()) / 1000;
  return lastEvent.event_type === requestedType && secondsSinceLast < windowSeconds;
}

export interface BreakSession {
  start: string;
  end: string | null; // null = incomplete (BREAK_OUT with no matching BREAK_IN)
  minutes: number | null;
}

export interface ShiftSummary {
  shiftDate: string;
  checkIn: string | null;
  checkOut: string | null;
  breakSessions: BreakSession[];
  totalBreakMinutes: number;
  hasIncompleteBreak: boolean;
  grossMinutes: number | null;
  netMinutes: number | null;
  lateMinutes: number;
  overtimeMinutes: number;
  status: LiveStatus;
}

/**
 * Compute the full summary for one user's one shift_date from raw events.
 * `events` must be all events for that user + shift_date, sorted ascending
 * by event_timestamp. `now` is used to compute live duration for a shift
 * still in progress.
 */
export function computeShiftSummary(
  events: AttendanceEvent[],
  shiftType: ShiftType | null,
  now: Date = new Date(),
  timeZone = "UTC"
): ShiftSummary {
  const sorted = [...events].sort(
    (a, b) => new Date(a.event_timestamp).getTime() - new Date(b.event_timestamp).getTime()
  );

  const checkInEvent = sorted.find((e) => e.event_type === "CHECK_IN") ?? null;
  const checkOutEvent = [...sorted].reverse().find((e) => e.event_type === "CHECK_OUT") ?? null;

  // Pair up BREAK_OUT -> BREAK_IN sequentially.
  const breakSessions: BreakSession[] = [];
  let openBreakStart: string | null = null;
  for (const e of sorted) {
    if (e.event_type === "BREAK_OUT") {
      openBreakStart = e.event_timestamp;
    } else if (e.event_type === "BREAK_IN" && openBreakStart) {
      const minutes = Math.round(
        (new Date(e.event_timestamp).getTime() - new Date(openBreakStart).getTime()) / 60000
      );
      breakSessions.push({ start: openBreakStart, end: e.event_timestamp, minutes });
      openBreakStart = null;
    }
  }
  const hasIncompleteBreak = openBreakStart !== null;
  if (openBreakStart) {
    breakSessions.push({ start: openBreakStart, end: null, minutes: null });
  }

  const totalBreakMinutes = breakSessions.reduce((sum, b) => sum + (b.minutes ?? 0), 0);

  const lastEvent = sorted[sorted.length - 1] ?? null;
  const { status } = getNextAction(lastEvent, now, timeZone);

  let grossMinutes: number | null = null;
  let netMinutes: number | null = null;
  if (checkInEvent) {
    const endPoint = checkOutEvent ? new Date(checkOutEvent.event_timestamp) : now;
    grossMinutes = Math.round(
      (endPoint.getTime() - new Date(checkInEvent.event_timestamp).getTime()) / 60000
    );
    netMinutes = grossMinutes - totalBreakMinutes;
  }

  let lateMinutes = 0;
  let overtimeMinutes = 0;

  if (checkInEvent && shiftType) {
    const shiftDate = checkInEvent.shift_date;
    const scheduledStart = combineDateAndTime(shiftDate, shiftType.start_time, timeZone);
    const graceMs = shiftType.grace_minutes * 60000;
    const actualInMs = new Date(checkInEvent.event_timestamp).getTime();
    lateMinutes = Math.max(0, Math.round((actualInMs - scheduledStart.getTime() - graceMs) / 60000));

    if (shiftType.overtime_enabled) {
      // Overnight shifts end on the day AFTER shift_date.
      const scheduledEnd = combineDateAndTime(
        shiftType.is_overnight ? addDays(shiftDate, 1) : shiftDate,
        shiftType.end_time,
        timeZone
      );
      const endPoint = checkOutEvent ? new Date(checkOutEvent.event_timestamp) : now;
      const rawOtMinutes = Math.round((endPoint.getTime() - scheduledEnd.getTime()) / 60000);
      if (shiftType.post_shift_overtime_allowed && rawOtMinutes >= shiftType.overtime_threshold_minutes) {
        overtimeMinutes = rawOtMinutes;
      }
      if (shiftType.pre_shift_overtime_allowed && checkInEvent) {
        const preMinutes = Math.round((scheduledStart.getTime() - actualInMs) / 60000);
        if (preMinutes >= shiftType.overtime_threshold_minutes) {
          overtimeMinutes += preMinutes;
        }
      }
    }
  }

  return {
    shiftDate: checkInEvent?.shift_date ?? todayInTimezone(timeZone, now),
    checkIn: checkInEvent?.event_timestamp ?? null,
    checkOut: checkOutEvent?.event_timestamp ?? null,
    breakSessions,
    totalBreakMinutes,
    hasIncompleteBreak,
    grossMinutes,
    netMinutes,
    lateMinutes,
    overtimeMinutes,
    status,
  };
}

/** Combine a YYYY-MM-DD date with an HH:MM:SS time in a given timezone. */
function combineDateAndTime(dateStr: string, timeStr: string, timeZone: string): Date {
  // Approximation: treats the wall-clock time as if timeZone offset is fixed
  // for that date. Fine for a single-office deployment; revisit if you ever
  // span multiple timezones in one org.
  const [h, m, s] = timeStr.split(":").map(Number);
  const base = new Date(`${dateStr}T00:00:00`);
  base.setHours(h, m, s || 0, 0);
  return base;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
