import { formatCallbackDisplay, localDateInTimeZone } from "./callbackTime.ts";

export interface CallbackFields {
  status?: string | null;
  callback_at?: string | null;
  callback_timezone?: string | null;
  reminder_date?: string | null;
  reminder_done?: boolean | null;
  reminder_note?: string | null;
}

export type CallbackBucket = "overdue" | "today" | "upcoming" | "completed" | null;

/**
 * Same rules as the database's lead_callback_bucket(): Do Not Call leads have no actionable callback;
 * a timed callback is overdue once its instant has passed; a date-only reminder is overdue only after its date.
 */
export function callbackBucket(l: CallbackFields, viewerTz: string, now = new Date()): CallbackBucket {
  if (l.status === "do_not_call") return null;
  if (!l.callback_at && !l.reminder_date) return null;
  if (l.reminder_done) return "completed";
  const today = localDateInTimeZone(viewerTz, now);
  if (l.callback_at) {
    const at = new Date(l.callback_at);
    if (at.getTime() < now.getTime()) return "overdue";
    return localDateInTimeZone(viewerTz, at) === today ? "today" : "upcoming";
  }
  if ((l.reminder_date as string) < today) return "overdue";
  return l.reminder_date === today ? "today" : "upcoming";
}

/** "Tue, Nov 3, 9:00 AM EST" for timed callbacks, "Fri, Nov 6 (date only)" for older date-only reminders. */
export function describeCallback(l: CallbackFields): string | null {
  if (l.callback_at && l.callback_timezone) return formatCallbackDisplay(l.callback_at, l.callback_timezone);
  if (l.reminder_date) {
    const d = new Date(l.reminder_date + "T12:00:00Z");
    return `${new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(d)} (date only)`;
  }
  return null;
}

export const BUCKET_LABEL: Record<Exclude<CallbackBucket, null>, string> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Upcoming",
  completed: "Completed",
};
