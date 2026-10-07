// Idle-timeout settings and the rule for what counts as "activity".

export const DEFAULT_IDLE_MINUTES = 120;
export const MIN_IDLE_MINUTES = 15; // the smallest value an admin can pick
export const IDLE_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 240, label: "4 hours" },
  { minutes: 480, label: "8 hours" },
];

// Background polling that fires by itself just because a tab is open. These must
// never reset the idle clock, otherwise an idle-but-open tab would never time out.
const PASSIVE_GET_PATHS = ["/api/attendance", "/api/team/online", "/api/attendance/admin/live", "/api/admin/activity"];

export function isPassiveRequest(opts: { method: string; pathname: string; prefetch?: boolean }): boolean {
  const { method, pathname, prefetch } = opts;
  if (pathname.startsWith("/api/heartbeat")) return true;
  if (prefetch) return true; // Next.js link prefetch, not a person navigating
  if (method.toUpperCase() !== "GET") return false;
  return PASSIVE_GET_PATHS.includes(pathname);
}
