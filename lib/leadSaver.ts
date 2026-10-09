// Per-lead draft + save engine for notes. Framework-free so it can be tested directly.
//
// Guarantees:
//  - Every draft and request is tied to ONE lead (dot number) and ONE signed-in agent.
//  - Within a lead, saves are sent one at a time, in order; an older response can never mark a newer edit saved.
//  - A server response is reported only for the lead it was sent for (never attached to whichever lead is on screen).
//  - A failed save keeps the draft (in memory and in local storage) and can be retried.
//  - "saved" is only ever set after the server confirmed the exact text that was sent.

export type SaveState = "idle" | "unsaved" | "saving" | "saved" | "failed";

export type SaveResult =
  | { ok: true; lead: any }
  | { ok: false; error: string; fatal?: boolean };

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export interface SaverOptions {
  userId: string;
  save: (req: { dot: number; notes: string; expectedUserId: string }) => Promise<SaveResult>;
  /** Called with the server-confirmed lead, for exactly the lead that was saved. */
  onLead?: (dot: number, lead: any) => void;
  onChange?: () => void;
  debounceMs?: number;
  storage?: StorageLike | null;
  now?: () => number;
}

interface Entry {
  draft: string;
  version: number; // bumped on every edit
  savedVersion: number; // highest version the server confirmed
  state: SaveState;
  error: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<void> | null;
}

export const DRAFT_PREFIX = "cd:draft:v1:";
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class LeadNotesSaver {
  private entries = new Map<number, Entry>();
  private opts: Required<Pick<SaverOptions, "debounceMs">> & SaverOptions;

  constructor(opts: SaverOptions) {
    this.opts = { debounceMs: 700, ...opts };
  }

  get userId() {
    return this.opts.userId;
  }

  private key(dot: number) {
    return `${DRAFT_PREFIX}${this.opts.userId}:${dot}`;
  }

  private entry(dot: number): Entry {
    let e = this.entries.get(dot);
    if (!e) {
      e = { draft: "", version: 0, savedVersion: 0, state: "idle", error: null, timer: null, running: null };
      this.entries.set(dot, e);
    }
    return e;
  }

  private changed() {
    this.opts.onChange?.();
  }

  // ---- reading ----

  /** The text the agent sees for this lead, or null if there is no draft (show the server value). */
  getDraft(dot: number): string | null {
    const e = this.entries.get(dot);
    return e && e.version > 0 ? e.draft : null;
  }

  getState(dot: number): { state: SaveState; error: string | null } {
    const e = this.entries.get(dot);
    return e ? { state: e.state, error: e.error } : { state: "idle", error: null };
  }

  /** Leads with edits not yet confirmed by the server. */
  pendingDots(): number[] {
    return Array.from(this.entries.entries())
      .filter(([, e]) => e.state === "unsaved" || e.state === "saving" || e.state === "failed")
      .map(([dot]) => dot);
  }

  hasPending(): boolean {
    return this.pendingDots().length > 0;
  }

  // ---- editing ----

  setNotes(dot: number, text: string) {
    const e = this.entry(dot);
    e.draft = text;
    e.version += 1;
    e.state = "unsaved";
    e.error = null;
    this.persist(dot, text);
    if (e.timer) clearTimeout(e.timer);
    e.timer = setTimeout(() => {
      e.timer = null;
      void this.run(dot);
    }, this.opts.debounceMs);
    this.changed();
  }

  /** Save now (explicit Save button, or before leaving). Resolves true only if everything for this lead is confirmed. */
  async flush(dot: number): Promise<boolean> {
    const e = this.entries.get(dot);
    if (!e || e.version === 0) return true;
    if (e.timer) {
      clearTimeout(e.timer);
      e.timer = null;
    }
    await this.run(dot);
    return e.state === "saved" || e.state === "idle";
  }

  async retry(dot: number): Promise<boolean> {
    return this.flush(dot);
  }

  async flushAll(): Promise<{ ok: boolean; failed: number[] }> {
    const dots = this.pendingDots();
    const results = await Promise.all(dots.map(async (d) => [d, await this.flush(d)] as const));
    const failed = results.filter(([, ok]) => !ok).map(([d]) => d);
    return { ok: failed.length === 0, failed };
  }

  // ---- sending (one request at a time per lead, always the latest text) ----

  private run(dot: number): Promise<void> {
    const e = this.entry(dot);
    if (e.running) return e.running;
    e.running = (async () => {
      try {
        while (e.savedVersion < e.version) {
          const sentVersion = e.version;
          const text = e.draft;
          e.state = "saving";
          e.error = null;
          this.changed();

          let result: SaveResult;
          try {
            result = await this.opts.save({ dot, notes: text, expectedUserId: this.opts.userId });
          } catch (err: any) {
            result = { ok: false, error: err?.message || "Network error." };
          }

          if (!result.ok) {
            e.state = "failed";
            e.error = result.error;
            this.changed();
            return; // draft stays; Retry will try again
          }

          e.savedVersion = Math.max(e.savedVersion, sentVersion);
          this.opts.onLead?.(dot, result.lead);
          if (e.version === sentVersion) {
            e.state = "saved";
            this.unpersist(dot);
            this.changed();
          } else {
            // Edited while this request was in flight: the confirmed text is already out of date.
            e.state = "unsaved";
            this.changed();
          }
        }
      } finally {
        e.running = null;
      }
    })();
    return e.running;
  }

  // ---- browser draft recovery (scoped to the signed-in user, expires, cleared on logout) ----

  private persist(dot: number, text: string) {
    try {
      this.opts.storage?.setItem(this.key(dot), JSON.stringify({ text, ts: (this.opts.now ?? Date.now)() }));
    } catch {
      /* storage can be full or blocked; in-memory draft still works */
    }
  }

  private unpersist(dot: number) {
    try {
      this.opts.storage?.removeItem(this.key(dot));
    } catch {
      /* ignore */
    }
  }

  /** An unsaved draft left over from an earlier visit, only if it belongs to THIS user and hasn't expired. */
  recover(dot: number, serverNotes: string | null): string | null {
    const storage = this.opts.storage;
    if (!storage) return null;
    try {
      const raw = storage.getItem(this.key(dot));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const age = (this.opts.now ?? Date.now)() - Number(parsed.ts);
      if (typeof parsed.text !== "string" || !(age >= 0) || age > DRAFT_TTL_MS) {
        storage.removeItem(this.key(dot));
        return null;
      }
      if (parsed.text === (serverNotes ?? "")) {
        storage.removeItem(this.key(dot));
        return null;
      }
      return parsed.text;
    } catch {
      return null;
    }
  }

  /** Forget everything for this lead (e.g. the agent chose to discard the recovered text). */
  discard(dot: number) {
    const e = this.entries.get(dot);
    if (e?.timer) clearTimeout(e.timer);
    this.entries.delete(dot);
    this.unpersist(dot);
    this.changed();
  }

  destroy() {
    for (const e of this.entries.values()) if (e.timer) clearTimeout(e.timer);
    this.entries.clear();
  }
}

/** Removes every saved draft in this browser (all users). Call on logout. */
export function clearAllStoredDrafts(storage: StorageLike | null | undefined) {
  if (!storage) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(DRAFT_PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => storage.removeItem(k));
  } catch {
    /* ignore */
  }
}
