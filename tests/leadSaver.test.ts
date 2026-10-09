import test from "node:test";
import assert from "node:assert/strict";
import { LeadNotesSaver, clearAllStoredDrafts, DRAFT_TTL_MS, type SaveResult, type StorageLike } from "../lib/leadSaver.ts";

class MemStorage implements StorageLike {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

/** A fake server whose replies we release by hand, so we can make them arrive late or out of order. */
function fakeServer() {
  const calls: { dot: number; notes: string; user: string; resolve: (r: SaveResult) => void }[] = [];
  const save = (req: { dot: number; notes: string; expectedUserId: string }) =>
    new Promise<SaveResult>((resolve) => calls.push({ dot: req.dot, notes: req.notes, user: req.expectedUserId, resolve }));
  const ok = (c: (typeof calls)[number]) => c.resolve({ ok: true, lead: { dot_number: c.dot, notes: c.notes } });
  return { calls, save, ok };
}
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

test("type on A, jump to B, A's response arrives late: it is reported for A only and B is untouched", async () => {
  const srv = fakeServer();
  const applied: { dot: number; notes: string }[] = [];
  const s = new LeadNotesSaver({ userId: "u1", save: srv.save, debounceMs: 5, onLead: (dot, lead) => applied.push({ dot, notes: lead.notes }) });

  s.setNotes(111, "note for A");
  await tick(); // debounce fires -> request for A is now in flight
  s.setNotes(222, "note for B"); // agent moved on to carrier B and typed there
  await tick();
  assert.equal(srv.calls.length, 2);

  srv.ok(srv.calls[1]); // B answers first
  await tick();
  srv.ok(srv.calls[0]); // A answers late
  await tick();

  assert.deepEqual(applied, [{ dot: 222, notes: "note for B" }, { dot: 111, notes: "note for A" }]);
  assert.equal(s.getDraft(222), "note for B");
  assert.equal(s.getDraft(111), "note for A");
  assert.equal(s.getState(111).state, "saved");
  assert.equal(s.getState(222).state, "saved");
});

test("rapid edits: requests go one at a time in order and an old response never marks newer text saved", async () => {
  const srv = fakeServer();
  const s = new LeadNotesSaver({ userId: "u1", save: srv.save, debounceMs: 2 });

  s.setNotes(7, "v1");
  await tick(8);
  assert.equal(srv.calls.length, 1);
  s.setNotes(7, "v2"); // edit while v1 is in flight
  await tick(8);
  assert.equal(srv.calls.length, 1, "no second request until the first finishes");

  srv.ok(srv.calls[0]); // v1 confirmed, but the agent has already typed v2
  await tick(8);
  assert.notEqual(s.getState(7).state, "saved", "v1 confirmation must not mark v2 saved");
  assert.equal(srv.calls.length, 2);
  assert.equal(srv.calls[1].notes, "v2");
  assert.equal(s.getDraft(7), "v2", "the draft on screen is never rolled back to v1");

  srv.ok(srv.calls[1]);
  await tick(8);
  assert.equal(s.getState(7).state, "saved");
});

test("many quick keystrokes become one request with the final text", async () => {
  const srv = fakeServer();
  const s = new LeadNotesSaver({ userId: "u1", save: srv.save, debounceMs: 20 });
  for (const t of ["h", "he", "hel", "hell", "hello"]) s.setNotes(9, t);
  await tick(40);
  assert.equal(srv.calls.length, 1);
  assert.equal(srv.calls[0].notes, "hello");
  srv.ok(srv.calls[0]);
});

test("a failed save keeps the draft, reports failure, and Retry works", async () => {
  const srv = fakeServer();
  const storage = new MemStorage();
  const s = new LeadNotesSaver({ userId: "u1", save: srv.save, debounceMs: 2, storage });
  s.setNotes(5, "important call details");
  await tick(8);
  srv.calls[0].resolve({ ok: false, error: "Server error 500" });
  await tick(8);

  assert.equal(s.getState(5).state, "failed");
  assert.equal(s.getState(5).error, "Server error 500");
  assert.equal(s.getDraft(5), "important call details", "draft preserved");
  assert.ok(storage.getItem("cd:draft:v1:u1:5"), "draft also kept in browser storage");
  assert.deepEqual(s.pendingDots(), [5]);

  const retry = s.retry(5);
  await tick(8);
  assert.equal(srv.calls.length, 2);
  assert.equal(srv.calls[1].notes, "important call details");
  srv.ok(srv.calls[1]);
  assert.equal(await retry, true);
  assert.equal(s.getState(5).state, "saved");
  assert.equal(storage.getItem("cd:draft:v1:u1:5"), null, "stored draft removed only after server confirmation");
});

test("a network exception is treated as a failure, not as saved", async () => {
  const s = new LeadNotesSaver({ userId: "u1", save: async () => { throw new Error("offline"); }, debounceMs: 1 });
  s.setNotes(3, "x");
  await tick(10);
  assert.equal(s.getState(3).state, "failed");
  assert.equal(s.getState(3).error, "offline");
});

test("different leads are saved independently; one failing does not block another", async () => {
  const srv = fakeServer();
  const s = new LeadNotesSaver({ userId: "u1", save: srv.save, debounceMs: 2 });
  s.setNotes(1, "a");
  s.setNotes(2, "b");
  await tick(8);
  assert.equal(srv.calls.length, 2, "both in flight at once");
  srv.calls[0].resolve({ ok: false, error: "boom" });
  srv.ok(srv.calls[1]);
  await tick(8);
  assert.equal(s.getState(1).state, "failed");
  assert.equal(s.getState(2).state, "saved");
});

test("flushAll (used before logout) reports which leads could not be saved", async () => {
  const srv = fakeServer();
  const s = new LeadNotesSaver({ userId: "u1", save: srv.save, debounceMs: 1000 });
  s.setNotes(1, "a");
  s.setNotes(2, "b");
  const done = s.flushAll();
  await tick(8);
  srv.ok(srv.calls[0]);
  srv.calls[1].resolve({ ok: false, error: "nope" });
  const r = await done;
  assert.equal(r.ok, false);
  assert.deepEqual(r.failed, [2]);
});

test("every request carries the agent's identity", async () => {
  const srv = fakeServer();
  const s = new LeadNotesSaver({ userId: "agent-77", save: srv.save, debounceMs: 1 });
  s.setNotes(4, "x");
  await tick(8);
  assert.equal(srv.calls[0].user, "agent-77");
  srv.ok(srv.calls[0]);
});

test("draft recovery is scoped to the user, expires, and is cleared on logout", async () => {
  const storage = new MemStorage();
  let now = 1_000_000;
  const mk = (userId: string) => new LeadNotesSaver({ userId, save: async () => ({ ok: false, error: "x" }), debounceMs: 1, storage, now: () => now });

  const a = mk("agentA");
  a.setNotes(10, "A's secret draft");
  await tick(8);

  assert.equal(mk("agentB").recover(10, ""), null, "another user never sees A's draft");
  assert.equal(mk("agentA").recover(10, ""), "A's secret draft");
  assert.equal(mk("agentA").recover(10, "A's secret draft"), null, "nothing to recover if the server already has the same text");

  now += DRAFT_TTL_MS + 1;
  assert.equal(mk("agentA").recover(10, ""), null, "expired drafts are discarded");
  assert.equal(storage.length, 0);

  now += 0;
  a.setNotes(11, "another");
  a.setNotes(12, "and another");
  await tick(8);
  assert.ok(storage.length >= 2);
  clearAllStoredDrafts(storage);
  assert.equal(storage.length, 0, "logout clears every stored draft");
  a.destroy();
});
