import test from "node:test";
import assert from "node:assert/strict";
import { buildOpener, guessFirstName, looksLikePerson, wordCount } from "../lib/callBrief.ts";

const base: any = { legal_name: "JAMES B WILSON", dba_name: null, company_rep1: null, company_rep2: null, phy_city: "SAINT CROIX FALLS", phy_state: "WI", power_units: 3 };

test("automatic greeting is unchanged when there is no confirmed contact", () => {
  assert.equal(buildOpener(base), "Hi James, calling about your 3 trucks out of Saint Croix Falls, WI.");
  const co = { ...base, legal_name: "ABC TRUCKING LLC", company_rep1: "MARIA GONZALEZ - OWNER", power_units: 1 };
  assert.equal(buildOpener(co), "Hi Maria, calling about Abc Trucking LLC, 1 truck in Saint Croix Falls, WI.");
  assert.equal(buildOpener({ ...co, company_rep1: null, power_units: null, phy_city: null, phy_state: null }), "Hi, calling about Abc Trucking LLC.");
  assert.equal(guessFirstName(base), "James");
  assert.equal(looksLikePerson("ABC TRUCKING LLC"), false);
});

test("a confirmed contact's first name is used exactly as typed", () => {
  assert.match(buildOpener(base, new Date(), "José Núñez-Öz Jr."), /^Hi José,/);
  assert.match(buildOpener(base, new Date(), "  Siobhán O'Brien "), /^Hi Siobhán,/);
  assert.match(buildOpener(base, new Date(), "李雷 先生"), /^Hi 李雷,/);
  assert.match(buildOpener(base, new Date(), "Anne-Marie"), /^Hi Anne-Marie,/);
});

test("a blank confirmed name falls back to the automatic greeting", () => {
  assert.equal(buildOpener(base, new Date(), "   "), buildOpener(base));
  assert.equal(buildOpener(base, new Date(), null), buildOpener(base));
});

test("the opener stays within about six seconds spoken", () => {
  assert.ok(wordCount(buildOpener(base, new Date(), "Maximiliano")) <= 15);
});
