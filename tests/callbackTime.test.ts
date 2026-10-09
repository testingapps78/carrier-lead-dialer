import test from "node:test";
import assert from "node:assert/strict";
import { resolveLocalCallback, formatCallbackDisplay, offsetMinutes, isValidTimeZone, localDateInTimeZone } from "../lib/callbackTime.ts";

test("normal summer time in Chicago (CDT, UTC-5)", () => {
  const r = resolveLocalCallback("2026-07-15", "14:00", "America/Chicago");
  assert.ok(r.ok && r.kind === "exact");
  assert.equal(r.utc, "2026-07-15T19:00:00.000Z");
});

test("normal winter time in New York (EST, UTC-5)", () => {
  const r = resolveLocalCallback("2026-11-02", "09:00", "America/New_York");
  assert.ok(r.ok && r.kind === "exact");
  assert.equal(r.utc, "2026-11-02T14:00:00.000Z");
});

test("Arizona has no daylight saving", () => {
  const r = resolveLocalCallback("2026-07-15", "14:00", "America/Phoenix");
  assert.ok(r.ok && r.kind === "exact");
  assert.equal(r.utc, "2026-07-15T21:00:00.000Z");
});

test("spring forward: 2:30 AM on 2026-03-08 in New York does not exist and moves to 3:30 AM EDT", () => {
  const r = resolveLocalCallback("2026-03-08", "02:30", "America/New_York");
  assert.ok(r.ok);
  assert.equal(r.kind, "gap_shifted");
  assert.equal(r.utc, "2026-03-08T07:30:00.000Z"); // 3:30 EDT
  assert.match(String(r.note), /doesn't exist/);
});

test("the minute before the gap and the first minute after are exact", () => {
  const a = resolveLocalCallback("2026-03-08", "01:59", "America/New_York");
  const b = resolveLocalCallback("2026-03-08", "03:00", "America/New_York");
  assert.ok(a.ok && a.kind === "exact" && b.ok && b.kind === "exact");
  assert.equal(a.utc, "2026-03-08T06:59:00.000Z");
  assert.equal(b.utc, "2026-03-08T07:00:00.000Z");
});

test("fall back: 1:30 AM on 2026-11-01 in New York happens twice; the first (EDT) is used", () => {
  const r = resolveLocalCallback("2026-11-01", "01:30", "America/New_York");
  assert.ok(r.ok);
  assert.equal(r.kind, "ambiguous_first");
  assert.equal(r.utc, "2026-11-01T05:30:00.000Z"); // 1:30 EDT, not 06:30Z (1:30 EST)
  assert.match(String(r.note), /twice/);
});

test("Pacific zone transitions too (Los Angeles gap and overlap)", () => {
  const gap = resolveLocalCallback("2026-03-08", "02:15", "America/Los_Angeles");
  assert.ok(gap.ok && gap.kind === "gap_shifted");
  assert.equal(gap.utc, "2026-03-08T10:15:00.000Z"); // 3:15 PDT
  const overlap = resolveLocalCallback("2026-11-01", "01:15", "America/Los_Angeles");
  assert.ok(overlap.ok && overlap.kind === "ambiguous_first");
  assert.equal(overlap.utc, "2026-11-01T08:15:00.000Z"); // first 1:15 (PDT)
});

test("the agent's own zone (Karachi, UTC+5) works", () => {
  const r = resolveLocalCallback("2026-10-09", "22:00", "Asia/Karachi");
  assert.ok(r.ok && r.kind === "exact");
  assert.equal(r.utc, "2026-10-09T17:00:00.000Z");
});

test("rejects bad input instead of guessing", () => {
  assert.equal(resolveLocalCallback("2026-02-30", "10:00", "America/Chicago").ok, false);
  assert.equal(resolveLocalCallback("2026-07-15", "25:00", "America/Chicago").ok, false);
  assert.equal(resolveLocalCallback("2026-07-15", "10:00", "Mars/Olympus").ok, false);
  assert.equal(resolveLocalCallback("15/07/2026", "10:00", "America/Chicago").ok, false);
});

test("offset and display reflect daylight saving", () => {
  assert.equal(offsetMinutes(Date.parse("2026-07-01T12:00:00Z"), "America/New_York"), -240);
  assert.equal(offsetMinutes(Date.parse("2026-12-01T12:00:00Z"), "America/New_York"), -300);
  assert.match(formatCallbackDisplay("2026-07-01T18:30:00.000Z", "America/New_York"), /2:30 PM EDT/);
  assert.match(formatCallbackDisplay("2026-12-01T18:30:00.000Z", "America/New_York"), /1:30 PM EST/);
});

test("timezone validation and local-date helper", () => {
  assert.equal(isValidTimeZone("America/Chicago"), true);
  assert.equal(isValidTimeZone("nope"), false);
  assert.equal(localDateInTimeZone("America/Chicago", new Date("2026-07-02T03:00:00Z")), "2026-07-01");
  assert.equal(localDateInTimeZone("Asia/Karachi", new Date("2026-07-02T03:00:00Z")), "2026-07-02");
});
