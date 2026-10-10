"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bell, Check, Clock, Loader2, PhoneCall, User } from "lucide-react";
import type { LeadNotesSaver } from "@/lib/leadSaver";
import { api, friendlyError, newKey, post } from "@/lib/leadClient";
import { telHref } from "@/lib/callBrief";
import { BUCKET_LABEL, callbackBucket, describeCallback } from "@/lib/callbacks";
import { US_TIMEZONES, browserTimeZone, formatCallbackDisplay, localDateInTimeZone, resolveLocalCallback } from "@/lib/callbackTime";

type OnLead = (dot: number, lead: any) => void;

const ROLE_LABEL: Record<string, string> = { owner: "Owner", dispatcher: "Dispatcher", manager: "Manager", other: "Other" };
const inputCls = "bg-surface border border-border rounded-lg px-2.5 py-1.5 text-sm text-ink focus:border-accent outline-none";

// ---------------------------------------------------------------------------
// Notes: per-lead draft, accurate save state, explicit Save, Retry
// ---------------------------------------------------------------------------
export function NotesEditor({
  dot,
  serverNotes,
  saver,
  rows = 3,
  placeholder = "Notes — call back after 3pm, spoke with dispatcher, etc.",
}: {
  dot: number;
  serverNotes: string | null | undefined;
  saver: LeadNotesSaver;
  rows?: number;
  placeholder?: string;
}) {
  const [recovered, setRecovered] = useState(false);

  // Unsaved text left behind by an earlier visit (same signed-in user only, expires after 7 days).
  useEffect(() => {
    setRecovered(false);
    if (saver.getDraft(dot) === null) {
      const text = saver.recover(dot, serverNotes ?? null);
      if (text !== null) {
        saver.setNotes(dot, text);
        setRecovered(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dot, saver]);

  const value = saver.getDraft(dot) ?? serverNotes ?? "";
  const { state, error } = saver.getState(dot);

  return (
    <div>
      <textarea
        value={value}
        maxLength={5000}
        onChange={(e) => saver.setNotes(dot, e.target.value)}
        onBlur={() => void saver.flush(dot)}
        placeholder={placeholder}
        rows={rows}
        className="w-full bg-surface2 border border-border rounded-xl px-3 py-2 text-sm text-ink focus:border-accent outline-none resize-none"
      />
      <div className="flex items-center gap-2 mt-1 min-h-[24px] text-xs">
        {state === "unsaved" && <span className="text-accent">Unsaved</span>}
        {state === "saving" && (
          <span className="flex items-center gap-1 text-muted">
            <Loader2 size={11} className="animate-spin" /> Saving…
          </span>
        )}
        {state === "saved" && (
          <span className="flex items-center gap-1 text-good">
            <Check size={12} /> Saved
          </span>
        )}
        {state === "failed" && (
          <span className="flex items-center gap-1.5 text-bad">
            <AlertTriangle size={12} /> Save failed{error ? `: ${error}` : ""}
            <button type="button" onClick={() => void saver.retry(dot)} className="underline font-medium">
              Retry
            </button>
          </span>
        )}
        {recovered && <span className="text-muted">Recovered unsaved notes from earlier.</span>}
        <button
          type="button"
          onClick={() => void saver.flush(dot)}
          disabled={state === "saving" || state === "saved" || state === "idle"}
          className="ml-auto px-2.5 py-1 rounded-lg border border-border text-muted hover:text-ink hover:border-accent disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}

/** Notes for carriers you already moved past that still could not be saved. Never hidden, never lost. */
export function PendingNotes({
  saver,
  labelFor,
}: {
  saver: LeadNotesSaver;
  labelFor: (dot: number) => string;
}) {
  const failed = saver.pendingDots().filter((d) => saver.getState(d).state === "failed");
  if (failed.length === 0) return null;
  return (
    <div className="bg-bad/10 border border-bad/40 text-bad text-sm rounded-xl px-4 py-2 mb-3 space-y-1">
      {failed.map((d) => (
        <div key={d} className="flex items-center gap-2 flex-wrap">
          <AlertTriangle size={14} />
          <span>
            Notes for {labelFor(d)} aren&apos;t saved yet{saver.getState(d).error ? ` (${saver.getState(d).error})` : ""}.
          </span>
          <button type="button" onClick={() => void saver.retry(d)} className="underline font-medium">
            Retry
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Do Not Call + dialing. The server re-checks the restriction at the moment of dialing.
// ---------------------------------------------------------------------------
export function DncBanner() {
  return (
    <div className="flex items-start gap-2 bg-bad/10 border border-bad/40 text-bad text-sm rounded-lg px-3 py-2">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <div>
        <span className="font-semibold">Do Not Call.</span> Dialing and callbacks are turned off for this lead. Choose another status to remove the restriction.
      </div>
    </div>
  );
}

export function DialButton({
  number,
  dot,
  userId,
  blocked,
  label = "Dial",
  variant = "primary",
  onLead,
}: {
  number: string | null | undefined;
  dot: number;
  userId: string;
  blocked: boolean;
  label?: string;
  variant?: "primary" | "secondary";
  onLead: OnLead;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const base =
    variant === "primary"
      ? "flex items-center justify-center gap-1.5 bg-accent text-oncolor font-semibold rounded-lg px-4 py-2 min-h-[40px] text-sm hover:bg-accent/90 transition-colors disabled:opacity-60"
      : "flex items-center gap-1 text-xs border border-accent text-accent font-medium rounded-lg px-2.5 py-1.5 hover:bg-accent/10 transition-colors disabled:opacity-60";

  if (blocked) {
    return (
      <span className={`${base.replace(/hover:\S+/g, "")} opacity-50 cursor-not-allowed bg-surface2 text-muted border border-border`} title="Marked Do Not Call">
        <AlertTriangle size={13} /> Do Not Call
      </span>
    );
  }

  async function handle() {
    if (!number) return;
    setBusy(true);
    setErr(null);
    // Ask the server first, so a restriction set elsewhere (another tab, another page) still blocks the call.
    const r = await post("/api/leads/call", { dot_number: dot, kind: "dial", idempotency_key: newKey(), expected_user_id: userId });
    setBusy(false);
    if (r.ok) {
      onLead(dot, r.data.lead);
      window.location.href = telHref(number);
      return;
    }
    if (r.code === "do_not_call") {
      setErr("This lead is marked Do Not Call.");
      const refreshed = await api(`/api/carriers/lookup?dots=${dot}`);
      if (refreshed.ok && refreshed.data?.carriers?.[0]) onLead(dot, refreshed.data.carriers[0].leads);
      return;
    }
    if (r.code === "migration_pending") {
      // The restriction check on this page already passed; the attempt just can't be logged yet.
      window.location.href = telHref(number);
      return;
    }
    setErr(`Couldn't confirm this number is okay to dial (${friendlyError(r)}). Tap again to retry.`);
  }

  return (
    <div>
      <button type="button" onClick={handle} disabled={busy || !number} className={base} title="Dial with your default calling app">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <PhoneCall size={variant === "primary" ? 15 : 12} />} {label}
      </button>
      {err && <div className="text-xs text-bad mt-1 max-w-[260px]">{err}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirmed contact (this agent's own override; the provider's names are never changed)
// ---------------------------------------------------------------------------
export function ConfirmedContact({ dot, lead, userId, onLead }: { dot: number; lead: any; userId: string; onLead: OnLead }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("owner");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const keyRef = useRef(newKey());

  useEffect(() => {
    setEditing(false);
    setErr(null);
  }, [dot]);

  const confirmed: string | null = lead?.contact_override_name ?? null;

  async function run(body: Record<string, unknown>) {
    const target = dot; // the response belongs to THIS lead, whichever carrier is on screen later
    setBusy(true);
    setErr(null);
    const r = await post("/api/leads/contact", { dot_number: target, idempotency_key: keyRef.current, expected_user_id: userId, ...body });
    setBusy(false);
    if (!r.ok) return setErr(friendlyError(r));
    keyRef.current = newKey();
    onLead(target, r.data.lead);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="mt-2 bg-surface2 border border-accent/40 rounded-lg p-2.5 text-sm animate-fade-in">
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder="Contact name"
            className={`flex-1 min-w-[160px] ${inputCls}`}
            autoFocus
          />
          <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
            {Object.entries(ROLE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            disabled={busy || name.trim() === ""}
            onClick={() => run({ action: "set", name, role })}
            className="text-xs bg-accent text-oncolor font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
          >
            {busy ? "Saving…" : "Confirm contact"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-muted px-2 py-1">
            Cancel
          </button>
          {err && <span className="text-xs text-bad">{err}</span>}
        </div>
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5 text-good">
          <User size={14} />
          <span className="text-[10px] uppercase tracking-wide">Confirmed contact</span>
        </span>
        <span className="font-semibold">{confirmed}</span>
        <span className="text-muted text-xs">
          {ROLE_LABEL[lead.contact_override_role] ?? lead.contact_override_role}
          {lead.contact_confirmed_at ? ` · ${new Date(lead.contact_confirmed_at).toLocaleDateString()}` : ""}
        </span>
        <button
          type="button"
          onClick={() => {
            setName(confirmed);
            setRole(lead.contact_override_role ?? "owner");
            setEditing(true);
          }}
          className="text-xs text-muted hover:text-ink underline"
        >
          Edit
        </button>
        <button type="button" disabled={busy} onClick={() => run({ action: "clear" })} className="text-xs text-muted hover:text-bad underline">
          Clear
        </button>
        {err && <span className="text-xs text-bad">{err}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setName("");
        setRole("owner");
        setEditing(true);
      }}
      className="mt-1.5 text-xs text-muted hover:text-accent underline decoration-dotted"
    >
      + Confirm who you spoke to
    </button>
  );
}

// ---------------------------------------------------------------------------
// Callbacks: timed + timezone (or older date-only), complete / reschedule / clear
// ---------------------------------------------------------------------------
function localParts(utcIso: string, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcIso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}

export function CallbackSection({
  dot,
  lead,
  userId,
  onLead,
  open,
  onOpenChange,
  onSaved,
}: {
  dot: number;
  lead: any;
  userId: string;
  onLead: OnLead;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
}) {
  const [viewerTz] = useState(() => browserTimeZone());
  const dnc = lead?.status === "do_not_call";

  const [date, setDate] = useState("");
  const [withTime, setWithTime] = useState(true);
  const [time, setTime] = useState("09:00");
  const [tz, setTz] = useState(viewerTz);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);
  const keyRef = useRef(newKey());

  // Fill the form each time it opens: from the existing callback when rescheduling, else sensible defaults.
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setResolved(null);
    keyRef.current = newKey();
    if (lead?.callback_at && lead?.callback_timezone) {
      const p = localParts(lead.callback_at, lead.callback_timezone);
      setDate(p.date);
      setTime(p.time);
      setTz(lead.callback_timezone);
      setWithTime(true);
    } else if (lead?.reminder_date) {
      setDate(lead.reminder_date);
      setWithTime(false);
      setTz(viewerTz);
    } else {
      setDate(localDateInTimeZone(viewerTz));
      setWithTime(true);
      setTime("09:00");
      setTz(viewerTz);
    }
    setNote(lead?.reminder_note ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dot]);

  const zones = [
    { id: viewerTz, label: `Your timezone (${viewerTz})` },
    ...US_TIMEZONES.filter((z) => z.id !== viewerTz),
    ...(lead?.callback_timezone && lead.callback_timezone !== viewerTz && !US_TIMEZONES.some((z) => z.id === lead.callback_timezone)
      ? [{ id: lead.callback_timezone as string, label: lead.callback_timezone as string }]
      : []),
  ];

  const preview = withTime && date && time ? resolveLocalCallback(date, time, tz) : null;

  async function act(body: Record<string, unknown>, closeAfter: boolean) {
    const target = dot;
    setBusy(true);
    setErr(null);
    const r = await post("/api/leads/callback", { dot_number: target, idempotency_key: keyRef.current, expected_user_id: userId, ...body });
    setBusy(false);
    if (!r.ok) return setErr(friendlyError(r));
    keyRef.current = newKey();
    onLead(target, r.data.lead);
    if (r.data.resolution?.note) setResolved(r.data.resolution.note);
    if (closeAfter) onOpenChange(false);
    if (body.action === "set") onSaved?.();
  }

  const bucket = callbackBucket(lead ?? {}, viewerTz);
  const desc = describeCallback(lead ?? {});
  const hasCallback = !!desc;
  const mine = lead?.callback_at && lead?.callback_timezone && lead.callback_timezone !== viewerTz
    ? ` · ${formatCallbackDisplay(lead.callback_at, viewerTz)} your time`
    : "";

  return (
    <div>
      {hasCallback && !dnc && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm bg-surface2 border border-border rounded-lg px-3 py-2">
          <Bell size={13} className={bucket === "overdue" ? "text-bad" : "text-accent"} />
          <span className="font-medium">{desc}</span>
          <span className="text-muted text-xs">{mine}</span>
          {bucket && (
            <span
              className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                bucket === "overdue" ? "text-bad border-bad/40" : bucket === "completed" ? "text-muted border-border" : "text-accent border-accent/40"
              }`}
            >
              {BUCKET_LABEL[bucket]}
            </span>
          )}
          {lead?.reminder_note && <span className="text-muted text-xs basis-full">{lead.reminder_note}</span>}
          <span className="flex items-center gap-2 ml-auto text-xs">
            {!lead?.reminder_done && (
              <button type="button" disabled={busy} onClick={() => act({ action: "complete" }, false)} className="text-good underline">
                Complete
              </button>
            )}
            <button type="button" onClick={() => onOpenChange(!open)} className="text-muted hover:text-ink underline">
              Reschedule
            </button>
            <button type="button" disabled={busy} onClick={() => act({ action: "clear" }, true)} className="text-muted hover:text-bad underline">
              Clear
            </button>
          </span>
        </div>
      )}

      {dnc && <div className="text-xs text-muted">Callbacks are turned off while this lead is Do Not Call.</div>}

      {open && !dnc && (
        <div className="mt-2 bg-surface2 border border-accent/40 rounded-lg p-3 animate-fade-in">
          <div className="text-xs text-accent font-medium mb-2 flex items-center gap-1">
            <Bell size={12} /> When should this come back to you?
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={withTime} onChange={(e) => setWithTime(e.target.checked)} /> Set a time
            </label>
            {withTime && (
              <>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
                <select value={tz} onChange={(e) => setTz(e.target.value)} className={inputCls} aria-label="Timezone">
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.label}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          {preview && preview.ok && (
            <div className="text-xs text-muted mt-2">
              = {formatCallbackDisplay(preview.utc, tz)}
              {tz !== viewerTz ? ` · ${formatCallbackDisplay(preview.utc, viewerTz)} your time` : ""}
              {preview.note && <div className="text-accent mt-0.5">{preview.note}</div>}
            </div>
          )}
          {preview && !preview.ok && <div className="text-xs text-bad mt-2">{preview.error}</div>}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            placeholder="Message — e.g. asked to call after fleet renewal"
            className={`w-full mt-2 ${inputCls}`}
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              disabled={busy || !date || (withTime && (!time || (preview !== null && !preview.ok)))}
              onClick={() =>
                act(
                  withTime
                    ? { action: "set", local_date: date, local_time: time, timezone: tz, note }
                    : { action: "set", date_only: date, note },
                  true
                )
              }
              className="text-xs bg-accent text-oncolor font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save callback"}
            </button>
            <button type="button" onClick={() => onOpenChange(false)} className="text-xs text-muted px-2 py-1">
              Cancel
            </button>
            {err && <span className="text-xs text-bad">{err}</span>}
          </div>
        </div>
      )}
      {resolved && <div className="text-xs text-accent mt-1">{resolved}</div>}
      {!open && err && <div className="text-xs text-bad mt-1">{err}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Explicit "Log call": the only thing (besides a dial attempt) that counts as a call
// ---------------------------------------------------------------------------
export function LogCallForm({
  dot,
  userId,
  statuses,
  onLead,
  onDone,
}: {
  dot: number;
  userId: string;
  statuses: { value: string; label: string }[];
  onLead: OnLead;
  onDone?: () => void;
}) {
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const keyRef = useRef(newKey()); // kept until success, so a retry can never log the call twice

  useEffect(() => {
    setOutcome("");
    setNote("");
    setErr(null);
    setDone(false);
    keyRef.current = newKey();
  }, [dot]);

  async function submit() {
    const target = dot;
    setBusy(true);
    setErr(null);
    const r = await post("/api/leads/call", {
      dot_number: target,
      kind: "call",
      outcome: outcome || null,
      note: note || null,
      idempotency_key: keyRef.current,
      expected_user_id: userId,
    });
    setBusy(false);
    if (!r.ok) return setErr(friendlyError(r));
    keyRef.current = newKey();
    onLead(target, r.data.lead);
    setNote("");
    setOutcome("");
    setDone(true);
    onDone?.();
  }

  return (
    <div className="bg-surface2 border border-border rounded-lg p-3 animate-fade-in">
      <div className="text-xs text-muted mb-2">
        Records that you spoke with, or tried, this carrier. Changing a status alone is not counted as a call.
      </div>
      <div className="flex flex-wrap gap-2">
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={inputCls} aria-label="Outcome">
          <option value="">Outcome: keep current status</option>
          {statuses.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          placeholder="Optional call note"
          className={`flex-1 min-w-[140px] ${inputCls}`}
        />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <button type="button" disabled={busy} onClick={submit} className="text-xs bg-accent text-oncolor font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50">
          {busy ? "Logging…" : "Log call"}
        </button>
        {done && (
          <span className="flex items-center gap-1 text-xs text-good">
            <Check size={12} /> Call logged
          </span>
        )}
        {err && <span className="text-xs text-bad">{err}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History (loaded only when opened)
// ---------------------------------------------------------------------------
function describeEvent(e: any, statusLabel: (v: string) => string): string {
  const d = e.details ?? {};
  switch (e.event_type) {
    case "dial_initiated":
      return "Dial started (does not show whether anyone answered)";
    case "call_logged":
      return `Call logged${e.outcome ? `: ${statusLabel(e.outcome)}` : ""}`;
    case "status_changed":
      return `Status changed: ${d.from ? statusLabel(d.from) : "none"} → ${d.to ? statusLabel(d.to) : "none"}`;
    case "callback_set":
    case "callback_rescheduled": {
      const when = d.at && d.timezone ? formatCallbackDisplay(d.at, d.timezone) : d.date ? `${d.date} (date only)` : "";
      return `Callback ${e.event_type === "callback_set" ? "set" : "rescheduled"}${when ? ` for ${when}` : ""}`;
    }
    case "callback_completed":
      return "Callback completed";
    case "callback_cleared":
      return "Callback cleared";
    case "contact_confirmed":
      return `Contact confirmed: ${d.name ?? ""}${d.role ? ` (${ROLE_LABEL[d.role] ?? d.role})` : ""}`;
    case "contact_cleared":
      return "Confirmed contact cleared";
    default:
      return e.event_type;
  }
}

export function HistoryPanel({ dot, statusLabel }: { dot: number; statusLabel: (v: string) => string }) {
  const [events, setEvents] = useState<any[]>([]);
  const [legacy, setLegacy] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setErr(null);
    setEvents([]);
    api(`/api/leads/events?dot_number=${dot}&limit=25`, undefined, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return; // a different carrier is open now: ignore this answer
      setLoading(false);
      if (!r.ok) return r.code === "aborted" ? undefined : setErr(friendlyError(r));
      setEvents(r.data.events);
      setHasMore(r.data.has_more);
      setLegacy(r.data.legacy_last_activity_at);
    });
    return () => ctrl.abort();
  }, [dot]);

  async function more() {
    const r = await api(`/api/leads/events?dot_number=${dot}&limit=25&offset=${events.length}`);
    if (!r.ok) return setErr(friendlyError(r));
    setEvents((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      return [...prev, ...r.data.events.filter((e: any) => !seen.has(e.id))];
    });
    setHasMore(r.data.has_more);
  }

  return (
    <div className="bg-surface2 border border-border rounded-lg p-3 text-sm animate-fade-in max-h-[260px] overflow-y-auto">
      {loading && <div className="text-muted text-xs flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Loading history…</div>}
      {err && <div className="text-bad text-xs">{err}</div>}
      {!loading && !err && events.length === 0 && !legacy && <div className="text-muted text-xs">No history yet for this carrier.</div>}
      <ul className="space-y-1.5">
        {events.map((e) => (
          <li key={e.id} className="flex gap-2">
            <Clock size={12} className="text-muted mt-1 shrink-0" />
            <div>
              <div>{describeEvent(e, statusLabel)}</div>
              {e.note && <div className="text-muted text-xs">{e.note}</div>}
              <div className="text-muted text-[11px]">{new Date(e.occurred_at).toLocaleString()}</div>
            </div>
          </li>
        ))}
      </ul>
      {hasMore && (
        <button type="button" onClick={more} className="text-xs text-accent underline mt-2">
          Show older
        </button>
      )}
      {legacy && (
        <div className="text-[11px] text-muted mt-3 pt-2 border-t border-border/60">
          Earlier activity (recorded before call logging existed): {new Date(legacy).toLocaleString()}. This was the last status change, not a verified call.
        </div>
      )}
    </div>
  );
}
