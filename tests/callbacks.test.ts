import test from "node:test";
import assert from "node:assert/strict";
import { callbackBucket, describeCallback } from "../lib/callbacks.ts";

const now = new Date("2026-11-01T12:00:00Z"); // 7:00 AM EST / 8:00 AM EDT-less: after the fall-back; Chicago 6:00 AM
const tz = "America/Chicago";

test("timed callbacks: past instant is overdue, later today is today, tomorrow is upcoming", () => {
  assert.equal(callbackBucket({ callback_at: "2026-11-01T10:00:00Z", reminder_date: "2026-11-01" }, tz, now), "overdue");
  assert.equal(callbackBucket({ callback_at: "2026-11-01T20:00:00Z", reminder_date: "2026-11-01" }, tz, now), "today");
  assert.equal(callbackBucket({ callback_at: "2026-11-02T20:00:00Z", reminder_date: "2026-11-02" }, tz, now), "upcoming");
});

test("date-only reminders stay date-only: today all day, overdue only after the date", () => {
  assert.equal(callbackBucket({ reminder_date: "2026-11-01" }, tz, now), "today");
  assert.equal(callbackBucket({ reminder_date: "2026-10-31" }, tz, now), "overdue");
  assert.equal(callbackBucket({ reminder_date: "2026-11-02" }, tz, now), "upcoming");
});

test("completed, none, and Do Not Call", () => {
  assert.equal(callbackBucket({ reminder_date: "2026-10-01", reminder_done: true }, tz, now), "completed");
  assert.equal(callbackBucket({}, tz, now), null);
  assert.equal(callbackBucket({ status: "do_not_call", reminder_date: "2026-10-01" }, tz, now), null);
});

test("the viewer's timezone decides which day 'today' is", () => {
  const late = new Date("2026-11-02T03:30:00Z"); // still Nov 1 in Chicago, already Nov 2 in Karachi
  assert.equal(callbackBucket({ reminder_date: "2026-11-01" }, "America/Chicago", late), "today");
  assert.equal(callbackBucket({ reminder_date: "2026-11-01" }, "Asia/Karachi", late), "overdue");
});

test("descriptions", () => {
  assert.match(String(describeCallback({ callback_at: "2026-11-03T15:00:00.000Z", callback_timezone: "America/New_York" })), /10:00 AM EST/);
  assert.match(String(describeCallback({ reminder_date: "2026-11-06" })), /Nov 6 \(date only\)/);
  assert.equal(describeCallback({}), null);
});
